'use strict';

const AWS = require('aws-sdk'); 

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const params = {
  TableName: process.env.DYNAMODB_SYNC_OPS,
  ConsistentRead: true,
  Key: {
    customer_id: '9792873',
  },
};

module.exports.handler = (event, context, callback) => {
  
  dynamoDb.scan(params, (error, result) => {
    if (error) {
      console.error(error);
      callback(null, {
        statusCode: error.statusCode || 501,
        body: JSON.stringify({
          ok: false,
          message: 'Internal Server Error. Unable to fetch results'
        })
      });
      return;
    }

    callback(null, {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        resource: 'upload-status',
        count_: result.Items.length,
        items: result.Items
      })
    });
  });
};
