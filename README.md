# OpenClaw Web UI

面向个人 OpenClaw Gateway 的 Web 控制台基线，采用 React + TypeScript 前端和 Node + Express 后端代理。当前仓库的重点是连接诊断；Gateway 协议客户端尚未实现，页面不会把“配置了地址”误报为“已连接”。

## 目录

- `frontend/` — React + TypeScript（Vite）控制台
- `backend/` — Node + Express 代理层，Gateway 凭据只保存在服务端
- `docs/openclaw-research.md` — Gateway 协议和候选接入方案调研

## 本地启动

需要 Node.js `^20.19.0 || >=22.12.0` 和 npm 10+。

```bash
npm install
cp backend/.env.example backend/.env
# 编辑 backend/.env，填入 OpenClaw Gateway URL 和可选凭据
npm run dev
```

前端地址 <http://localhost:5173>，后端地址 <http://localhost:3001>。也可以分别运行 `npm run dev -w backend` 和 `npm run dev -w frontend`。

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `PORT` | 后端监听端口，默认 `3001` |
| `OPENCLAW_URL` | Gateway 地址（支持 http/https/ws/wss URL；连接器实现后使用） |
| `OPENCLAW_TOKEN` | Gateway 凭据，只保存在后端环境中 |

不要把 Gateway 暴露到公网，也不要把 token 放进前端变量或提交到仓库。

## 当前功能

- 后端健康检查：`GET /api/health`
- Gateway 状态与脱敏 endpoint：`GET /api/openclaw/status`
- 占位连接动作：`POST /api/openclaw/connect`（协议未实现时返回明确的 501）
- 消息请求输入校验：`POST /api/openclaw/messages`（真实传输尚未实现）

构建与类型检查：`npm run build`、`npm run typecheck`。
