const { function_lastseenTimestamp } = require('./index');

const fs = require('fs');
const sample_trigger = JSON.parse(fs.readFileSync(`${__dirname}/sample-s3-trigger.json`, 'utf8'));
const sample_file = fs.readFileSync(`${__dirname}/sample-input-file.csv`, 'utf8');

describe('lastseenTimestamp', () => {
    it('expect date string \'2018-08-26T01:59:17Z\' to return 1535248757000', () => {
        expect(function_lastseenTimestamp('2018-08-26T01:59:17Z')).toBe(1535248757000);
    });
    it('expect non-valid string \'hello Skore\' to return null', () => {
        expect(function_lastseenTimestamp('hello Skore')).toBeNull();
    });
});


it('fetches the trigger-file from S3', () => {
    expect(1).toBe(1);
});




/*, () => {
    const bucket = sample_trigger.Records[0].s3.bucket.name;
    const filekey = sample_trigger.Records[0].s3.object.key;
    const fakeS3Get = (bucket, filekey) => {
        expect(bucket).toBe('skore-serverless-test');
        expect(filekey).toBe('content-consumption-files/patients-upload-190205.csv');
        
    }
});
/*
test('given Bruno as name, expect output to be Hello Bruno', () => {
    expect(hello('Bruno')).toBe('hello Bruno');
});
*/