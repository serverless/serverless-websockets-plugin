# Serverless Websockets Plugin

```yml

provider:
  websocketApiName: foobar
  websocketApiRouteSelectionExpression: $request.body.action

functions:
  connectionManagement:
    events:
      - websocket:
          routeKey: $connect
      - websocket:
          routeKey: $disconnect
   defaultMessage:
     events:
       - websocket:
           routeKey: $default
   chatMessage:
     events:
       - websocket:
           routeKey: message
```
