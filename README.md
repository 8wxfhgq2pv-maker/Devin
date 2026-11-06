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

需要 Node.js `>=22.19.0` 和 npm 10+。Gateway 客户端依赖与协议包固定为 `2026.10.10`（精确锁定，不用 `^`；升级时需连 Gateway 版本一起验证）。

```bash
npm install
cp backend/.env.example backend/.env
# 编辑 backend/.env：必须设置 Web UI 登录密码和随机会话密钥，并设置 Gateway URL/凭据
npm run dev
```

前端地址 `http://localhost:5173`，后端只监听本机回环地址 `http://127.0.0.1:3001`。首次连接可能需要在 Gateway 主机上用 `openclaw devices list` 检查并批准待配对设备。后端状态文件默认写入后端工作目录下的 `backend/.data/openclaw-device.json`（可用 `OPENCLAW_STATE_PATH` 覆盖），该目录已加入 gitignore。

## 配置

| 变量 | 用途 |
| --- | --- |
| `PORT` | 后端监听端口，默认 `3001` |
| `WEBUI_PASSWORD` | 必填，单用户 Web UI 登录密码，至少 12 个字符 |
| `WEBUI_SESSION_SECRET` | 必填，HMAC 会话签名密钥，至少 32 个字符；可用 `openssl rand -base64 48` 生成 |
| `WEBUI_SECURE_COOKIE` | HTTPS 部署设为 `true`，启用 Secure Cookie |
| `WEBUI_PUBLIC_ORIGIN` | 可选，精确的公开站点 origin（例如 `https://console.example`）；当代理把上游 `Host` 改为后端地址时必须设置 |
| `OPENCLAW_URL` | Gateway WebSocket 地址，例如 `ws://127.0.0.1:18789` 或远程 `wss://...` |
| `OPENCLAW_TOKEN` | Gateway token（推荐） |
| `OPENCLAW_PASSWORD` | 仅在 Gateway 使用 password 鉴权时配置 |
| `OPENCLAW_STATE_PATH` | 设备身份和签发 token 的持久化路径 |

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:080c61e0050edf2423c5c52ba2425f196eccc33e7be85017ea50a813ae5e1382 -->

前端开发服务器和 `npm run preview -w frontend` 预览都会把 `/api` 代理到 `BACKEND_URL`（默认 `http://localhost:3001`）。 两个代理都保留浏览器的 `Host`，以便默认 Origin 校验正常工作。

按浏览器 IP 限流时，在启动后端和 Vite 的进程环境中设置相同的 `WEBUI_PROXY_SECRET`（至少 32 个随机字符；不要使用 `VITE_` 前缀或提交密钥）。例如在同一 shell 中导出该变量后执行 `npm run dev`；预览流程也需要向后端和 `npm run preview -w frontend` 提供该变量。Vite 会覆盖传入的转发 IP 和代理认证头，仅传递其 socket 对端 IP。后端只接受携带匹配密钥的 loopback 代理请求中的单个 IP；其他请求均使用 socket IP。未配置该密钥时，通过同一代理的请求共享限流桶。其他反向代理需在本机终止连接、覆盖这些头并安全注入该密钥；不能直接传递客户端提供的头。

<!-- /coderabbit-ai-generated:v1 -->

后端仅绑定 loopback。Web UI 使用单用户密码登录、12 小时 HttpOnly/SameSite=Strict 签名会话 Cookie；写请求校验 Origin 并拒绝跨站请求，登录和 API 请求有按 IP 限流。示例密码与签名密钥均留空，必须替换为真实值后后端才会启动。使用反向代理远程部署时，必须启用 HTTPS、设置 `WEBUI_SECURE_COOKIE=true` 并在代理层配置额外访问控制。若代理会重写上游 `Host`，配置 `WEBUI_PUBLIC_ORIGIN` 为浏览器地址中的精确 scheme/host/port；服务只信任此显式配置，不使用客户端可伪造的 `X-Forwarded-Host`。不要直接将服务暴露到公网。远程 Gateway 应启用 TLS（`wss://`）。Gateway token 和会话密钥不得提交或放入前端环境变量。语音识别依赖浏览器 Web Speech API，支持情况因浏览器而异；识别服务由浏览器或操作系统提供，部分实现可能使用在线服务。朗读使用系统或浏览器提供的中文语音。

## API

- `GET /api/health` — 后端存活检查
- `POST /api/auth/login` — 使用 `WEBUI_PASSWORD` 登录并设置会话 Cookie
- `GET /api/auth/session` — 检查当前会话
- `POST /api/auth/logout` — 清除当前会话
- `GET /api/openclaw/status` — Gateway 连接状态
- `POST /api/openclaw/connect` — 建立 Gateway 连接（设备配对可能需要人工批准）
- `GET /api/openclaw/sessions` — 会话列表
- `POST /api/openclaw/sessions` — 新建会话
- `GET /api/openclaw/history?sessionKey=...` — 会话历史
- `POST /api/openclaw/messages` — 发送消息
- `POST /api/openclaw/abort` — 中止当前会话正在生成的回复
- `GET /api/openclaw/events?sessionKey=...` — SSE 事件流：`projection` 为权威会话视图（后端用官方投影 reducer 维护），`connection.*` 为连接状态

构建、类型检查、Lint 和测试：`npm run build`、`npm run typecheck`、`npm run lint`、`npm test`。GitHub Actions 会在每次 push 和 PR 时跑这四项。
