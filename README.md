# OpenClaw Web UI

为 [OpenClaw](https://github.com/openclaw/openclaw) 搭建的 Web UI 脚手架：

- `frontend/` — React + TypeScript（Vite）
- `backend/` — Node + Express，作为与 OpenClaw 通信的代理层
- `docs/openclaw-research.md` — OpenClaw 接入方式调研，以及**仍需确认的问题**

> 当前阶段尚未实现与 OpenClaw 的实际连接。连接抽象层位于 `backend/src/openclaw/client.ts`，待接入协议确认后再实现。

## 环境要求

- Node.js 20+（推荐 22）
- npm 10+

## 本地启动

```bash
npm install
cp backend/.env.example backend/.env   # 可选，按需修改
npm run dev
```

- 前端：<http://localhost:5173>（`/api` 请求由 Vite 代理到后端）
- 后端：<http://localhost:3001>

单独启动：`npm run dev -w backend` / `npm run dev -w frontend`。

## 其他脚本

| 命令 | 说明 |
| --- | --- |
| `npm run build` | 构建前后端 |
| `npm run typecheck` | 前后端 TypeScript 类型检查 |
| `npm run start -w backend` | 运行构建后的后端 |

## 后端 API（占位）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 后端健康检查 |
| GET | `/api/openclaw/status` | OpenClaw 连接状态（当前为 `placeholder`） |
| POST | `/api/openclaw/connect` | 连接 OpenClaw（未实现，返回 501） |
| POST | `/api/openclaw/messages` | 发送消息 `{ "message": "..." }`（未实现，返回 501） |

## 配置

`backend/.env`（参考 `backend/.env.example`）：

| 变量 | 说明 |
| --- | --- |
| `PORT` | 后端端口，默认 `3001` |
| `OPENCLAW_URL` | OpenClaw 地址（占位，协议确认前不会使用） |
| `OPENCLAW_TOKEN` | OpenClaw 凭据（占位，不要提交到仓库） |
