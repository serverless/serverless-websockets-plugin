const { is, map, all, filter, keys, isEmpty, flatten } = require('@serverless/utils')
const chalk = require('chalk')

class ServerlessWebsocketsPlugin {
  constructor(serverless, options) {
    this.serverless = serverless
    this.options = options
    this.provider = this.serverless.getProvider('aws')

    this.authorizers = {} // to be filled later...
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
    this.stage = this.provider.getStage()
    this.region = this.provider.getRegion()
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
    // We clear routes before deploying the new routes for idempotency
    // since we lost the idempotency feature of CF
    await this.clearRoutes()
    await this.clearAuthorizers()
    await this.clearIntegrations()
    await this.createAuthorizers()
    await this.createRoutes()
    await this.createDeployment()
    this.serverless.cli.log(
      `Websockets API named "${this.apiName}" with ID "${this.apiId}" has been deployed.`
    )
    this.serverless.cli.log(`  Websocket URL: ${this.getWebsocketUrl()}`)
  }

  canNotFindOutputError(outputKey, stackName) {
    this.serverless.cli.log(`${this.constructor.name}Error`)
    throw new Error(`Can not find "${outputKey}" Output in "${stackName}" Stack`)
  }

  async prepareFunctions() {
    const stackName = this.provider.naming.getStackName()
    // get a list of CF outputs...
    const res = await this.provider.request('CloudFormation', 'describeStacks', {
      StackName: stackName
    })
    const outputs = res.Stacks[0].Outputs

    keys(this.serverless.service.functions || {}).map((name) => {
      const func = this.serverless.service.functions[name]
      if (func.events && func.events.find((event) => event.websocket)) {
        // find the arn of this function in the list of outputs...
        const outputKey = this.provider.naming.getLambdaVersionOutputLogicalId(name)
        const outputFounded = outputs.find((output) => output.OutputKey === outputKey)

        if (!outputFounded) {
          this.canNotFindOutputError(outputKey, stackName)
        }

        const arn = outputFounded.OutputValue

        // get list of route keys configured for this function
        const routes = map((e) => {
          if (e.websocket.authorizer && e.websocket.authorizer.name && !this.authorizers[e.websocket.authorizer.name]) {
            const authorizerOutputKey = this.provider.naming.getLambdaVersionOutputLogicalId(e.websocket.authorizer.name)
            const authorizer =
            {
              arn: e.websocket.authorizer.arn,
              identitySource: e.websocket.authorizer.identitySource,
              name: e.websocket.authorizer.name
            }

            if (!authorizer.arn) {
              const authorizerOutput = outputs.find((output) => output.OutputKey === authorizerOutputKey)

              if (!authorizerOutput) {
                this.canNotFindOutputError(authorizerOutputKey, stackName)
              }

              authorizer.arn = authorizerOutput.OutputValue
            }
            if (typeof authorizer.identitySource == 'string') {
              authorizer.identitySource = map((identitySource) => identitySource.trim(), authorizer.identitySource.split(','))
            }
            this.authorizers[e.websocket.authorizer.name] = authorizer;
          }
          return e.websocket
        }, filter((e) => e.websocket && e.websocket.routeKey, func.events))

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

  async createRouteResponse(routeId, routeResponseKey) {
    const params = {
      ApiId: this.apiId,
      RouteId: routeId,
      RouteResponseKey: routeResponseKey
    }

    return await this.provider.request('ApiGatewayV2', 'createRouteResponse', params)
  }

  async createRoute(integrationId, route) {
    const params = {
      ApiId: this.apiId,
      RouteKey: route.routeKey,
      Target: `integrations/${integrationId}`
    }
    if (route.authorizer && route.authorizer.name) {
      params.AuthorizationType = 'CUSTOM'
      params.AuthorizerId = this.authorizers[route.authorizer.name].authorizerId
    }
    if (route.routeResponseSelectionExpression) {
      params.RouteResponseSelectionExpression = route.routeResponseSelectionExpression
    }

    const res = await this.provider.request('ApiGatewayV2', 'createRoute', params).catch((e) => {
      if (e.providerError.code !== 'ConflictException') {
        throw e
      }
    })

    if (route.routeResponseSelectionExpression) {
      await this.createRouteResponse(res.RouteId, '$default')
    }

    return res
  }

  async clearAuthorizers() {
    const res = await this.provider.request('ApiGatewayV2', 'getAuthorizers', { ApiId: this.apiId })
    return all(
      map(
        (authorizer) =>
          this.provider.request('ApiGatewayV2', 'deleteAuthorizer', {
            ApiId: this.apiId,
            AuthorizerId: authorizer.AuthorizerId
          }),
        res.Items
      )
    )
  }

  async createAuthorizer(authorizer) {
    const params = {
      ApiId: this.apiId,
      AuthorizerType: 'REQUEST',
      AuthorizerUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${authorizer.arn}/invocations`,
      IdentitySource: authorizer.identitySource,
      Name: authorizer.name
    }
    const res = await this.provider.request('ApiGatewayV2', 'createAuthorizer', params)
    authorizer.authorizerId = res.AuthorizerId
  }

  async createAuthorizers() {
    const authorizerPromises = map(async (authorizerName) => {
        const authorizer = this.authorizers[authorizerName]
        await this.addPermission(authorizer.arn)
        return this.createAuthorizer(authorizer)
    }, keys(this.authorizers))
    await all(authorizerPromises)
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

  async clearIntegrations() {
    const res = await this.provider.request('ApiGatewayV2', 'getIntegrations', { ApiId: this.apiId })
    return all(
      map(
        (integration) =>
          this.provider.request('ApiGatewayV2', 'deleteIntegration', {
            ApiId: this.apiId,
            IntegrationId: integration.IntegrationId
          }),
        res.Items
      )
    )
  }

  async createRoutes() {
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
    const routes = flatten(map((fn) => fn.routes.routeKey, this.functions))
    this.serverless.cli.consoleLog(chalk.yellow('WebSockets:'))
    this.serverless.cli.consoleLog(`  ${chalk.yellow('Base URL:')} ${baseUrl}`)
    this.serverless.cli.consoleLog(chalk.yellow('  Routes:'))
    map((route) => this.serverless.cli.consoleLog(`    - ${baseUrl}${route}`), routes)
  }
}

module.exports = ServerlessWebsocketsPlugin
