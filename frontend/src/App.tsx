import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type HealthResponse,
  type OpenClawApproval,
  type OpenClawChatMessage,
  type OpenClawEvent,
  type OpenClawSession,
  type OpenClawStatus,
} from "./api";

const STATE_LABELS: Record<OpenClawStatus["state"], string> = {
  not_configured: "未配置",
  disconnected: "未连接",
  connecting: "连接中",
  pairing_required: "等待设备配对审批",
  connected: "已连接",
  error: "错误",
};

const DECISION_LABELS: Record<string, string> = {
  "allow-once": "允许一次",
  "allow-always": "始终允许",
  deny: "拒绝",
};

interface LiveRun {
  runId: string;
  text: string;
  phase?: string;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [status, setStatus] = useState<OpenClawStatus | null>(null);
  const [sessions, setSessions] = useState<OpenClawSession[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<OpenClawChatMessage[]>([]);
  const [liveRun, setLiveRun] = useState<LiveRun | null>(null);
  const [approvals, setApprovals] = useState<OpenClawApproval[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;
  const connected = status?.state === "connected";

  const loadSessions = useCallback(async () => {
    try {
      setSessions((await api.sessions()).sessions);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  const loadHistory = useCallback(async (key: string) => {
    try {
      const { messages } = await api.history(key);
      if (selectedRef.current === key) setMessages(messages);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [h, s, a] = await Promise.all([api.health(), api.status(), api.approvals()]);
      setHealth(h);
      setStatus(s);
      setApprovals(a.approvals);
      if (s.state === "connected") await loadSessions();
    } catch (err) {
      setHealth(null);
      setError(errorText(err));
    }
  }, [loadSessions]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const source = api.events();
    source.onopen = () => setHealth({ ok: true, service: "openclaw-webui-backend" });
    source.onerror = () => setHealth(null);
    source.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as OpenClawEvent;
      switch (event.type) {
        case "status":
          setStatus(event.status);
          if (event.status.state === "connected") void loadSessions();
          break;
        case "sessions.changed":
          void loadSessions();
          break;
        case "approval":
          setApprovals((prev) => {
            const rest = prev.filter((a) => a.id !== event.approval.id);
            return event.approval.status === "pending" ? [...rest, event.approval] : rest;
          });
          break;
        case "chat":
          if (event.sessionKey !== selectedRef.current) break;
          if (event.state === "final" || event.state === "aborted" || event.state === "error") {
            setLiveRun(null);
            if (event.state === "error" && event.errorMessage) setError(event.errorMessage);
            void loadHistory(event.sessionKey);
          } else {
            setLiveRun({ runId: event.runId, text: event.text ?? "", phase: event.phase });
          }
          break;
        case "session.message":
          if (event.sessionKey !== selectedRef.current) break;
          setMessages((prev) =>
            event.message.id && prev.some((m) => m.id === event.message.id) ? prev : [...prev, event.message],
          );
          break;
      }
    };
    return () => source.close();
  }, [loadHistory, loadSessions]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const selectSession = (key: string) => {
    setSelected(key);
    setMessages([]);
    setLiveRun(null);
    void loadHistory(key);
  };

  const send = () =>
    run(async () => {
      if (!selected || !draft.trim()) return;
      await api.send(selected, draft);
      setDraft("");
    });

  const sessionApprovals = approvals;

  return (
    <main className="container wide">
      <h1>OpenClaw Web UI</h1>

      <section className="card">
        <h2>连接</h2>
        <dl>
          <dt>Backend</dt>
          <dd>
            <span className={health?.ok ? "badge ok" : "badge err"}>{health?.ok ? "online" : "offline"}</span>
          </dd>
          <dt>Gateway</dt>
          <dd>
            <span className={connected ? "badge ok" : status?.state === "error" ? "badge err" : status?.state === "pairing_required" ? "badge warn" : "badge"}>
              {status ? STATE_LABELS[status.state] : "未知"}
            </span>
            {status?.serverVersion && <span className="muted"> v{status.serverVersion}</span>}
          </dd>
          <dt>Endpoint</dt>
          <dd>{status?.endpoint ?? "（未配置）"}</dd>
          {status?.deviceId && (
            <>
              <dt>设备 ID</dt>
              <dd>
                <code>{status.deviceId.slice(0, 16)}…</code>
              </dd>
            </>
          )}
          {status?.message && (
            <>
              <dt>说明</dt>
              <dd>{status.message}</dd>
            </>
          )}
        </dl>
        {status?.state === "pairing_required" && (
          <div className="pairing">
            <p>首次连接需要在 Gateway 主机上批准本设备，批准后会自动重连：</p>
            <pre className="cmd">openclaw devices approve {status.pairing?.requestId ?? "<requestId>"}</pre>
            <p className="muted">请求权限：{status.pairing?.requestedScopes?.join(", ")}</p>
          </div>
        )}
        <div className="actions">
          <button onClick={() => void refresh()}>刷新</button>
          <button onClick={() => void run(api.connect)} disabled={busy || connected || status?.state === "not_configured"}>
            {status?.state === "connecting" ? "连接中…" : "连接"}
          </button>
          <button onClick={() => void run(api.disconnect)} disabled={busy || status?.state === "disconnected" || status?.state === "not_configured"}>
            断开
          </button>
        </div>
      </section>

      {error && <p className="error">{error}</p>}

      <div className="layout">
        <section className="card">
          <h2>会话</h2>
          <ul className="session-list">
            {sessions.map((s) => (
              <li key={s.key}>
                <button className={s.key === selected ? "active" : ""} onClick={() => selectSession(s.key)}>
                  {s.title}
                  {s.hasActiveRun && <span className="badge warn"> 运行中</span>}
                  {s.lastMessagePreview && <small>{s.lastMessagePreview}</small>}
                </button>
              </li>
            ))}
            {connected && sessions.length === 0 && <li className="muted">暂无会话</li>}
          </ul>
          <button
            disabled={!connected || busy}
            onClick={() =>
              void run(async () => {
                const session = await api.createSession();
                await loadSessions();
                selectSession(session.key);
              })
            }
          >
            新建会话
          </button>
        </section>

        <section className="card">
          <h2>对话</h2>
          {!selected ? (
            <p className="muted">{connected ? "选择或新建一个会话" : "连接 Gateway 后可用"}</p>
          ) : (
            <>
              <div className="messages">
                {messages.map((m, i) => (
                  <div key={m.id ?? i} className={`msg ${m.role}`}>
                    <span className="role">{m.role}</span>
                    {m.text || <em className="muted">（非文本内容）</em>}
                  </div>
                ))}
                {liveRun && (
                  <div className="msg assistant streaming">
                    <span className="role">assistant{liveRun.phase ? ` · ${liveRun.phase}` : ""}</span>
                    {liveRun.text || "…"}
                  </div>
                )}
              </div>
              <div className="composer">
                <textarea
                  value={draft}
                  placeholder="输入消息，Ctrl+Enter 发送"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send();
                  }}
                />
                <button onClick={() => void send()} disabled={!connected || busy || !draft.trim()}>
                  发送
                </button>
              </div>
            </>
          )}
        </section>

        <section className="card">
          <h2>待审批 ({sessionApprovals.length})</h2>
          {sessionApprovals.length === 0 && <p className="muted">暂无待审批请求</p>}
          {sessionApprovals.map((a) => (
            <div key={a.id} className="approval">
              <span className="badge warn">{a.kind}</span>
              <code>{a.summary}</code>
              {a.warning && <p className="error">{a.warning}</p>}
              {a.sessionKey && <small className="muted">会话：{a.sessionKey}</small>}
              <div className="actions">
                {a.allowedDecisions.map((d) => (
                  <button key={d} disabled={busy} onClick={() => void run(() => api.resolveApproval(a.id, d))}>
                    {DECISION_LABELS[d] ?? d}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
