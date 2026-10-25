# OpenClaw 接入调研

> 调研日期：2026-10-25。资料来源：上游仓库 [openclaw/openclaw](https://github.com/openclaw/openclaw)（commit `dd60cbc`，2026-10-24，版本 `2026.10.7`）中的 `docs/` 目录，以及官方文档站 <https://docs.openclaw.ai>。
> 标注说明：**[已核实]** 直接来自官方文档/源码；**[推断]** 为基于资料的判断；**[待确认]** 需要用户补充。

## 1. OpenClaw 是什么

**[已核实]** 名为 "OpenClaw" 的公开项目至少有两个：

| 项目 | 说明 | 与本仓库的关系 |
| --- | --- | --- |
| [openclaw/openclaw](https://github.com/openclaw/openclaw) | 开源、可自托管的个人 AI 助手（TypeScript，MIT，约 39 万 star，官网 <https://openclaw.ai>）。核心是一个常驻的 **Gateway** 进程，接入 Discord / Slack / Telegram / WhatsApp 等 20+ 聊天渠道，并提供 macOS / iOS / Android / Windows / Linux 客户端。 | 用户 GitHub 账号下有它的 fork：[8wxfhgq2pv-maker/openclaw](https://github.com/8wxfhgq2pv-maker/openclaw) |
| [pjasicek/OpenClaw](https://github.com/pjasicek/OpenClaw) | 《Captain Claw》(1997) 平台游戏的 C++ 重制版，2022 年后无更新，无网络/API 接口。 | 无 |

**[推断]** 由于用户账号下 fork 了 `openclaw/openclaw`，本文档假定目标是该 AI 助手项目。**[待确认]** 见第 6 节问题 Q1。

关于用户的 fork **[已核实]**：版本 `2026.7.2`，最后一次提交 2026-07-19，无自有提交，落后上游约 48,000 个 commit。fork 与上游当前都使用 Gateway 协议 **v4**（`packages/gateway-protocol/src/version.ts` 中 `PROTOCOL_VERSION = 4`）。

## 2. 架构要点

**[已核实]**（[`docs/gateway/index.md`](https://github.com/openclaw/openclaw/blob/main/docs/gateway/index.md)）

- 一个常驻 Gateway 进程负责路由、控制面和渠道连接，启动方式：`openclaw gateway --port 18789`。
- **单端口复用**（默认 `18789`）：WebSocket 控制/RPC、HTTP API、插件 HTTP 路由、内置 Control UI、hooks 都在同一个端口上。
- 默认只绑定 `loopback`（容器内默认 `auto`）。
- **默认必须鉴权**：`gateway.auth.mode` 可为 `token` / `password` / `trusted-proxy` / `none`；环境变量 `OPENCLAW_GATEWAY_TOKEN` / `OPENCLAW_GATEWAY_PASSWORD`。
- OpenClaw **已自带一个 Web 控制台**（Control UI，Vite + Solid），由 Gateway 在 `http://<host>:18789/` 提供，直接通过 WebSocket 与 Gateway 通信（[`docs/web/control-ui.md`](https://github.com/openclaw/openclaw/blob/main/docs/web/control-ui.md)）。

## 3. 可供 Web UI 接入的接口

### 3.1 Gateway WebSocket 协议（主控制面）

**[已核实]**（[`docs/gateway/protocol.md`](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)、[`docs/gateway/clients.md`](https://github.com/openclaw/openclaw/blob/main/docs/gateway/clients.md)）

- 地址：`ws://<host>:18789`，文本帧 + JSON；帧类型 `req` / `res` / `event`。
- 握手流程：
  1. Gateway 推送 `connect.challenge` 事件（`nonce`、`ts`）。
  2. 客户端第一帧必须是 `connect` 请求：`minProtocol`/`maxProtocol`（当前为 4）、`client` 信息、`role`（Web UI 用 `operator`）、`scopes`、`auth`（共享 token/password）、`device`（Ed25519 设备身份签名）。
  3. Gateway 返回 `hello-ok`：协议版本、`features.methods/events`、`snapshot`、`auth`（协商后的 role/scopes，以及可能的 `deviceToken`）、`policy`（最大负载等）。
- 设备配对：首次连接可能返回 `PAIRING_REQUIRED`，需在 Gateway 主机上执行 `openclaw devices list` / `openclaw devices approve <requestId>`；之后保存 `hello-ok.auth.deviceToken` 复用。
- 权限范围（[`docs/gateway/operator-scopes.md`](https://github.com/openclaw/openclaw/blob/main/docs/gateway/operator-scopes.md)）：聊天客户端通常需要 `operator.read`（`chat.history`、`sessions.list`、`sessions.subscribe` 等）、`operator.write`（`chat.send` 等）、`operator.approvals`（审批）；`operator.admin` 仅用于管理操作（如 `config.patch`）。
- 方法覆盖：状态、渠道、模型、聊天、agent、会话、节点、审批、配置等完整 Gateway API。
- 官方 npm 包：
  - [`@openclaw/gateway-protocol`](https://www.npmjs.com/package/@openclaw/gateway-protocol)：schema、校验器、TS 类型、版本常量，附带 `protocol.schema.json`。
  - [`@openclaw/gateway-client`](https://www.npmjs.com/package/@openclaw/gateway-client)：参考客户端；包根为 Node 客户端（内置 `ws`），`@openclaw/gateway-client/browser` 为浏览器入口。
  - 文档标注的“已验证稳定版”为 `2026.8.1`（导出 wire v4）；npm 上 `latest` 为 `2026.10.7`。官方要求客户端与 Gateway 版本**精确锁定并一起测试**；包要求 Node `>=22.19.0`。

### 3.2 OpenAI 兼容 HTTP API

**[已核实]**（[`docs/gateway/openai-http-api.md`](https://github.com/openclaw/openclaw/blob/main/docs/gateway/openai-http-api.md)）

- `GET /v1/models`、`GET /v1/models/{id}`、`POST /v1/chat/completions`、`POST /v1/embeddings`；`POST /v1/responses` 需单独开启。
- **默认关闭**，需在配置中开启 `gateway.http.endpoints.chatCompletions.enabled: true`。
- 鉴权：`Authorization: Bearer <token 或 password>`。共享密钥等同于**完整 operator 权限**，官方要求只在 loopback / tailnet / 私有网络中暴露。
- `model` 字段选择 agent：`openclaw`、`openclaw/default`、`openclaw/<agentId>`。

### 3.3 其他 HTTP 端点

**[已核实]**

- `POST /tools/invoke`：直接调用单个工具，始终启用，同样需要 Gateway 鉴权（[`docs/gateway/tools-invoke-http-api.md`](https://github.com/openclaw/openclaw/blob/main/docs/gateway/tools-invoke-http-api.md)）。
- `POST /api/v1/admin/rpc`：默认关闭的插件路由，供无法使用 WebSocket 的主机工具调用 RPC。
- 健康检查：`GET /health`、`/healthz`（存活）、`/ready`、`/readyz`（就绪），`/health` 返回 `{"ok":true,"status":"live"}`（[`docs/gateway/health.md`](https://github.com/openclaw/openclaw/blob/main/docs/gateway/health.md)）。

### 3.4 CLI

**[已核实]** `openclaw gateway`（启动/状态）、`openclaw agent --message ... --agent <id>`（经 Gateway 跑一轮 agent）、`openclaw agent exec`（不连接 Gateway 的一次性运行）、`openclaw devices approve`（配对审批）。CLI 适合运维，**不推荐**作为 Web 后端的接入方式（进程开销大、无流式事件订阅）。

## 4. 本脚手架的接入方案候选

后端 `backend/` 作为代理层，Gateway 凭据只保存在后端环境变量中，浏览器不直接接触 Gateway。抽象层位于 `backend/src/openclaw/client.ts`（`OpenClawClient` 接口，目前为 `PlaceholderOpenClawClient`，所有连接操作返回 HTTP 501）。

| 方案 | 实现方式 | 优点 | 缺点 |
| --- | --- | --- | --- |
| A. Gateway WebSocket | 后端使用 `@openclaw/gateway-client`（Node） | 功能完整：会话列表、历史、流式事件、审批等；与官方 Control UI 同一协议 | 需实现设备身份 (Ed25519) 持久化与配对流程；需锁定客户端与 Gateway 版本 |
| B. OpenAI 兼容 HTTP | 后端调用 `/v1/chat/completions`（可 SSE 流式） | 最简单，无需配对，协议稳定通用 | 需在 Gateway 配置中开启；仅聊天/模型，无会话管理、审批、事件 |
| C. CLI | 后端 spawn `openclaw agent` | 无需额外配置 | 不推荐：慢、无事件流、需与 Gateway 同机 |

**[推断]** 建议：若只需聊天，先用方案 B 做 MVP；若要会话管理/审批/实时事件，选方案 A。最终选择需用户确认（Q4/Q5）。

## 5. 安全注意事项

- Gateway token/password 等同于所有者权限：只放在 `backend/.env`（已加入 `.gitignore`），不要提交，不要下发给浏览器。
- 不要把 Gateway 端口或本 Web UI 直接暴露到公网；本 Web UI 当前**没有自身的用户鉴权**。
- 方案 A 的设备 token 也是凭据，需要安全持久化。

## 6. 需要用户确认的问题

1. **Q1 目标项目**：OpenClaw 是否就是 [openclaw/openclaw](https://github.com/openclaw/openclaw)（AI 助手）？还是其他项目或你自己的服务？如是后者，请提供仓库地址和 API 文档。
2. **Q2 Gateway 版本**：使用哪个版本？你的 fork 停留在 `2026.7.2`，上游为 `2026.10.7`。是否计划同步 fork，还是直接使用 npm 发布版？
3. **Q3 部署位置与鉴权**：Gateway 运行在哪里（本机/远程/容器/Tailscale）？地址与端口？鉴权模式是 `token`、`password`、`trusted-proxy` 还是 `none`？（凭据请通过环境变量提供，不要发在聊天或提交到仓库。）
4. **Q4 功能范围**：Web UI 需要哪些功能——仅聊天？会话列表/历史？实时流式输出？审批？节点/渠道/配置管理？这决定方案 A 还是 B，以及需要申请的 scopes。
5. **Q5 接入方式**：是否接受方案 A（需要在 Gateway 主机上做一次设备配对审批），还是先用方案 B（需在 Gateway 配置中开启 `chatCompletions` 端点）？
6. **Q6 与内置 Control UI 的区别**：OpenClaw 已自带 Web 控制台。新 UI 想解决什么内置控制台不满足的需求？（定制界面、嵌入其他系统、多用户等）
7. **Q7 Web UI 自身的鉴权/多用户**：是否需要登录或多用户隔离？还是仅本机单人使用？
8. **Q8 部署目标**：最终是本地开发运行，还是需要部署到服务器/容器？
