import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, type ChatMessage, type OpenClawStatus, type Session } from "./api";
import { MarkdownMessage } from "./MarkdownMessage";

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
const READ_ALOUD_KEY = "openclaw.voice.readAloud";
const LEGACY_READ_ALOUD_KEY = "devin.voice.readAloud";
const shortcutModifier = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? "⌘" : "Ctrl";
function storedReadAloud(): boolean {
  return (localStorage.getItem(READ_ALOUD_KEY) ?? localStorage.getItem(LEGACY_READ_ALOUD_KEY)) === "true";
}
function clockLabel(timestamp = Date.now()) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [status, setStatus] = useState<OpenClawStatus | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeKey, setActiveKey] = useState("");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState("");
  const [listening, setListening] = useState(false);
  const [readAloud, setReadAloud] = useState(storedReadAloud);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const streamingRef = useRef(false);
  const activeKeyRef = useRef(activeKey);
  const active = sessions.find((session) => session.key === activeKey);
  const filtered = useMemo(() => sessions.filter((session) => session.title.toLowerCase().includes(query.toLowerCase())), [sessions, query]);
  // A disconnected Gateway has no transcript to show, so the previous session's messages must not
  // linger in the pane.
  const visibleMessages = status?.state === "connected" ? messages : [];

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
      localStorage.setItem(READ_ALOUD_KEY, String(next));
      if (!next && "speechSynthesis" in window) window.speechSynthesis.cancel();
      return next;
    });
  };

  useEffect(() => () => { recognitionRef.current?.abort(); if ("speechSynthesis" in window) window.speechSynthesis.cancel(); }, []);

  const loadSessions = useCallback(async (selectFirst = false) => {
    const result = await api.sessions();
    setSessions(result);
    if (selectFirst) {
      const first = result[0];
      if (first) setActiveKey(first.key);
      return;
    }
    setActiveKey((current) => current || result[0]?.key || "");
  }, []);

  const loadHistory = useCallback(async (key: string) => {
    setLoadingHistory(true);
    try {
      const history = await api.history(key);
      if (activeKeyRef.current === key) { setMessages(history); setError(""); }
    } catch (err) {
      if (activeKeyRef.current === key) { setError(err instanceof Error ? err.message : String(err)); setMessages([]); }
    } finally {
      if (activeKeyRef.current === key) setLoadingHistory(false);
    }
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

  useEffect(() => { activeKeyRef.current = activeKey; }, [activeKey]);
  useEffect(() => { if (status?.state === "connected") void loadSessions(); }, [status?.state, loadSessions]);
  useEffect(() => { if (activeKey && status?.state === "connected") void loadHistory(activeKey); }, [activeKey, status?.state, loadHistory]);

  useEffect(() => {
    if (!activeKey) return;
    const source = new EventSource(api.eventsUrl(activeKey));
    // The backend owns the session projection, so the browser renders whatever it last published
    // instead of merging deltas itself.
    const handleProjection = (event: MessageEvent<string>) => {
      let payload: { sessionKey?: string; messages?: DisplayMessage[]; streaming?: boolean };
      try { payload = JSON.parse(event.data) as typeof payload; } catch { return; }
      if (payload.sessionKey !== activeKey || !Array.isArray(payload.messages)) return;
      const wasStreaming = streamingRef.current;
      const nowStreaming = payload.streaming === true;
      streamingRef.current = nowStreaming;
      setStreaming(nowStreaming);
      setMessages(payload.messages);
      setLoadingHistory(false);
      if (wasStreaming && !nowStreaming && readAloud) {
        const last = [...payload.messages].reverse().find((row) => row.role === "assistant");
        if (last) speakText(last.content);
      }
    };
    source.addEventListener("projection", handleProjection as EventListener);
    source.addEventListener("ready", (event) => {
      try {
        const connected = (JSON.parse((event as MessageEvent<string>).data) as { connected?: boolean }).connected === true;
        setStatus((current) => current ? { ...current, state: connected ? "connected" : "disconnected", message: connected ? "已连接 OpenClaw Gateway。" : "Gateway 连接已断开，正在恢复…" } : current);
      } catch { /* Ignore malformed status events. */ }
    });
    source.addEventListener("connection.closed", () => setStatus((current) => current ? { ...current, state: "disconnected", message: "Gateway 连接已断开。" } : current));
    source.addEventListener("connection.restored", (event) => {
      try { setStatus(JSON.parse((event as MessageEvent<string>).data) as OpenClawStatus); }
      catch { setStatus((current) => current ? { ...current, state: "connected", message: "已重新连接 OpenClaw Gateway。" } : current); }
    });
    source.onopen = () => { if (status?.state === "connected") void loadHistory(activeKey); };
    source.onerror = () => {
      // EventSource retries transient failures automatically; keep Gateway state connected
      // so this effect does not close the stream before its retry can succeed.
    };
    return () => source.close();
  }, [activeKey, status?.state, readAloud, speakText, loadHistory]);

  const selectSession = (key: string) => { setActiveKey(key); setSidebarOpen(false); };
  const newConversation = useCallback(async () => {
    if (status?.state !== "connected") { setError("请先连接 OpenClaw Gateway。"); return; }
    setBusy(true); setError("");
    try {
      const session = await api.createSession();
      setSessions((current) => [session, ...current.filter((row) => row.key !== session.key)]);
      setActiveKey(session.key); setSidebarOpen(false);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }, [status?.state]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key === "k") { event.preventDefault(); void newConversation(); }
      else if (key === "f") {
        event.preventDefault();
        setSidebarOpen(true);
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [newConversation]);
  const sendMessage = async (event?: FormEvent, supplied = draft) => {
    event?.preventDefault();
    const content = supplied.trim();
    if (!content || !activeKey || busy || status?.state !== "connected") return;
    const idempotencyKey = crypto.randomUUID();
    setDraft(""); setBusy(true); setError("");
    try { await api.send(activeKey, content, idempotencyKey); }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDraft((current) => current || content);
    }
    finally { setBusy(false); }
  };

  const stopStreaming = async () => {
    if (!activeKey) return;
    try { await api.abort(activeKey); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    setLoggingIn(true); setLoginError("");
    try {
      await api.login(password);
      setPassword(""); setAuthenticated(true);
    } catch (err) { setLoginError(err instanceof Error ? err.message : String(err)); }
    finally { setLoggingIn(false); }
  };

  useEffect(() => {
    void api.session().then((result) => setAuthenticated(result.authenticated)).catch(() => setAuthenticated(false));
  }, []);
  useEffect(() => {
    const handleUnauthorized = () => {
      setAuthenticated(false);
      setStatus(null); setSessions([]); setActiveKey(""); setMessages([]); setDraft("");
      setStreaming(false); streamingRef.current = false; setBusy(false); setLoadingHistory(false); setError("");
    };
    window.addEventListener("auth:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("auth:unauthorized", handleUnauthorized);
  }, []);
  useEffect(() => {
    if (!authenticated) return;
    const checkSession = async () => {
      try {
        const result = await api.session();
        if (!result.authenticated) window.dispatchEvent(new Event("auth:unauthorized"));
      } catch { window.dispatchEvent(new Event("auth:unauthorized")); }
    };
    const timer = window.setInterval(() => { void checkSession(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [authenticated]);
  useEffect(() => {
    if (authenticated) void api.status().then(setStatus).catch((err) => setError(String(err)));
  }, [authenticated]);

  if (authenticated === null) return <main className="auth-shell"><p>正在验证登录状态…</p></main>;
  if (!authenticated) return (
    <main className="auth-shell">
      <form className="auth-card" onSubmit={(event) => void submitLogin(event)}>
        <div className="welcome-mark">✳</div>
        <p className="eyebrow">OPENCLAW WORKSPACE</p>
        <h1>登录控制台</h1>
        <p className="muted">输入部署时配置的 Web UI 密码继续。</p>
        <label htmlFor="webui-password">密码</label>
        <input id="webui-password" type="password" autoComplete="current-password" required minLength={1} value={password} onChange={(event) => setPassword(event.target.value)} />
        {loginError && <p className="auth-error" role="alert">{loginError}</p>}
        <button className="connect-button" type="submit" disabled={loggingIn}>{loggingIn ? "正在登录…" : "登录"}</button>
      </form>
    </main>
  );

  return (
    <main className="app-shell">
      {sidebarOpen && <button aria-label="关闭导航" className="scrim" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-top"><a className="brand" href="#" aria-label="OpenClaw 首页"><span className="brand-mark">✳</span><span>openclaw</span></a><button className="icon-button sidebar-close" aria-label="关闭导航" onClick={() => setSidebarOpen(false)}>×</button></div>
        <button className="new-chat" onClick={() => void newConversation()} disabled={busy}><span className="plus">＋</span> 新建对话 <kbd>{shortcutModifier} K</kbd></button>
        <label className="search-box"><span aria-hidden="true">⌕</span><input ref={searchRef} aria-label="搜索对话" placeholder="搜索对话" value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>{shortcutModifier} F</kbd></label>
        <div className="nav-label">最近对话</div>
        <nav className="conversation-list" aria-label="最近对话">
          {filtered.map((session) => <button key={session.key} className={`conversation-item ${session.key === activeKey ? "active" : ""}`} onClick={() => selectSession(session.key)}><span className="conversation-icon">◌</span><span className="conversation-title">{session.title}</span></button>)}
          {!filtered.length && <p className="empty-search">{status?.state === "connected" ? "没有可显示的对话" : "连接 Gateway 后显示会话"}</p>}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-card"><span className={`connection-dot ${status?.state === "connected" ? "connected" : ""}`} /><span><strong>{status ? stateLabels[status.state] : "正在检查"}</strong><small>{status?.endpoint ?? "OpenClaw Gateway"}</small></span><button className="more-button" aria-label="刷新状态" onClick={() => void connect()}>↻</button></div>
          <button className="profile-button" aria-label="退出登录" onClick={() => { void api.logout().catch(() => undefined).finally(() => window.dispatchEvent(new Event("auth:unauthorized"))); }}><span className="avatar">D</span><span className="profile-copy"><strong>本地工作区</strong><small>点击退出登录</small></span><span className="more-button">↗</span></button>
        </div>
      </aside>

      <section className="chat-panel">
        <header className="topbar"><div className="topbar-left"><button className="icon-button menu-button" aria-label="打开导航" onClick={() => setSidebarOpen(true)}>☰</button><span className="mobile-brand"><span className="brand-mark">✳</span> openclaw</span><span className="topbar-divider" /><span className="model-label"><span className="model-dot" /> {active?.model ?? "OpenClaw"} <span className="chevron">⌄</span></span></div><div className="topbar-right"><span className="demo-pill"><span className={`connection-dot ${status?.state === "connected" ? "connected" : ""}`} />{status?.state === "connected" ? "已连接" : "未连接"}</span><button className="icon-button" aria-label="刷新会话" onClick={() => void loadSessions(true)}>↻</button></div></header>
        <div className="conversation-heading"><div><p className="eyebrow">{active?.channel ?? "OPENCLAW SESSION"}</p><h1>{active?.title ?? "新对话"}</h1></div><span className="session-key" title={activeKey}>{activeKey}</span></div>
        <div className="messages" aria-live="polite">
          {loadingHistory ? <div className="welcome"><div className="welcome-mark">✳</div><p className="muted">正在加载 Gateway 历史…</p></div> : visibleMessages.length ? visibleMessages.map((message) => <article key={message.id} className={`message message-${message.role}`}><div className={message.role === "assistant" ? "assistant-avatar" : "user-avatar"}>{message.role === "assistant" ? "✳" : "D"}</div><div className="message-body"><div className="message-meta"><strong>{message.role === "assistant" ? "OpenClaw" : "你"}</strong><time>{clockLabel(message.timestamp)}</time>{message.pending && <span className="streaming-label">正在回复</span>}</div>{message.role === "assistant" ? <MarkdownMessage content={message.content} /> : <p>{message.content}</p>}</div></article>) : <div className="welcome"><div className="welcome-mark">✳</div><p className="eyebrow">个人 AI 助手</p><h2>{status?.state === "connected" ? "今天有什么可以帮你？" : "连接 OpenClaw Gateway"}</h2><p className="muted">{status?.state === "connected" ? "从下方开始对话，消息会发送到当前会话。" : status?.message ?? "配置 Gateway 地址和凭据后即可开始。"}</p>{status?.state === "connected" && <div className="prompt-grid">{["帮我总结一段文字", "给我一些灵感", "规划今天的安排"].map((prompt) => <button key={prompt} onClick={() => void sendMessage(undefined, prompt)}>{prompt}<span>↗</span></button>)}</div>}{status?.state !== "connected" && <button className="connect-button" onClick={() => void connect()} disabled={busy}>{busy ? "连接中…" : "连接 Gateway"}</button>}</div>}
        </div>
        <div className="composer-area"><form className="composer" onSubmit={(event) => void sendMessage(event)}><textarea aria-label="发送消息" placeholder={status?.state === "connected" ? "给 OpenClaw 发送消息…" : "连接 Gateway 后即可发送消息"} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} rows={2} disabled={status?.state !== "connected" || busy} /><div className="composer-toolbar"><div className="composer-tools"><button type="button" className={`tool-button mic-button ${listening ? "voice-active" : ""}`} onClick={toggleListening} aria-label={listening ? "停止语音输入" : "语音输入"} aria-pressed={listening}>{listening ? "■" : "🎙"}<span>{listening ? "正在聆听" : "语音输入"}</span></button><button type="button" className={`tool-button voice-toggle ${readAloud ? "voice-active" : ""}`} onClick={toggleReadAloud} aria-pressed={readAloud} title="朗读 OpenClaw 回复">{readAloud ? "◖))" : "◖"}<span>朗读回复</span></button></div><div className="composer-actions"><span className="keyboard-hint">{streaming ? "正在生成…" : "↵ 发送 · ⇧↵ 换行"}</span>{streaming ? <button className="stop-button" type="button" onClick={() => void stopStreaming()} aria-label="停止生成">■ 停止</button> : <button className="send-button" type="submit" disabled={!draft.trim() || busy || status?.state !== "connected"} aria-label="发送消息">{busy ? "…" : "↑"}</button>}</div></div></form><p className="composer-note">{listening ? "正在聆听中文语音，识别结果会填入输入框供你确认。" : "语音识别由浏览器提供（部分浏览器可能使用在线服务）；朗读使用设备语音。消息通过 OpenClaw Gateway 处理。"}</p></div>
        {error && <div className="toast-error" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label="关闭错误">×</button></div>}
      </section>
    </main>
  );
}
