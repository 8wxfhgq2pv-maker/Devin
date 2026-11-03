import { memo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

function languageOf(children: ReactNode): string {
  const first = Array.isArray(children) ? children[0] : children;
  const className = first && typeof first === "object" && "props" in first
    ? (first as { props?: { className?: unknown } }).props?.className
    : "";
  const match = typeof className === "string" ? /language-([\w+#.-]+)/.exec(className) : null;
  return match?.[1] ?? "";
}

/** Code blocks get a language bar and their own copy button. */
function CodeBlock({ children }: { children?: ReactNode }) {
  const preRef = useRef<HTMLPreElement | null>(null);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const text = preRef.current?.textContent ?? "";
    if (!text) return;
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }).catch(() => setCopied(false));
  };
  return (
    <div className="code-block">
      <div className="code-block-bar">
        <span>{languageOf(children) || "text"}</span>
        <button type="button" className="code-copy" onClick={copy}>{copied ? "已复制" : "复制"}</button>
      </div>
      <pre ref={preRef}>{children}</pre>
    </div>
  );
}

const components: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>,
};

/**
 * Assistant output is rendered as GitHub-flavoured Markdown. Raw HTML stays escaped because
 * no raw-HTML plugin is installed, so model output cannot inject markup into the page.
 * Highlighting uses rehype-highlight's bundled common grammar set.
 */
export const MarkdownMessage = memo(function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
