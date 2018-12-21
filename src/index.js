const { is, map, all, filter, keys, isEmpty, flatten } = require('@serverless/utils')
const chalk = require('chalk')

class ServerlessWebsocketsPlugin {
  constructor(serverless, options) {
    this.serverless = serverless
    this.options = options
    this.provider = this.serverless.getProvider('aws')

    this.stage = this.provider.getStage()
    this.region = this.provider.getRegion()
    this.functions = [] // to be filled later...

    this.hooks = {
      'after:deploy:deploy': this.deployWebsockets.bind(this), // todo change
      'after:remove:remove': this.removeWebsockets.bind(this),
      'after:info:info': this.displayWebsockets.bind(this)
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

  getWebsocketUrl() {
    return `wss://${this.apiId}.execute-api.${this.region}.amazonaws.com/${this.stage}/`
  }

  init() {
    this.apiName = this.getWebsocketApiName()
    this.routeSelectionExpression = this.getWebsocketApiRouteSelectionExpression()
  }

  async deployWebsockets() {
    this.init()
    await this.prepareFunctions()
    if (
      !is(Object, this.serverless.service.functions) ||
      keys(this.serverless.service.functions).length === 0 ||
      isEmpty(this.functions)
    ) {
      return
    }
    this.serverless.cli.log(`Deploying Websockets API named "${this.apiName}"...`)
    await this.createApi()
    await this.createRoutes()
    await this.createDeployment()
    this.serverless.cli.log(
      `Websockets API named "${this.apiName}" with ID "${this.apiId}" has been deployed.`
    )
    this.serverless.cli.log(`  Websocket URL: ${this.getWebsocketUrl()}`)
  }

  async prepareFunctions() {
    // get a list of CF outputs...
    const res = await this.provider.request('CloudFormation', 'describeStacks', {
      StackName: this.provider.naming.getStackName()
    })
    const outputs = res.Stacks[0].Outputs

    keys(this.serverless.service.functions || {}).map((name) => {
      const func = this.serverless.service.functions[name]
      if (func.events && func.events.find((event) => event.websocket)) {
        // find the arn of this function in the list of outputs...
        const outputKey = this.provider.naming.getLambdaVersionOutputLogicalId(name)
        const arn = outputs.find((output) => output.OutputKey === outputKey).OutputValue

        // get list of route keys configured for this function
        const routes = map((e) => e.websocket.routeKey, filter((e) => e.websocket, func.events))

        const fn = {
          arn: arn,
          routes
        }
        this.functions.push(fn)
      }
    })
  }

  async getApi() {
    const apis = await this.provider.request('ApiGatewayV2', 'getApis', {})
    // todo what if existing api is not valid websocket api? or non existent?
    const websocketApi = apis.Items.find((api) => api.Name === this.apiName)
    this.apiId = websocketApi ? websocketApi.ApiId : null
    return this.apiId
  }

  async createApi() {
    await this.getApi()
    if (!this.apiId) {
      const params = {
        Name: this.apiName,
        ProtocolType: 'WEBSOCKET',
        RouteSelectionExpression: this.routeSelectionExpression
      }

      const res = await this.provider.request('ApiGatewayV2', 'createApi', params)
      this.apiId = res.ApiId
    }
    return this.apiId
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

    return this.provider.request('Lambda', 'addPermission', params).catch((e) => {
      if (e.providerError.code !== 'ResourceConflictException') {
        throw e
      }
    })
  }

  async createRoute(integrationId, route) {
    const params = {
      ApiId: this.apiId,
      RouteKey: route,
      Target: `integrations/${integrationId}`
    }

    return this.provider.request('ApiGatewayV2', 'createRoute', params).catch((e) => {
      if (e.providerError.code !== 'ConflictException') {
        throw e
      }
    })
  }

  async clearRoutes() {
    const res = await this.provider.request('ApiGatewayV2', 'getRoutes', { ApiId: this.apiId })
    return all(
      map(
        (route) =>
          this.provider.request('ApiGatewayV2', 'deleteRoute', {
            ApiId: this.apiId,
            RouteId: route.RouteId
          }),
        res.Items
      )
    )
  }

  async createRoutes() {
    // We clear routes before deploying the new routes for idempotency
    // since we lost the idempotency feature of CF
    await this.clearRoutes()

    const integrationsPromises = map(async (fn) => {
      const integrationId = await this.createIntegration(fn.arn)
      await this.addPermission(fn.arn)
      const routesPromises = map((route) => this.createRoute(integrationId, route), fn.routes)
      return all(routesPromises)
    }, this.functions)

    return all(integrationsPromises)
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

    return this.provider.request('ApiGatewayV2', 'updateStage', params).catch((e) => {
      if (e.providerError.code === 'NotFoundException') {
        return this.provider.request('ApiGatewayV2', 'createStage', params)
      }
    })
  }

  async removeWebsockets() {
    this.init()
    await this.getApi()
    if (!this.apiId) {
      return
    }

    this.serverless.cli.log(
      `Removing Websockets API named "${this.apiName}" with ID "${this.apiId}"`
    )
    return this.provider.request('ApiGatewayV2', 'deleteApi', { ApiId: this.apiId })
  }

  async displayWebsockets() {
    this.init()
    await this.prepareFunctions()
    if (isEmpty(this.functions)) {
      return
    }
    await this.getApi()
    const baseUrl = this.getWebsocketUrl()
    const routes = flatten(map((fn) => fn.routes, this.functions))
    this.serverless.cli.consoleLog(chalk.yellow('WebSockets:'))
    this.serverless.cli.consoleLog(`  ${chalk.yellow('Base URL:')} ${baseUrl}`)
    this.serverless.cli.consoleLog(chalk.yellow('  Routes:'))
    map((route) => this.serverless.cli.consoleLog(`    - ${baseUrl}${route}`), routes)
  }
}

module.exports = ServerlessWebsocketsPlugin
