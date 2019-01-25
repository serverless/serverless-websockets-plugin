const db = require("./db");
const ws = require("./websocket-client");
const sanitize = require("sanitize-html");

const wsClient = new ws.Client();

const success = {
  statusCode: 200
};

async function connectionManager(event, context) {
  // we do this so first connect EVER sets up some needed config state in db
  // this goes away after CloudFormation support is added for web sockets
  await wsClient._setupClient(event);

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
      context
    );

    return success;
  } else if (event.requestContext.eventType === "DISCONNECT") {
    // unsub all channels connection was in
    const subscriptions =await db.fetchConnectionSubscriptions(event);
    const unsubscribes = subscriptions.map(async subscription =>
      // just simulate / reuse the same as if they issued the request via the protocol
      unsubscribeChannel(
        {
          ...event,
          body: JSON.stringify({
            action: "unsubscribe",
            channelId: db.parseEntityId(subscription[db.Channel.Primary.Key])
          })
        },
        context
      )
    );

    await Promise.all(unsubscribes);
    return success;
  }
}

async function defaultMessage(event, context) {
  await wsClient.send(event, {
    event: "error",
    message: "invalid action type"
  });

  return success;
}

async function sendMessage(event, context) {
  // save message for future history
  // saving with timestamp allows sorting
  // maybe do ttl?

  const body = JSON.parse(event.body);
  const messageId = `${db.Message.Prefix}${Date.now()}`;
  const name = body.name
    .replace(/[^a-z0-9\s-]/gi, "")
    .trim()
    .replace(/\+s/g, "-");
  const content = sanitize(body.content, {
    allowedTags: ["ul", "ol", "b", "i", "em", "strike", "pre", "strong", "li"],
    allowedAttributes: {}
  });

  // save message in database for later
  const item = await db.Client.put({
    TableName: db.Table,
    Item: {
      [db.Message.Primary.Key]: `${db.Channel.Prefix}${body.channelId}`,
      [db.Message.Primary.Range]: messageId,
      ConnectionId: `${event.requestContext.connectionId}`,
      Name: name,
      Content: content
    }
  }).promise();

  const subscribers = await db.fetchChannelSubscriptions(body.channelId);
  const results = subscribers.map(async subscriber => {
    const subscriberId = db.parseEntityId(
      subscriber[db.Channel.Connections.Range]
    );
    return wsClient.send(subscriberId, {
      event: "channel_message",
      channelId: body.channelId,
      name,
      content
    });
  });

  await Promise.all(results);
  return success;
}

// oh my... this got out of hand refactor for sanity
async function broadcast(event, context) {
  // info from table stream, we'll learn about connections
  // disconnections, messages, etc
  // get all connections for channel of interest
  // broadcast the news
  const results = event.Records.map(async record => {
    switch (record.dynamodb.Keys[db.Primary.Key].S.split("|")[0]) {
      // Connection entities
      case db.Connection.Entity:
        break;

      // Channel entities (most stuff)
      case db.Channel.Entity:
        // figure out what to do based on full entity model

        // get secondary ENTITY| type by splitting on | and looking at first part
        switch (record.dynamodb.Keys[db.Primary.Range].S.split("|")[0]) {
          // if we are a CONNECTION
          case db.Connection.Entity: {
            let eventType = "sub";
            if (record.eventName === "REMOVE") {
              eventType = "unsub";
            } else if (record.eventName === "UPDATE") {
              // currently not possible, and not handled
              break;
            }

            // A connection event on the channel
            // let all users know a connection was created or dropped
            const channelId = db.parseEntityId(
              record.dynamodb.Keys[db.Primary.Key].S
            );
            const subscribers = await db.fetchChannelSubscriptions(channelId);
            const results = subscribers.map(async subscriber => {
              const subscriberId = db.parseEntityId(
                subscriber[db.Channel.Connections.Range]
              );
              return wsClient.send(
                subscriberId, // really backwards way of getting connection id
                {
                  event: `subscriber_${eventType}`,
                  channelId,

                  // sender of message "from id"
                  subscriberId: db.parseEntityId(
                    record.dynamodb.Keys[db.Primary.Range].S
                  )
                }
              );
            });

            await Promise.all(results);
            break;
          }

          // If we are a MESSAGE
          case db.Message.Entity: {
            if (record.eventName !== "INSERT") {
              return success;
            }

            // We could do interesting things like see if this was a bot
            // or other system directly adding messages to the dynamodb table
            // then send them out, otherwise assume it was already blasted out on the sockets
            // and no need to send it again!
            break;
          }
          default:
            break;
        }

        break;
      default:
        break;
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

async function channelManager(event, context) {
  const action = JSON.parse(event.body).action;
  switch (action) {
    case "subscribeChannel":
      await subscribeChannel(event, context);
      break;
    case "unsubscribeChannel":
      await unsubscribeChannel(event, context);
      break;
    default:
      break;
  }

  return success;
}

async function subscribeChannel(event, context) {
  const channelId = JSON.parse(event.body).channelId;
  await db.Client.put({
    TableName: db.Table,
    Item: {
      [db.Channel.Connections.Key]: `${db.Channel.Prefix}${channelId}`,
      [db.Channel.Connections.Range]: `${db.Connection.Prefix}${
        db.parseEntityId(event)
      }`
    }
  }).promise();

  // Instead of broadcasting here we listen to the dynamodb stream
  // just a fun example of flexible usage
  // you could imagine bots or other sub systems broadcasting via a write the db
  // and then streams does the rest
  return success;
}

async function unsubscribeChannel(event, context) {
  const channelId = JSON.parse(event.body).channelId;
  const item = await db.Client.delete({
    TableName: db.Table,
    Key: {
      [db.Channel.Connections.Key]: `${db.Channel.Prefix}${channelId}`,
      [db.Channel.Connections.Range]: `${db.Connection.Prefix}${
        db.parseEntityId(event)
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
  unsubscribeChannel,
  channelManager
};
