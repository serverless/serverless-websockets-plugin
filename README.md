# Serverless Websockets Plugin

## Deprecation Notice
This repo is now deprecated, and we are no longer maintaining it. v1.38.0 of the framework now includes built-in support for websockets. [Please check the docs for more info](https://serverless.com/framework/docs/providers/aws/events/websocket/)

## 1. Installation
Install the plugin by adding it to your service dependencies:
```
npm i serverless-websockets-plugin --save
```

**Note:** Because this plugin uses the new `ApiGatewayV2` service in the AWS SDK, it requires v1.35.0+ of the Serverless Framework.

## 2. Usage
Load the `serverless-websockets-plugin`, then optionally provide a new API name and Route Selection Expression, and finally define your WebSockets events and their route keys:
```yml
service: serverless-websockets-service

# Load the plugin
plugins:
  - serverless-websockets-plugin

provider:
  name: aws
  runtime: nodejs8.10
  
  # Optional
  websocketApiName: foobar
  websocketApiRouteSelectionExpression: $request.body.action

functions:
  connectionManagement:
    handler: handler.connectionManagement
    events:
      - websocket:
          routeKey: $connect
      - websocket:
          routeKey: $disconnect
  defaultMessage:
    handler: handler.default
    events:
      - websocket:
          routeKey: $default
  chatMessage:
    handler: handler.chat
    events:
      - websocket:
          routeKey: message
  twoWayMessage:
    handler: handler.twoWay
    events:
      - websocket:
          routeKey: twoway
          # The property below will enable an integration response in the API Gateway.
          # See https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api-route-response.html
          routeResponseSelectionExpression: $default
```
