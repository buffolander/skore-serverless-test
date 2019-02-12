'use strict';

const AWS = require('aws-sdk'); 
const dynamoDb = new AWS.DynamoDB.DocumentClient();

const parseQueryInt = (number_string) => {
  const number_ = parseInt(number_string, 10);
  return isNaN(number_) ? null : number_;
}

module.exports.handler = async (event, context, callback) => {
  const params = {
    ConsistentRead: true,
    ExpressionAttributeValues: { ':key': '9792873' },
    IndexName: 'count-index',
    KeyConditionExpression: `customer_id = :key`,
    ScanIndexForward: false,
    TableName: process.env.DYNAMODB_CONTENT_CONSUMPTION
  };

  let page_size = null;
  try {
    page_size = parseQueryInt(event.queryStringParameters['limit']);
  } catch(error) {
    // console.log(error);
  }
  if(!page_size) {
    page_size = 50;
  } else if(page_size > 100) {
    page_size = 100;
  } 
  params.Limit = page_size;

  try{
    const start = Buffer(event.queryStringParameters['start'], 'base64').toString();
    params.ExclusiveStartKey = JSON.parse(start);
  } catch(error) {
    // console.log(error);
  }

  let result = null, result_set = [], scan_running = true;
  while(scan_running) {
    try {
      result = await dynamoDb.query(params).promise();
    } catch (error) {
      console.error('dynamoDb.query error', params, error);
      callback(null, {
        statusCode: error.statusCode || 501,
        body: JSON.stringify({
          ok: false,
          message: 'Internal Server Error. Unable to fetch results'
        })
      });
      return;
    }
    result_set = result_set.concat(result.Items);
    
    if(result_set.length < page_size && typeof result.LastEvaluatedKey !== 'undefined') {
      params.Limit = page_size - result_set.length;
      params.ExclusiveStartKey = result.LastEvaluatedKey;
    } else {
      scan_running = false; 
    }
  }

  let response_body = {
    ok: true,
    resource: 'user-consumption',
    count_: result_set.length,
    items: result_set
  };
  if(result.LastEvaluatedKey) {
    const cursor = JSON.stringify(result.LastEvaluatedKey);
    const cursor_encoded = Buffer(cursor).toString('base64');
    response_body.page_results = `${event.path}?limit=${page_size}&start=${cursor_encoded}`;
  } 
  callback(null, {
    statusCode: 200,
    body: JSON.stringify(response_body)
  });
};
