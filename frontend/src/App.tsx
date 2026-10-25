import { useCallback, useEffect, useState } from "react";
import { api, type HealthResponse, type OpenClawStatus } from "./api";

const stateLabels: Record<OpenClawStatus["state"], string> = {
  not_configured: "未配置",
  disconnected: "未连接",
  connecting: "连接中",
  connected: "已连接",
  error: "连接错误",
};

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [status, setStatus] = useState<OpenClawStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const [h, s] = await Promise.all([api.health(), api.openclawStatus()]);
      setHealth(h);
      setStatus(s);
    } catch (err) {
      setHealth(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connect = async () => {
    setConnecting(true);
    setError(null);
    try {
      setStatus(await api.openclawConnect());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      try {
        setStatus(await api.openclawStatus());
      } catch {
        // Keep the original connection error visible.
      }
    } finally {
      setConnecting(false);
    }
  };

  const statusClass = status?.state === "connected" ? "ok" : status?.state === "error" ? "err" : "";

  return (
    <main className="container">
      <header className="page-header">
        <p className="eyebrow">PERSONAL ASSISTANT CONSOLE</p>
        <h1>OpenClaw Web UI</h1>
        <p className="muted">连接状态与目标配置。Gateway 凭据只应保存在后端环境变量中。</p>
      </header>

      <section className="card" aria-labelledby="backend-title">
        <div className="section-heading">
          <div><p className="eyebrow">SERVICE</p><h2 id="backend-title">后端服务</h2></div>
          <span className={`badge ${health?.ok ? "ok" : health ? "err" : ""}`} role="status">
            {health?.ok ? "在线" : health ? "离线" : "检查中"}
          </span>
        </div>
        <p className="muted">{health?.service ?? "等待后端健康检查结果"}</p>
      </section>

      <section className="card" aria-labelledby="gateway-title">
        <div className="section-heading">
          <div><p className="eyebrow">OPENCLAW GATEWAY</p><h2 id="gateway-title">连接诊断</h2></div>
          <span className={`badge ${statusClass}`} role="status">
            {status ? stateLabels[status.state] : "检查中"}
          </span>
        </div>

        {status ? (
          <>
            <dl>
              <dt>连接器</dt><dd>{status.transport}</dd>
              <dt>Gateway 地址</dt><dd>{status.endpoint ?? "尚未配置"}</dd>
              <dt>Jarvis Agent</dt><dd>{status.targetAgentId ?? "未指定"}</dd>
              <dt>Jarvis Session</dt><dd>{status.targetSessionId ?? "未指定"}</dd>
              {status.serverVersion && <><dt>Gateway 版本</dt><dd>{status.serverVersion}</dd></>}
            </dl>
            <p className="status-message">{status.message}</p>
          </>
        ) : (
          <p className="muted">尚未取得 Gateway 状态。</p>
        )}

        <div className="actions">
          <button className="secondary" onClick={() => void refresh()} disabled={refreshing || connecting}>
            {refreshing ? "刷新中…" : "刷新状态"}
          </button>
          <button onClick={() => void connect()} disabled={connecting || refreshing || !health?.ok || status?.state === "not_configured"}>
            {connecting ? "连接中…" : "连接 Gateway"}
          </button>
        </div>
      </section>

      <aside className="notice">
        <strong>下一步：绑定到 Jarvis</strong>
        <p>设置 <code>OPENCLAW_AGENT_ID</code> 或 <code>OPENCLAW_SESSION_ID</code> 可记录明确目标；真正发送消息前，仍需完成 Gateway 协议和设备配对实现。</p>
      </aside>

      {error && <p className="error" role="alert">{error}</p>}
    </main>
  );
}
