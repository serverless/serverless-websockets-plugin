# Serverless Websockets Plugin

## 1. Installation
Install the plugin by adding it to your service dependencies:
```
npm i serverless-websockets-plugin --save
```

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
```
