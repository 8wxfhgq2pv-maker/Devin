# OpenClaw Web UI

为 [OpenClaw](https://github.com/openclaw/openclaw) 搭建的 Web UI 脚手架：

- `frontend/` — React + TypeScript（Vite）
- `backend/` — Node + Express，作为与 OpenClaw 通信的代理层
- `docs/openclaw-research.md` — OpenClaw 接入方式调研，以及**仍需确认的问题**

> 通过 OpenClaw Gateway WebSocket 协议 v4 接入：会话列表、对话（流式）、审批、实时事件。Gateway 凭据只保存在后端，浏览器通过后端的 REST + SSE 接口使用。接入细节见 [`docs/openclaw-research.md`](docs/openclaw-research.md)。

## 环境要求

- Node.js `>=22.19.0`（`@openclaw/gateway-client` 的要求；本机跑 OpenClaw Gateway 本身需要 Node `>=24.22.1`）
- npm 10+
- 一个可访问的 OpenClaw Gateway（已验证版本 `2026.10.7`）

## 本地启动

```bash
npm install
cp backend/.env.example backend/.env   # 填写 OPENCLAW_URL 和 OPENCLAW_TOKEN
npm run dev
```

### 首次连接：设备配对

后端启动后会自动连接 Gateway。首次连接时后端会生成一个 Ed25519 设备身份（保存在 `backend/.openclaw-state/`），Gateway 返回 `PAIRING_REQUIRED`，页面会显示配对请求 ID。在 Gateway 主机上批准：

```bash
openclaw devices list
openclaw devices approve <requestId>
```

批准后后端会在 5 秒内自动重连，Gateway 签发的设备 token 同样保存在 `backend/.openclaw-state/`（权限 0600，已加入 `.gitignore`），之后重启无需再次配对。删除该目录会生成新设备，需要重新配对。

- 前端：<http://localhost:5173>（`/api` 请求由 Vite 代理到后端）
- 后端：<http://localhost:3001>

单独启动：`npm run dev -w backend` / `npm run dev -w frontend`。

## 其他脚本

| 命令 | 说明 |
| --- | --- |
| `npm run build` | 构建前后端 |
| `npm run typecheck` | 前后端 TypeScript 类型检查 |
| `npm run start -w backend` | 运行构建后的后端 |

## 后端 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 后端健康检查 |
| GET | `/api/openclaw/status` | 连接状态（`not_configured` / `connecting` / `pairing_required` / `connected` / `error` 等），不含任何凭据 |
| POST | `/api/openclaw/connect` | （重新）连接 Gateway |
| POST | `/api/openclaw/disconnect` | 断开连接 |
| GET | `/api/openclaw/sessions` | 会话列表（`sessions.list`） |
| POST | `/api/openclaw/sessions` | 新建会话（`sessions.create`） |
| GET | `/api/openclaw/sessions/:key/messages` | 会话历史（`chat.history`），并订阅该会话的实时消息 |
| POST | `/api/openclaw/sessions/:key/messages` | 发送消息 `{ "message": "..." }`（`chat.send`），返回 `202 { runId }` |
| GET | `/api/openclaw/approvals` | 待处理审批 |
| POST | `/api/openclaw/approvals/:id/resolve` | 处理审批 `{ "decision": "allow-once" \| "allow-always" \| "deny" }` |
| GET | `/api/openclaw/events` | SSE 实时事件流（`status`、`sessions.changed`、`chat`、`session.message`、`approval`） |

未连接时业务接口返回 `409`，Gateway 报错返回 `502`。

## 配置

`backend/.env`（参考 `backend/.env.example`）：

| 变量 | 说明 |
| --- | --- |
| `PORT` | 后端端口，默认 `3001` |
| `OPENCLAW_URL` | Gateway WebSocket 地址，如 `ws://127.0.0.1:18789`（远程请用 `wss://`） |
| `OPENCLAW_TOKEN` | Gateway 共享 token（`gateway.auth.mode=token`），用于首次配对，不要提交 |
| `OPENCLAW_PASSWORD` | Gateway 密码（`gateway.auth.mode=password` 时使用） |
| `OPENCLAW_STATE_DIR` | 设备身份与设备 token 的存放目录，默认 `backend/.openclaw-state` |

> 本 Web UI 自身没有登录鉴权，任何能访问它的人都能以已配对设备的身份操作 Gateway。请只在本机或受信网络中运行。
