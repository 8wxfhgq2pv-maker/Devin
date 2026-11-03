# OpenClaw Web UI

一个独立于 OpenClaw 内置 Control UI 的自定义 Web 控制台。当前版本通过官方 Gateway WebSocket 客户端读取真实会话和历史，并发送消息、接收流式回复。

## 功能

- 最近会话列表和新建会话
- 从 Gateway 加载真实聊天历史
- 通过 `chat.send` 发送消息，使用 Gateway `chat` / `agent` 事件实时更新回复
- 浏览器语音识别转写到输入框，用户确认后发送；可开启设备端朗读回复
- 后端持有 Gateway 凭据；浏览器不直接接触 Gateway token
- 后端保存设备身份和 Gateway 签发的设备 token，后续连接可复用配对

## 启动

需要 Node.js `>=22.19.0` 和 npm 10+。Gateway 客户端依赖与协议包固定为 `2026.8.1`。

```bash
npm install
cp backend/.env.example backend/.env
# 编辑 backend/.env，设置 Gateway URL 和 token 或 password
npm run dev
```

前端地址 `http://localhost:5173`，后端只监听本机回环地址 `http://127.0.0.1:3001`。首次连接可能需要在 Gateway 主机上用 `openclaw devices list` 检查并批准待配对设备。后端状态文件默认写入后端工作目录下的 `backend/.data/openclaw-device.json`（可用 `OPENCLAW_STATE_PATH` 覆盖），该目录已加入 gitignore。

## 配置

| 变量 | 用途 |
| --- | --- |
| `PORT` | 后端监听端口，默认 `3001` |
| `OPENCLAW_URL` | Gateway WebSocket 地址，例如 `ws://127.0.0.1:18789` 或远程 `wss://...` |
| `OPENCLAW_TOKEN` | Gateway token（推荐） |
| `OPENCLAW_PASSWORD` | 仅在 Gateway 使用 password 鉴权时配置 |
| `OPENCLAW_STATE_PATH` | 设备身份和签发 token 的持久化路径 |

前端开发服务器和 `npm run preview -w frontend` 预览都会把 `/api` 代理到 `BACKEND_URL`（默认 `http://localhost:3001`）。

仅在 loopback 或受信任私有网络中使用。远程 Gateway 应启用 TLS（`wss://`）。不要将 token 提交到仓库或放入前端环境变量。当前本地 Web UI 尚未提供用户登录；不要直接暴露到公网。语音识别依赖浏览器 Web Speech API，支持情况因浏览器而异；识别服务由浏览器或操作系统提供，部分实现可能使用在线服务。朗读使用系统或浏览器提供的中文语音。

## API

- `GET /api/health` — 后端存活检查
- `GET /api/openclaw/status` — Gateway 连接状态
- `POST /api/openclaw/connect` — 建立 Gateway 连接（设备配对可能需要人工批准）
- `GET /api/openclaw/sessions` — 会话列表
- `POST /api/openclaw/sessions` — 新建会话
- `GET /api/openclaw/history?sessionKey=...` — 会话历史
- `POST /api/openclaw/messages` — 发送消息
- `POST /api/openclaw/abort` — 中止当前会话正在生成的回复
- `GET /api/openclaw/events?sessionKey=...` — SSE 事件流：`projection` 为权威会话视图（后端用官方投影 reducer 维护），`connection.*` 为连接状态

构建、类型检查、Lint 和测试：`npm run build`、`npm run typecheck`、`npm run lint`、`npm test`。GitHub Actions 会在每次 push 和 PR 时跑这四项。