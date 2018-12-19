const { is, find, propEq, map, filter, keys } = require('ramda')
const BbPromise = require('bluebird')

class ServerlessWebsocketsPlugin {
  constructor(serverless, options) {
    this.serverless = serverless
    this.options = options
    this.provider = this.serverless.getProvider('aws')

    this.stage = this.provider.getStage()
    this.region = this.provider.getRegion()
    this.apiName = this.getWebsocketApiName()
    this.routeSelectionExpression = this.getWebsocketApiRouteSelectionExpression()
    this.functions = []

    this.hooks = {
      'after:deploy:deploy': this.deployWebsockets.bind(this),
      'after:remove:remove': this.removeWebsockets.bind(this)
    }
  }

  getWebsocketApiName() {
    if (
      this.serverless.service.provider.websocketApiName &&
      is(String, this.serverless.service.provider.websocketApiName)
    ) {
      return `${this.serverless.service.provider.websocketApiName}`
    }
    return `${this.serverless.service.service}-${this.provider.getStage()}-websockets-api`
  }

  getWebsocketApiRouteSelectionExpression() {
    if (
      this.serverless.service.provider.websocketApiRouteSelectionExpression &&
      is(String, this.serverless.service.provider.websocketApiRouteSelectionExpression)
    ) {
      return `${this.serverless.service.provider.websocketApiRouteSelectionExpression}`
    }
    return `$request.body.action`
  }

  async deployWebsockets() {
    await this.prepareFunctions()
    await this.createApi()
    await this.createRoutes()
    await this.createDeployment()
  }

  async prepareFunctions() {
    if (keys(this.functions).length === 0) {
      return
    }
    const outputs = {} // todo get from CF outputs
    keys(this.serverless.service.functions).map((name) => {
      const func = this.serverless.service.functions[name]
      if (func.events && func.events.find((event) => event.websocket)) {
        // get list of route keys configured for this function
        const routes = map((e) => e.websocket.routeKey, filter((e) => e.websocket, func.events))
        const fn = {
          arn: outputs.arn,
          routes
        }
        this.functions.push(fn)
      }
    })
  }

  async getApi() {
    const resApis = await this.provider.request('ApiGatewayV2', 'getApis', {})
    // todo what if existing api is not valid websocket api?
    const restApi = find(propEq('Name', this.apiName))(resApis.Items)
    return restApi ? restApi.ApiId : null
  }

  async createApi() {
    let apiId = await this.getApi()
    if (!apiId) {
      const params = {
        Name: this.apiName,
        ProtocolType: 'WEBSOCKET',
        RouteSelectionExpression: this.routeSelectionExpression
      }

      const res = await this.provider.request('ApiGatewayV2', 'createApi', params)
      apiId = res.ApiId
    }
    this.apiId = apiId
    return apiId
  }

  async createIntegration(arn) {
    const params = {
      ApiId: this.apiId,
      IntegrationMethod: 'POST',
      IntegrationType: 'AWS_PROXY',
      IntegrationUri: `arn:aws:apigateway:${
        this.region
      }:lambda:path/2015-03-31/functions/${arn}/invocations`
    }
    // integration creation overwrites existing identical integration
    // so we don't need to check for existance
    const res = await this.provider.request('ApiGatewayV2', 'createIntegration', params)
    return res.IntegrationId
  }

  async addPermission(arn) {
    const functionName = arn.split(':')[6]
    const accountId = arn.split(':')[4]
    const region = arn.split(':')[3]

    const params = {
      Action: 'lambda:InvokeFunction',
      FunctionName: arn,
      Principal: 'apigateway.amazonaws.com',
      SourceArn: `arn:aws:execute-api:${region}:${accountId}:${this.apiId}/*/*`,
      StatementId: `${functionName}-websocket`
    }

    try {
      await this.provider.request('ApiGatewayV2', 'addPermission', params)
    } catch (e) {
      if (e.code !== 'ResourceConflictException') {
        throw e
      }
    }
  }

  async createRoute(integrationId, route) {
    const params = {
      ApiId: this.apiId,
      RouteKey: route,
      Target: `integrations/${integrationId}`
    }
    try {
      await this.provider.request('ApiGatewayV2', 'createRoute', params)
    } catch (e) {
      if (e.code !== 'ConflictException') {
        throw e
      }
    }
  }

  async createRoutes() {
    const integrationsPromises = map(async (fn) => {
      const integrationId = await this.createIntegration(fn.arn)
      await this.addPermission(fn.arn)
      const routesPromises = map(
        (route) => this.createRoute(this.apiId, integrationId, route),
        fn.routes
      )
      return BbPromise.all(routesPromises)
    }, this.functions)

    await BbPromise.all(integrationsPromises)
  }

  async createDeployment() {
    const { DeploymentId } = await this.provider.request('ApiGatewayV2', 'createDeployment', {
      ApiId: this.apiId
    })
    const params = {
      ApiId: this.apiId,
      StageName: this.stage,
      DeploymentId
    }
    try {
      await this.provider.request('ApiGatewayV2', 'updateStage', params)
    } catch (e) {
      if (e.code === 'NotFoundException') {
        await this.provider.request('ApiGatewayV2', 'createStage', params)
      }
    }
  }

  // todo
  async removeWebsockets() {}
}

module.exports = ServerlessWebsocketsPlugin
