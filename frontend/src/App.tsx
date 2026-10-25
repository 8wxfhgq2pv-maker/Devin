import { useMemo, useState, type FormEvent } from "react";

type Message = { id: string; role: "user" | "assistant"; content: string; time: string };
type Conversation = { id: string; title: string; updated: string; messages: Message[] };

const starterConversations: Conversation[] = [
  { id: "today", title: "整理今天的工作", updated: "刚刚", messages: [
    { id: "m1", role: "assistant", content: "你好，我是 OpenClaw。你可以在这里开始一段对话。当前界面处于本地演示模式，接入 Gateway 后就能显示真实回复。", time: "上午 9:41" },
    { id: "m2", role: "user", content: "帮我整理一下今天最重要的三件事。", time: "上午 9:42" },
    { id: "m3", role: "assistant", content: "当然可以。把你今天要处理的事情发给我，我会帮你按优先级整理。", time: "上午 9:42" },
  ] },
  { id: "ideas", title: "周末短途旅行计划", updated: "昨天", messages: [
    { id: "m4", role: "assistant", content: "我们可以先从出发时间、交通方式和你喜欢的活动类型开始规划。", time: "昨天" },
  ] },
  { id: "project", title: "项目灵感收集", updated: "周一", messages: [
    { id: "m5", role: "assistant", content: "把想到的点子直接记下来，我可以帮你归类、补充和展开。", time: "周一" },
  ] },
];

const quickPrompts = ["帮我总结一段文字", "给我一些灵感", "规划今天的安排"];

function clockLabel() {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date());
}

export default function App() {
  const [conversations, setConversations] = useState(starterConversations);
  const [activeId, setActiveId] = useState(starterConversations[0].id);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const active = conversations.find((conversation) => conversation.id === activeId) ?? conversations[0];
  const filtered = useMemo(() => conversations.filter((conversation) => conversation.title.toLowerCase().includes(query.toLowerCase())), [conversations, query]);

  const selectConversation = (id: string) => {
    setActiveId(id);
    setSidebarOpen(false);
  };

  const newConversation = () => {
    const conversation = { id: crypto.randomUUID(), title: "新对话", updated: "刚刚", messages: [] as Message[] };
    setConversations((items) => [conversation, ...items]);
    setActiveId(conversation.id);
    setSidebarOpen(false);
  };

  const sendMessage = (event?: FormEvent, text = draft) => {
    event?.preventDefault();
    const content = text.trim();
    if (!content) return;
    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content, time: clockLabel() };
    setConversations((items) => items.map((conversation) => conversation.id === activeId ? {
      ...conversation,
      title: conversation.title === "新对话" ? content.slice(0,  thirty()) : conversation.title,
      updated: "刚刚",
      messages: [...conversation.messages, userMessage],
    } : conversation));
    setDraft("");
  };

  return (
    <main className="app-shell">
      {sidebarOpen && <button aria-label="关闭导航" className="scrim" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-top">
          <a className="brand" href="#" aria-label="OpenClaw 首页">
            <span className="brand-mark">✳</span><span>openclaw</span>
          </a>
          <button className="icon-button sidebar-close" aria-label="关闭导航" onClick={() => setSidebarOpen(false)}>×</button>
        </div>
        <button className="new-chat" onClick={newConversation}><span className="plus">＋</span> 新建对话 <kbd>⌘ K</kbd></button>
        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <input aria-label="搜索对话" placeholder="搜索对话" value={query} onChange={(event) => setQuery(event.target.value)} />
          <kbd>⌘ F</kbd>
        </label>
        <div className="nav-label">最近</div>
        <nav className="conversation-list" aria-label="最近对话">
          {filtered.map((conversation) => (
            <button key={conversation.id} className={`conversation-item ${conversation.id === activeId ? "active" : ""}`} onClick={() => selectConversation(conversation.id)}>
              <span className="conversation-icon">◌</span><span className="conversation-title">{conversation.title}</span>
            </button>
          ))}
          {filtered.length === 0 && <p className="empty-search">没有找到匹配的对话</p>}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-card">
            <span className="connection-dot" />
            <span><strong>演示模式</strong><small>尚未连接 Gateway</small></span>
            <button className="more-button" aria-label="连接设置">···</button>
          </div>
          <button className="profile-button"><span className="avatar">D</span><span className="profile-copy"><strong>本地工作区</strong><small>个人空间</small></span><span className="more-button">···</span></button>
        </div>
      </aside>

      <section className="chat-panel">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button menu-button" aria-label="打开导航" onClick={() => setSidebarOpen(true)}>☰</button>
            <span className="mobile-brand"><span className="brand-mark">✳</span> openclaw</span>
            <span className="topbar-divider" />
            <span className="model-label"><span className="model-dot" /> OpenClaw <span className="chevron">⌄</span></span>
          </div>
          <div className="topbar-right">
            <span className="demo-pill"><span className="connection-dot" />演示模式</span>
            <button className="icon-button" aria-label="更多选项">···</button>
          </div>
        </header>

        <div className="conversation-heading">
          <div><p className="eyebrow">对话</p><h1>{active.title}</h1></div>
          <button className="share-button" onClick={() => void navigator.clipboard?.writeText(window.location.href)}>↗ <span>分享</span></button>
        </div>

        <div className="messages" aria-live="polite">
          {active.messages.length ? active.messages.map((message) => (
            <article key={message.id} className={`message message-${message.role}`}>
              {message.role === "assistant" ? <div className="assistant-avatar">✳</div> : <div className="user-avatar">D</div>}
              <div className="message-body">
                <div className="message-meta"><strong>{message.role === "assistant" ? "OpenClaw" : "你"}</strong><time>{message.time}</time></div>
                <p>{message.content}</p>
              </div>
              {message.role === "assistant" && <button className="message-more" aria-label="消息选项">···</button>}
            </article>
          )) : (
            <div className="welcome">
              <div className="welcome-mark">✳</div>
              <p className="eyebrow">个人 AI 助手</p>
              <h2>今天有什么可以帮你？</h2>
              <p className="muted">开始一段对话，探索 OpenClaw 的能力。</p>
              <div className="prompt-grid">
                {quickPrompts.map((prompt) => <button key={prompt} onClick={() => sendMessage(undefined, prompt)}>{prompt}<span>↗</span></button>)}
              </div>
            </div>
          )}
        </div>

        <div className="composer-area">
          <form className="composer" onSubmit={(event) => sendMessage(event)}>
            <textarea aria-label="发送消息" placeholder="给 OpenClaw 发送消息…" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} rows={2} />
            <div className="composer-toolbar">
              <div className="composer-tools">
                <button type="button" className="tool-button" aria-label="添加附件">＋</button>
                <button type="button" className="tool-button mode-button"><span>◉</span> 自动 <span className="chevron">⌄</span></button>
              </div>
              <div className="composer-actions"><span className="keyboard-hint">↵ 发送 · ⇧↵ 换行</span><button className="send-button" type="submit" disabled={!draft.trim()} aria-label="发送消息">↑</button></div>
            </div>
          </form>
          <p className="composer-note">演示模式：消息仅保存在当前页面，尚未发送到 OpenClaw Gateway。</p>
        </div>
      </section>
    </main>
  );
}

function thirty() { return 30; }
