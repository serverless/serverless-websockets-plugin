const AWS = require("aws-sdk");
class Client {
    constructor(config){
        this.client;
        if(config){
            this._setupClient(config)
        }
    }

    // allow just passing a single event to setup the client for ease of use
    _setupClient(config){
        if(!this.client){
            this.client = new AWS.ApiGatewayManagementApi({
                apiVersion: "2018-11-29",
                endpoint: `https://${config.requestContext.domainName}/${config.requestContext.stage}`
            })
        }
    }

    async send(connection, payload){
        // Cheat and allow event to be passed in
        // this also lets us default to setupClient too
        if(!this.client && typeof connection !== 'object'){
            throw new Error("This client requires you to either pass event for connection information or _setupClient before usage!")
        } else if (!this.client) {
            this._setupClient(connection)
        }

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