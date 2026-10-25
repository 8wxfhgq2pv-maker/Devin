import { useCallback, useEffect, useState } from "react";
import { api, type HealthResponse, type OpenClawStatus } from "./api";

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [status, setStatus] = useState<OpenClawStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [h, s] = await Promise.all([api.health(), api.openclawStatus()]);
      setHealth(h);
      setStatus(s);
    } catch (err) {
      setHealth(null);
      setError(err instanceof Error ? err.message : String(err));
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
    } finally {
      setConnecting(false);
    }
  };

  return (
    <main className="container">
      <h1>OpenClaw Web UI</h1>
      <p className="muted">脚手架阶段：连接逻辑待 OpenClaw 接入协议确认后实现。</p>

      <section className="card">
        <h2>Backend</h2>
        <p>
          状态：{" "}
          <span className={health?.ok ? "badge ok" : "badge err"}>
            {health?.ok ? "online" : "offline"}
          </span>
        </p>
      </section>

      <section className="card">
        <h2>OpenClaw 连接</h2>
        {status ? (
          <dl>
            <dt>状态</dt>
            <dd>
              <span className="badge">{status.state}</span>
            </dd>
            <dt>Transport</dt>
            <dd>{status.transport}</dd>
            <dt>Endpoint</dt>
            <dd>{status.endpoint ?? "（未配置）"}</dd>
            {status.message && (
              <>
                <dt>说明</dt>
                <dd>{status.message}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="muted">未获取到状态</p>
        )}
        <div className="actions">
          <button onClick={() => void refresh()}>刷新</button>
          <button onClick={() => void connect()} disabled={connecting}>
            {connecting ? "连接中…" : "连接"}
          </button>
        </div>
      </section>

      {error && <p className="error">{error}</p>}
    </main>
  );
}
