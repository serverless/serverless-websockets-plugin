const db = require("./db");
const ws = require("./websocket-client");
const sanitize = require("sanitize-html");
const wsClient = new ws.Client({
  requestContext: {
    domainName: process.env.DOMAIN_NAME,
    stage: process.env.STAGE
  }
});
const success = {
  statusCode: 200
};

async function connectionManager(event, context) {
  console.log(JSON.stringify(event), JSON.stringify(context));

  if (event.requestContext.eventType === "CONNECT") {
    // sub general channel
    await subscribeChannel(
      {
        ...event,
        body: JSON.stringify({
          action: "subscribe",
          channelId: "General"
        })
      },
      context,
      false
    );

    return success;
  } else if (event.requestContext.eventType === "DISCONNECT") {
    // unsub all channels we were in
    const subscriptions = await db.Client.query({
      TableName: db.Table,
      IndexName: db.Connection.Channels.Index,
      KeyConditionExpression: `${
        db.Connection.Channels.Key
      } = :connectionId and begins_with(${
        db.Connection.Channels.Range
      }, :channelEntity)`,
      ExpressionAttributeValues: {
        ":connectionId": `${db.Connection.Prefix}${
          event.requestContext.connectionId
        }`,
        ":channelEntity": db.Channel.Prefix
      }
    }).promise();

    console.log(subscriptions)

    const unsubscribes = subscriptions.Items.map(async subscription =>
      unsubscribeChannel(
        {
          ...event,
          body: JSON.stringify({
            action: "unsubscribe",
            channelId: subscription[db.Channel.Primary.Key].split('|')[1]
          })
        },
        context
      )
    );

    await Promise.all(unsubscribes);
    return success;
    // no need to return anything because this is a disconnection
  }
}

async function defaultMessage(event, context) {
  console.log(JSON.stringify(event), JSON.stringify(context));

  await wsClient.send(event, {
    event: "error",
    message: "invalid action type"
  });

  return success;
}

async function sendMessage(event, context) {
  // save message for future history
  // saving with `hrtime` allows sorting and easy
  // ttl?
  console.log(JSON.stringify(event), JSON.stringify(context));

  const item = await db.Client.put({
    TableName: db.Table,
    Item: {
      [db.Message.Primary.Key]: `${db.Channel.Prefix}${event.ChannelId}`,
      [db.Message.Primary.Range]: `${db.Message.Prefix}${process.hrtime()}`,
      ConnectionId: `${context.connection.id}`,
      Name: `${event.body.name
        .replace(/[^a-z0-9\s-]/gi, "")
        .trim()
        .replace(/\+s/g, "-")}`,
      Content: sanitize(event.body.content, {
        allowedTags: [
          "ul",
          "ol",
          "b",
          "i",
          "em",
          "strike",
          "pre",
          "strong",
          "li"
        ],
        allowedAttributes: {}
      })
    }
  }).promise();

  return success;
  // Instead of broadcasting here we listen to the dynamodb stream
  // This means we can acknowledge the save fast
  // then blast it out later async from the stream
}

async function fetchConnectionsInChannel(channelId) {
  const results = await db.Client.query({
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

// oh my... this got out of hand refactor for sanity
async function broadcast(event, context) {
  // info from table stream, we'll learn about connections
  // disconnections, messages, etc
  // get all connections for channel of interest
  // broadcast the news
  const results = event.Records.map(async record => {
    console.log(JSON.stringify(record));
    switch (record.dynamodb.Keys[db.Primary.Key].S.split("|")[0]) {
      // Connection base entity
      case db.Connection.Prefix.slice(0, -1):
        break;
      // Channel base entity (most stuff)
      case db.Channel.Prefix.slice(0, -1):
        // figure out what to do based on full entity model

        switch (record.dynamodb.Keys[db.Primary.Range].S.split("|")[0]) {
          case db.Connection.Prefix.slice(0, -1):
            // A connection event on the channel
            // let all users know a connection was created or dropped
            const subscribers = await fetchConnectionsInChannel(
              record.dynamodb.Keys[db.Primary.Key].S.split("|")[1]
            );
            const results = subscribers.map(async subscriber => {
              const subscriberId = subscriber[
                db.Channel.Connections.Range
              ].split("|")[1];
              return wsClient.send(
                subscriberId, // really backwards way of getting connection id
                {
                  event: "subscriber_sub_unsub",
                  subscriberId: record.dynamodb.Keys[db.Primary.Range].S.split(
                    "|"
                  )[1]
                }
              );
            });

            await Promise.all(results);
            break;

          case db.Message.Prefix.slice(0, -1):
            // A message event on the channel

            break;

          default:
            return;
        }

        break;
      default:
        return;
    }
  });

  await Promise.all(results);
  return success;
}

// module.exports.loadHistory = async (event, context) => {
//   // only allow first page of history, otherwise this could blow up a table fast
//   // pagination would be interesting to implement as an exercise!
//   return await db.Client.query({
//     TableName: db.Table
//   }).promise();
// };

async function subscribeChannel(event, context) {
  console.log(JSON.stringify(event), JSON.stringify(context));

  const channelId = JSON.parse(event.body).channelId;
  await db.Client.put({
    TableName: db.Table,
    Item: {
      [db.Channel.Connections.Key]: `${db.Channel.Prefix}${channelId}`,
      [db.Channel.Connections.Range]: `${db.Connection.Prefix}${
        event.requestContext.connectionId
      }`
    }
  }).promise();

  return success;
}

async function unsubscribeChannel(event, context) {
  console.log(JSON.stringify(event), JSON.stringify(context));
  const channelId = JSON.parse(event.body).channelId;
  const item = await db.Client.delete({
    TableName: db.Table,
    Key: {
      [db.Channel.Connections.Key]: `${db.Channel.Prefix}${channelId}`,
      [db.Channel.Connections.Range]: `${db.Connection.Prefix}${
        event.requestContext.connectionId
      }`
    }
  }).promise();

  return success;
}

module.exports = {
  connectionManager,
  defaultMessage,
  sendMessage,
  broadcast,
  subscribeChannel,
  unsubscribeChannel
};
