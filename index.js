'use strict';
const _ = require('lodash');
const BbPromise = require('bluebird');

class ServerlessWebsocketsPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;

    this.provider = this.serverless.getProvider('aws')

    this.functions = {}

    this.hooks = {
      'after:deploy:deploy': this.registerWebsockets.bind(this),
      'after:remove:remove': this.removeWebsockets.bind(this),
    };
  }

  // Gathers the functions with `websocket` events.
  prepareFunctions() {
    Object.keys(this.serverless.service.functions).map(
      (name) => {
        const func = this.serverless.service.functions[name]
        if (func.events && func.events.find((event) => event.websockets)) {
          this.functions[name] = func
        }
      }
    )
  }

  registerWebsockets() {
    this.prepareFunctions()

    if (Object.keys(this.functions).length == 0) {
      return BbPromise.resolve()
    }

    return this.getOrCreateWebsocketApi()
      .then((params) => getOrCreateLambdaPermissions)
      .then((params) => getOrCreateIntegration)
      .then((params) => getOrCreateRoute)
      .catch((err) => {
        console.log(err)
      })
  }

  // TODO
  removeWebsockets() {}

  getOrCreateWebsocketApi() {
    const websocketApiName = this.getWebsocketApiName()

    return this.provider.request('ApiGatewayV2', 'getApis', {})
      .then((data) => {
        const restApi = data.Items.find(api => api.name === websocketApiName)
        if (restApi) {
          return BbPromise.resolve(restApi)
        }
        const params = {
          Name: websocketApiName,
          ProtocolType: 'WEBSOCKET',
          RouteSelectionExpression: this.getWebsocketApiRouteSelectionExpression()
        }
        return this.provider.request('ApiGatewayV2', 'createApi', params)
      })
      .catch((err) => {
        throw new this.serverless.classes.Error(
          `Could not create websocket API. Error: ${err.message}`
        )
      })
  }

  getWebsocketApiName() {
    if (this.serverless.service.provider.websocketApiName &&
        _.isString(this.serverless.service.provider.websocketApiName)) {
      return `${this.serverless.service.provider.websocketApiName}`;
    }
    return `${this.provider.getStage()}-${this.serverless.service.service}`;
  }

  getWebsocketApiRouteSelectionExpression() {
    if (this.serverless.service.provider.websocketApiRouteSelectionExpression&&
        _.isString(this.serverless.service.provider.websocketApiRouteSelectionExpression)) {
      return `${this.serverless.service.provider.websocketApiRouteSelectionExpression}`;
    }
    return `$request.body.action`
  }
}

module.exports = ServerlessWebsocketsPlugin;
