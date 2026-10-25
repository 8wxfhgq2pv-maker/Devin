# OpenClaw Web UI

一个独立于 OpenClaw 内置 Control UI 的自定义控制台。目标是逐步覆盖日常聊天工作流：会话导航、聊天记录、消息输入，以及后续的 Agent 选择、实时回复和审批。

## 当前进度

前端已提供可交互的聊天工作区原型：最近对话列表、搜索、新建会话、消息输入和快捷提示。当前会话与消息保存在页面内存中，刷新页面会重置；演示模式不会连接 Gateway，也不会生成或伪装真实 AI 回复。

后端保留连接抽象与状态 API，并校验连接配置和消息请求。OpenClaw Gateway WebSocket 协议、设备身份/配对、会话历史和流式事件仍待接入。实现时应使用官方协议客户端，并将 Gateway 凭据保留在后端。

## 目录

- `frontend/` — React + TypeScript（Vite）聊天 UI
- `backend/` — Node + Express API/代理层
- `docs/openclaw-research.md` — Gateway 协议和客户端接入调研

## 本地启动

需要 Node.js `^20.19.0 || >=22.12.0` 和 npm 10+。

```bash
npm install
cp backend/.env.example backend/.env
npm run dev
```

前端地址 <http://localhost:5173>，后端地址 <http://localhost:3001>。也可以分别运行 `npm run dev -w backend` 和 `npm run dev -w frontend`。

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `PORT` | 后端监听端口，默认 `3001` |
| `OPENCLAW_URL` | Gateway 地址（连接器实现后使用） |
| `OPENCLAW_TOKEN` | Gateway 凭据，只保存在后端环境中 |

不要将 Gateway 暴露到公网，也不要把 token 放进前端变量或提交到仓库。

## 下一阶段

1. 接入与 Gateway 版本匹配的官方 WebSocket 客户端，完成握手和设备配对。
2. 提供会话列表/历史 API，并让聊天 UI 展示真实会话。
3. 用 Gateway 事件实现流式回复和连接状态更新。
4. 添加 Agent 切换及审批工作流。

`npm run build` 和 `npm run typecheck` 可用于构建与类型检查。
