'use strict';

const csv = require('papaparse');
const _ = require('lodash');

const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const dynamoDb = new AWS.DynamoDB.DocumentClient();


const enqueueFile = (file) => {
    if(file.error) {
        return console.error(`error processing file ${file.key} from bucket ${file.bucket}`, file.error);
    }
    let file_details = {
        count: {
            rows: null,
            processed_rows: 0
        },
        customer_id: null,
        s3: {
            bucket: file.bucket,
            key: file.key
        },
        sync_complete: false
    };

    const content = file.data.Body.toString('utf8');
    const content_rows = content.split('\r');
    file_details.count.rows = content_rows.length -1;
    
    const customer_id_index = content_rows[0].split(',').indexOf('customer_id');
    if(customer_id_index >= 0) {
        let row_idx = 1;
        while(file_details.customer_id === null) {
            file_details.customer_id = content_rows[row_idx].split(',')[customer_id_index] || null;
            row_idx++;
        } 
    } else {
        file_details.errors.push({ message: `Uploaded file is missing or has invalid columns` });
        file.sync_complete = true;
    }
    
    joinQueue(file_details);
    if(file.last_object_in_trigger) {
        return file.callback(null, null);
    }
}

const joinQueue = (file_details) => {
    const params = {
        TableName: process.env.DYNAMODB_SYNC_OPS,
        Key: {
            customer_id: file_details.customer_id,
            file_id: `${file_details.customer_id}==${new Date().getTime()}`
        },
        ExpressionAttributeValues: {
            ':count': file_details.count,
            ':cursor': 1,
            ':operation': `upload_content_consumption`,
            ':s3': file_details.s3,
            ':sync_complete': file_details.sync_complete,
            ':sync_finished_on': null,
            ':sync_started_on': new Date().getTime(),
        },
        UpdateExpression: `SET count_ = :count, cursor_ = :cursor, operation = :operation, s3 = :s3, 
        sync_complete = :sync_complete, sync_finished_on = :sync_finished_on, sync_started_on = :sync_started_on`,
        ReturnValues: 'NONE'
    };
    dynamoDb.update(params, (error, result) => {
        if(error) {
            console.error('dynamoDb.update error', error);
        }
    });
}

module.exports.handler = (event, context, callback) => {
    const uploaded_files_count = event.Records.length;
    
    event.Records.forEach((_object, idx) => {
        const bucket = _object.s3.bucket.name;
        const filekey = _object.s3.object.key;

        return s3.getObject({
            Bucket: bucket,
            Key: filekey
        }, (error, data) => {
            return enqueueFile({
                error: error, 
                data: data,
                last_object_in_trigger: uploaded_files_count === idx +1,
                bucket: bucket,
                key: filekey,
                callback: callback
            });
        });
    });
};