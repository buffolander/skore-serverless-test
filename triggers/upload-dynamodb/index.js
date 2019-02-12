'use strict';

const csv = require('papaparse');

const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const dynamoDb = new AWS.DynamoDB.DocumentClient();

const checkRowInvalid = (row) => {
    if(row.errors[0]) {
        return true;
    } 

    const check_keys = ['content_id', 'customer_id', 'last_seen', 'username']
    .map(key => typeof row.data[0][key] === 'undefined');
    if(check_keys.indexOf(true) >= 0) {
        return true;
    }

    return false;
}

const commitRow = (row) => {
    const params = {
        TableName: process.env.DYNAMODB_CONTENT_CONSUMPTION,
        Key: {
            customer_id: row.data[0].customer_id.toString(),
            user_id: `${row.data[0].customer_id}==${row.data[0].username}`
        },
        ExpressionAttributeNames : {
            '#listName' : 'content_list'
        },
        ExpressionAttributeValues: {
            ':inc': 1,
            ':newCount': 0,
            ':newArray': [],
            ':username': row.data[0].username.toString(),
            ':contentObject': [{
                last_seen_timestamp: lastseenTimestamp(row.data[0].last_seen),
                last_seen: row.data[0].last_seen,
                content_id: row.data[0].content_id
            }]
        },
        UpdateExpression: `SET count_ = if_not_exists(count_, :newCount) + :inc, 
        #listName = list_append(if_not_exists(#listName, :newArray), :contentObject),
        username = :username`,
        ReturnValues: 'NONE'
    };
    /*
    const params = {
        TableName: process.env.DYNAMODB_CONTENT_CONSUMPTION,
        Key: {
            customer_id: row.data[0].customer_id.toString(),
            event_id: `${row.data[0].customer_id}==${lastseenTimestamp(row.data[0].last_seen)}==${row.data[0].username}`
        },
        ExpressionAttributeValues: {
            ':content_id': row.data[0].content_id.toString(),
            ':last_seen': row.data[0].last_seen,
            ':last_seen_timestamp': lastseenTimestamp(row.data[0].last_seen),
            ':username': row.data[0].username.toString()
        },
        UpdateExpression: `SET content_id = :content_id, last_seen = :last_seen, 
        last_seen_timestamp = :last_seen_timestamp, username = :username`,
        ReturnValues: 'NONE'
    };
    */
    dynamoDb.update(params, (error, result) => {
        if(error) {
            console.error('dynamoDb.update error', params, error);
        }
    });
}

const lastseenTimestamp = (date_string) => {
    const datum = new Date(date_string);
    return isNaN(datum.getTime()) ? null : datum.getTime();
}

const updateSyncRecord = (record) => {
    const params = {
        TableName: process.env.DYNAMODB_SYNC_OPS,
        Key: {
            customer_id: record.customer_id,
            file_id: record.file_id
        },
        ExpressionAttributeValues: {
            ':count': record.count_,
            ':cursor': record.cursor_,
            ':sync_complete': record.sync_complete,
            ':sync_finished_on': record.sync_finished_on
        },
        UpdateExpression: `SET count_ = :count, cursor_ = :cursor, sync_complete = :sync_complete,
        sync_finished_on = :sync_finished_on`,
        ReturnValues: 'NONE'
    };
    dynamoDb.update(params, (error, result) => {
        if(error) {
            console.error('dynamoDb.update error', error);
        }
    });
}

exports.handler = (event, context) => {
    const file_id = AWS.DynamoDB.Converter.unmarshall(event.Records[0].dynamodb.Keys);
    if(typeof event.Records[0].dynamodb.NewImage === 'undefined') {
        return console.log(`Record ${file_id} was deleted from dynamoDb table`);
    }

    const record = AWS.DynamoDB.Converter.unmarshall(event.Records[0].dynamodb.NewImage);
    if(typeof record.operation !== 'undefined' && record.operation !== 'upload_content_consumption') {
        return console.log(`This function only consumes operations of type 'upload_content_consumption'`);
    }
    if(record.sync_complete) {
        return console.log(`Finished processing file ${record.s3.key} from 
        bucket ${record.s3.bucket}`);
    }
    
    const stream = s3.getObject({
        Bucket: record.s3.bucket,
        Key: record.s3.key
    }).createReadStream();

    const batch_size = parseInt(process.env.UPLOAD_MAX_BATCH_SIZE, 10);
    const first_record = record.cursor_;
    const last_record = record.cursor_ + batch_size;
    let cursor = 1;

    csv.parse(stream, {
        header: true,
        step: row => {
            if(checkRowInvalid(row)) {
                return;
            }
            if(cursor >= first_record && cursor < last_record) {
                setTimeout(() => {
                    commitRow(row);
                    record.count_.processed_rows++;
                }, 100);
            }
            cursor++;
        },
        complete: () => {
            if(last_record >= record.count_.rows) {
                record.cursor_ = null;
                record.sync_complete = true;
                record.sync_finished_on = new Date().getTime();
            } else {
                record.cursor_ = last_record;
            }
            updateSyncRecord(record);
            console.log('sync progress', `${record.count_.processed_rows} of ${record.count_.rows}`);
            return;
        }
    });
};