const AWS = require('aws-sdk');
const ddb = new AWS.DynamoDB.DocumentClient();

const db = {
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
        Prefix: 'CONNECTION|',
        Entity: 'CONNECTION'
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
        Prefix: 'CHANNEL|',
        Entity: 'CHANNEL'
    },
    Message: {
        Primary: {
            Key: 'pk',
            Range: 'sk'
        },
        Prefix: 'MESSAGE|',
        Entity: 'MESSAGE'
    }
}

const channelRegex = new RegExp(`^${db.Channel.Entity}\|`);
const messageRegex = new RegExp(`^${db.Message.Entity}\|`);
const connectionRegex = new RegExp(`^${db.Connection.Entity}\|`);

function parseEntityId(target){
    console.log('ENTITY ID A ', target)

    if(typeof target === 'object'){
        // use from raw event, only needed for connectionId at the moment
        target = target.requestContext.connectionId;
    } else {
        // strip prefix if set so we always get raw id
        target = target
                .replace(channelRegex, '')
                .replace(messageRegex, '')
                .replace(connectionRegex, '');
    }

    return target.replace('|', ''); // why?!
}

async function fetchConnectionSubscriptions(connection){
    const connectionId = parseEntityId(connection)
    const results = await ddb.query({
        TableName: db.Table,
        IndexName: db.Connection.Channels.Index,
        KeyConditionExpression: `${
          db.Connection.Channels.Key
        } = :connectionId and begins_with(${
          db.Connection.Channels.Range
        }, :channelEntity)`,
        ExpressionAttributeValues: {
          ":connectionId": `${db.Connection.Prefix}${
            connectionId
          }`,
          ":channelEntity": db.Channel.Prefix
        }
      }).promise();

      return results.Items;
}

async function fetchChannelSubscriptions(channel){
    const channelId = parseEntityId(channel)
    const results = await ddb.query({
        TableName: db.Table,
        KeyConditionExpression: `${
          db.Channel.Connections.Key
        } = :channelId and begins_with(${
          db.Channel.Connections.Range
        }, :connectionEntity)`,
        ExpressionAttributeValues: {
          ":channelId": `${db.Channel.Prefix}${channelId}`,
          ":connectionEntity": db.Connection.Prefix
        }
      }).promise();

      return results.Items;
}


const client = {
    ...db,
    parseEntityId,
    fetchConnectionSubscriptions,
    fetchChannelSubscriptions,
    Client: ddb
}

module.exports = client