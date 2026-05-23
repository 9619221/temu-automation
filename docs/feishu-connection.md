# Feishu Connection

## Recommended Path

Feishu is a better stable entry point than personal WeChat for notifications and command workflows.

Use two stages:

1. Custom bot webhook: task completion, errors, daily reports, and other outbound notifications.
2. Feishu app bot with event subscriptions: receive user commands in Feishu and dispatch local Codex or automation tasks.

This repository implements stage 1.

## Configure A Custom Bot

Add a custom bot to a Feishu group and copy its webhook URL. If signature verification is enabled, also copy the signing secret.

Add this to `cloud/.env`:

```bash
FEISHU_BOT_WEBHOOK=https://open.feishu.cn/open-apis/bot/v2/hook/xxxx
FEISHU_BOT_SECRET=xxxx
```

`FEISHU_BOT_SECRET` may be empty, but signature verification is recommended for production.

## Start The Server

```bash
cd cloud
npm install
npm run dev
```

Log in and get a JWT:

```bash
curl -X POST http://localhost:8788/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"changeme123"}'
```

Test the Feishu connection:

```bash
TOKEN="token from the previous step"

curl -X POST http://localhost:8788/api/notify/v1/feishu/test \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"Feishu connection test"}'
```

Send a custom notification:

```bash
curl -X POST http://localhost:8788/api/notify/v1/feishu/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Collection complete","text":"Today tasks finished","fields":{"status":"ok"}}'
```

You can also send directly from the repository root:

```bash
node scripts/feishu-notify.cjs "Feishu connection test" "From local script"
```

## Future Two-Way Commands

Custom bots can only send webhook notifications. They cannot receive group messages from users.

For commands such as `@bot run collection`, create a Feishu internal app, enable bot capability and event subscriptions, subscribe to message receive events, then translate those callback events into internal tasks.
