const AWS = require('aws-sdk');
const ddb = new AWS.DynamoDB.DocumentClient();

module.exports = {
    Table: process.env.APPLICATION_TABLE,
    Primary: {
        Key: 'pk',
        Range: 'sk'
    },
    Connection: {
        Primary: {
            Key: 'pk',
            Range: 'sk'
        },
        Channels: {
            Index: 'reverse',
            Key: 'sk',
            Range: 'pk'
        },
        Prefix: 'CONNECTION|'
    },
    Channel: {
        Primary: {
            Key: 'pk',
            Range: 'sk'
        },
        Connections: {
            Key: 'pk',
            Range: 'sk'
        },
        Messages: {
            Key: 'pk',
            Range: 'sk'
        },
        Prefix: 'CHANNEL|'
    },
    Message: {
        Primary: {
            Key: 'pk',
            Range: 'sk'
        },
        Prefix: 'MESSAGE|'
    },
    Client: ddb
}