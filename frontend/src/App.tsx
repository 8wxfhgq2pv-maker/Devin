import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, type ChatMessage, type OpenClawStatus, type Session } from "./api";

type DisplayMessage = ChatMessage & { pending?: boolean };
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};
type SpeechResultEvent = Event & { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> };
const stateLabels: Record<OpenClawStatus["state"], string> = {
  not_configured: "未配置", disconnected: "未连接", connecting: "连接中", connected: "已连接", error: "连接错误",
};
function textFrom(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((part) => part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : "").join("");
  return "";
}
function clockLabel(timestamp = Date.now()) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(timestamp);
}
function eventText(payload: Record<string, unknown>): string {
  if (typeof payload.deltaText === "string") return payload.deltaText;
  if (typeof payload.text === "string") return payload.text;
  return textFrom((payload.message as Record<string, unknown> | undefined)?.content);
}

export default function App() {
  const [status, setStatus] = useState<OpenClawStatus | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeKey, setActiveKey] = useState("");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState("");
  const [listening, setListening] = useState(false);
  const [readAloud, setReadAloud] = useState(() => localStorage.getItem("devin.voice.readAloud") === "true");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const active = sessions.find((session) => session.key === activeKey);
  const filtered = useMemo(() => sessions.filter((session) => session.title.toLowerCase().includes(query.toLowerCase())), [sessions, query]);

  const speakText = useCallback((text: string) => {
    if (!("speechSynthesis" in window) || !text.trim()) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  }, []);

  const toggleListening = () => {
    if (listening) { recognitionRef.current?.stop(); return; }
    const SpeechRecognition = (window as SpeechRecognitionWindow).SpeechRecognition ?? (window as SpeechRecognitionWindow).webkitSpeechRecognition;
    if (!SpeechRecognition) { setError("当前浏览器不支持语音识别，请使用 Chrome 或支持语音输入的浏览器。"); return; }
    try {
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      recognition.lang = "zh-CN";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onresult = (event) => {
        const resultEvent = event as SpeechResultEvent;
        const transcript = Array.from(resultEvent.results).slice(resultEvent.resultIndex).map((result) => result[0]?.transcript ?? "").join(" ").trim();
        if (transcript) setDraft((current) => [current.trim(), transcript].filter(Boolean).join(" "));
      };
      recognition.onerror = (event) => setError(`语音识别失败：${(event as Event & { error?: string }).error ?? "请检查麦克风权限"}`);
      recognition.onend = () => { setListening(false); recognitionRef.current = null; };
      recognition.start();
      setListening(true);
      setError("");
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  const toggleReadAloud = () => {
    setReadAloud((current) => {
      const next = !current;
      localStorage.setItem("devin.voice.readAloud", String(next));
      if (!next && "speechSynthesis" in window) window.speechSynthesis.cancel();
      return next;
    });
  };

  useEffect(() => () => { recognitionRef.current?.abort(); if ("speechSynthesis" in window) window.speechSynthesis.cancel(); }, []);

  const loadSessions = useCallback(async (selectFirst = false) => {
    const result = await api.sessions();
    setSessions(result);
    if (selectFirst || !activeKey) {
      const first = result[0];
      if (first) setActiveKey(first.key);
    }
  }, [activeKey]);

  const loadHistory = useCallback(async (key: string) => {
    setLoadingHistory(true);
    try { setMessages(await api.history(key)); setError(""); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); setMessages([]); }
    finally { setLoadingHistory(false); }
  }, []);

  const connect = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const next = await api.connect(); setStatus(next);
      const result = await api.sessions(); setSessions(result);
      setActiveKey((current) => current || result[0]?.key || "");
      if (!result.length) {
        const created = await api.createSession();
        setSessions([created]); setActiveKey(created.key);
      }
    } catch (err) {
      setStatus(await api.status().catch(() => null));
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { void api.status().then(setStatus).catch((err) => setError(String(err))); }, []);
  useEffect(() => { if (status?.state === "connected") void loadSessions(); }, [status?.state, loadSessions]);
  useEffect(() => { if (activeKey && status?.state === "connected") void loadHistory(activeKey); else setMessages([]); }, [activeKey, status?.state, loadHistory]);

  useEffect(() => {
    if (!activeKey || status?.state !== "connected") return;
    const source = new EventSource(api.eventsUrl(activeKey));
    const handleChat = (event: MessageEvent<string>) => {
      let payload: Record<string, unknown>;
      try { payload = JSON.parse(event.data) as Record<string, unknown>; } catch { return; }
      if (payload.sessionKey !== activeKey) return;
      const runId = String(payload.runId ?? "live");
      const state = String(payload.state ?? "");
      const message = payload.message && typeof payload.message === "object" ? payload.message as Record<string, unknown> : {};
      const text = eventText(payload);
      if (state === "delta" || state === "final" || state === "aborted" || state === "error") {
        setMessages((current) => {
          const index = current.findIndex((row) => row.id === `run:${runId}`);
          const previous = index >= 0 ? current[index].content : "";
          const delta = typeof payload.deltaText === "string" ? payload.deltaText : "";
          const snapshot = textFrom(message.content);
          const content = state === "delta"
            ? payload.replace === true ? delta : previous + delta
            : snapshot || text || previous;
          const nextMessage: DisplayMessage = { id: `run:${runId}`, role: "assistant", content, timestamp: Date.now(), pending: state === "delta" };
          if (index < 0) return [...current, nextMessage];
          return current.map((row, i) => i === index ? { ...row, ...nextMessage } : row);
        });
        if (state === "final" && readAloud) speakText(textFrom(message.content) || text);
        if (state !== "delta") window.setTimeout(() => void loadHistory(activeKey), 500);
      }
    };
    source.addEventListener("chat", handleChat as EventListener);
    source.addEventListener("connection.closed", () => setStatus((current) => current ? { ...current, state: "disconnected", message: "Gateway 连接已断开。" } : current));
    source.onerror = () => setStatus((current) => current?.state === "connected" ? { ...current, state: "disconnected", message: "实时连接中断，正在等待重连。" } : current);
    return () => source.close();
  }, [activeKey, status?.state, loadHistory, readAloud, speakText]);

  const selectSession = (key: string) => { setActiveKey(key); setSidebarOpen(false); };
  const newConversation = async () => {
    if (status?.state !== "connected") { setError("请先连接 OpenClaw Gateway。"); return; }
    setBusy(true); setError("");
    try {
      const session = await api.createSession();
      setSessions((current) => [session, ...current.filter((row) => row.key !== session.key)]);
      setActiveKey(session.key); setSidebarOpen(false);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  const sendMessage = async (event?: FormEvent, supplied = draft) => {
    event?.preventDefault();
    const content = supplied.trim();
    if (!content || !activeKey || busy || status?.state !== "connected") return;
    const idempotencyKey = crypto.randomUUID();
    const userMessage: DisplayMessage = { id: `user:${idempotencyKey}`, role: "user", content, timestamp: Date.now() };
    setMessages((current) => [...current, userMessage]); setDraft(""); setBusy(true); setError("");
    try { await api.send(activeKey, content, idempotencyKey); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); setMessages((current) => current.filter((message) => message.id !== userMessage.id)); }
    finally { setBusy(false); }
  };

  const stateClass = status?.state === "connected" ? "ok" : status?.state === "error" ? "err" : "";
  return (
    <main className="app-shell">
      {sidebarOpen && <button aria-label="关闭导航" className="scrim" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-top"><a className="brand" href="#" aria-label="OpenClaw 首页"><span className="brand-mark">✳</span><span>openclaw</span></a><button className="icon-button sidebar-close" aria-label="关闭导航" onClick={() => setSidebarOpen(false)}>×</button></div>
        <button className="new-chat" onClick={() => void newConversation()} disabled={busy}><span className="plus">＋</span> 新建对话 <kbd>⌘ K</kbd></button>
        <label className="search-box"><span aria-hidden="true">⌕</span><input aria-label="搜索对话" placeholder="搜索对话" value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>⌘ F</kbd></label>
        <div className="nav-label">最近对话</div>
        <nav className="conversation-list" aria-label="最近对话">
          {filtered.map((session) => <button key={session.key} className={`conversation-item ${session.key === activeKey ? "active" : ""}`} onClick={() => selectSession(session.key)}><span className="conversation-icon">◌</span><span className="conversation-title">{session.title}</span></button>)}
          {!filtered.length && <p className="empty-search">{status?.state === "connected" ? "没有可显示的对话" : "连接 Gateway 后显示会话"}</p>}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-card"><span className={`connection-dot ${status?.state === "connected" ? "connected" : ""}`} /><span><strong>{status ? stateLabels[status.state] : "正在检查"}</strong><small>{status?.endpoint ?? "OpenClaw Gateway"}</small></span><button className="more-button" aria-label="刷新状态" onClick={() => void connect()}>↻</button></div>
          <button className="profile-button"><span className="avatar">D</span><span className="profile-copy"><strong>本地工作区</strong><small>OpenClaw 控制台</small></span><span className="more-button">···</span></button>
        </div>
      </aside>

      <section className="chat-panel">
        <header className="topbar"><div className="topbar-left"><button className="icon-button menu-button" aria-label="打开导航" onClick={() => setSidebarOpen(true)}>☰</button><span className="mobile-brand"><span className="brand-mark">✳</span> openclaw</span><span className="topbar-divider" /><span className="model-label"><span className="model-dot" /> {active?.model ?? "OpenClaw"} <span className="chevron">⌄</span></span></div><div className="topbar-right"><span className="demo-pill"><span className={`connection-dot ${status?.state === "connected" ? "connected" : ""}`} />{status?.state === "connected" ? "已连接" : "未连接"}</span><button className="icon-button" aria-label="刷新会话" onClick={() => void loadSessions(true)}>↻</button></div></header>
        <div className="conversation-heading"><div><p className="eyebrow">{active?.channel ?? "OPENCLAW SESSION"}</p><h1>{active?.title ?? "新对话"}</h1></div><span className="session-key" title={activeKey}>{activeKey}</span></div>
        <div className="messages" aria-live="polite">
          {loadingHistory ? <div className="welcome"><div className="welcome-mark">✳</div><p className="muted">正在加载 Gateway 历史…</p></div> : messages.length ? messages.map((message) => <article key={message.id} className={`message message-${message.role}`}><div className={message.role === "assistant" ? "assistant-avatar" : "user-avatar"}>{message.role === "assistant" ? "✳" : "D"}</div><div className="message-body"><div className="message-meta"><strong>{message.role === "assistant" ? "OpenClaw" : "你"}</strong><time>{clockLabel(message.timestamp)}</time>{message.pending && <span className="streaming-label">正在回复</span>}</div><p>{message.content}</p></div></article>) : <div className="welcome"><div className="welcome-mark">✳</div><p className="eyebrow">个人 AI 助手</p><h2>{status?.state === "connected" ? "今天有什么可以帮你？" : "连接 OpenClaw Gateway"}</h2><p className="muted">{status?.state === "connected" ? "从下方开始对话，消息会发送到当前会话。" : status?.message ?? "配置 Gateway 地址和凭据后即可开始。"}</p>{status?.state === "connected" && <div className="prompt-grid">{["帮我总结一段文字", "给我一些灵感", "规划今天的安排"].map((prompt) => <button key={prompt} onClick={() => void sendMessage(undefined, prompt)}>{prompt}<span>↗</span></button>)}</div>}{status?.state !== "connected" && <button className="connect-button" onClick={() => void connect()} disabled={busy}>{busy ? "连接中…" : "连接 Gateway"}</button>}</div>}
        </div>
        <div className="composer-area"><form className="composer" onSubmit={(event) => void sendMessage(event)}><textarea aria-label="发送消息" placeholder={status?.state === "connected" ? "给 OpenClaw 发送消息…" : "连接 Gateway 后即可发送消息"} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} rows={2} disabled={status?.state !== "connected" || busy} /><div className="composer-toolbar"><div className="composer-tools"><button type="button" className={`tool-button mic-button ${listening ? "voice-active" : ""}`} onClick={toggleListening} aria-label={listening ? "停止语音输入" : "语音输入"} aria-pressed={listening}>{listening ? "■" : "🎙"}<span>{listening ? "正在聆听" : "语音输入"}</span></button><button type="button" className={`tool-button voice-toggle ${readAloud ? "voice-active" : ""}`} onClick={toggleReadAloud} aria-pressed={readAloud} title="朗读 OpenClaw 回复">{readAloud ? "◖))" : "◖"}<span>朗读回复</span></button></div><div className="composer-actions"><span className="keyboard-hint">↵ 发送 · ⇧↵ 换行</span><button className="send-button" type="submit" disabled={!draft.trim() || busy || status?.state !== "connected"} aria-label="发送消息">{busy ? "…" : "↑"}</button></div></div></form><p className="composer-note">{listening ? "正在聆听中文语音，识别结果会填入输入框供你确认。" : "语音识别由浏览器提供（部分浏览器可能使用在线服务）；朗读使用设备语音。消息通过 OpenClaw Gateway 处理。"}</p></div>
        {error && <div className="toast-error" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label="关闭错误">×</button></div>}
      </section>
    </main>
  );
}
