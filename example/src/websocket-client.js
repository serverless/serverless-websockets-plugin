const AWS = require("aws-sdk");
const db = require("./db")

class Client {
    constructor(config){
        this.client;
        if(config){
            this._setupClient(config)
        }
    }

    // allow just passing a single event to setup the client for ease of use
    async _setupClient(config){
        // fetch config from db if none provided and we do not have a client
        if(typeof config !== 'object' && !this.client){
            const item = await db.Client.get({
                TableName: db.Table,
                Key: {
                    [db.Primary.Key]: 'APPLICATION',
                    [db.Primary.Range]: 'WS_CONFIG'
                }
            }).promise();
            console.log(item)
            config = item.Item;
            config.fromDb = true;
        }

        if(!this.client){
            
            if(config.requestContext.apiId){
                config.requestContext.domainName  = `${config.requestContext.apiId}.execute-api.${process.env.API_REGION}.amazonaws.com`
            }
          
            this.client = new AWS.ApiGatewayManagementApi({
                apiVersion: "2018-11-29",
                endpoint: `https://${config.requestContext.domainName}/${config.requestContext.stage}`
            });

            // temporarily we update dynamodb with most recent info
            // after CF support this can go away, we just do this so a single deployment makes this work
            if(config.fromDb !== true){
                await db.Client.put({
                    TableName: db.Table,
                    Item: {
                        [db.Primary.Key]: 'APPLICATION',
                        [db.Primary.Range]: 'WS_CONFIG',
                        requestContext: {
                            domainName: config.requestContext.domainName,
                            stage: config.requestContext.stage
                        }
                    }
                }).promise();
            }
        }
    }

    async send(connection, payload){
        // Cheat and allow event to be passed in
        // this also lets us default to setupClient too
        await this._setupClient(connection)

        let ConnectionId = connection;
        if(typeof connection === 'object'){
            ConnectionId = connection.requestContext.connectionId;
        }

        console.log(connection, payload)
        await this.client.postToConnection({
            ConnectionId,
            Data: JSON.stringify(payload)
        }).promise().catch(err => {
            console.log(JSON.stringify(err))
        });

        return true;
    }
}

module.exports = {
    Client
}
