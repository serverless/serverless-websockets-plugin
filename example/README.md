# General

# Architecture

- API Gateway websockets
- Lambda
- DynamoDB
- DynamoDB Streams (just to demo some durability)

# Chat Protocol

### Connect

`npm i -g wscat` - to install WebSocket cat

`wscat -c wss://{ApiId}.execute-api.us-east-1.amazonaws.com/{ApiStage}`

### Messages

`{"action": "sendMessage", "name": "johndoe", "channelId": "General", "content": "hello world!"}`

### Channel Subscriptions

`{"action": "subscribeChannel", "channelId": "Secret"}`
`{"action": "unsubscribeChannel", "channelId": "Secret"}`

### Get channel history

(coming soon)
