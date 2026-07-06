import "@assistant-ui/react-markdown/styles/dot.css";
import {
  unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from "@assistant-ui/react-markdown";
import { useMessagePartText } from "@assistant-ui/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  memo,
  useEffect,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type FC,
} from "react";
import { useClipboard } from "@mantine/hooks";
import { CheckIcon, CopyIcon } from "lucide-react";
import { openUrl } from "@/lib/tauri-bridge";

const REMARK_PLUGINS = [remarkGfm];
const STREAMING_MARKDOWN_RENDER_INTERVAL_MS = 1000;

const MarkdownTextImpl = () => {
  const { text, status } = useMessagePartText();
  const running = status.type === "running";
  const throttledStreamingText = useThrottledStreamingText(text, running);

  if (running) {
    if (throttledStreamingText.length === 0) return null;
    return <MarkdownContent text={throttledStreamingText} />;
  }

  return <MarkdownContent text={text} />;
};
export const MarkdownText = MarkdownTextImpl;

function useThrottledStreamingText(text: string, running: boolean): string {
  const [renderedText, setRenderedText] = useState(text);
  const renderedTextRef = useRef(text);
  const pendingTextRef = useRef(text);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFlushAtRef = useRef(text.length > 0 ? Date.now() : 0);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const clearScheduledFlush = () => {
      if (timeoutRef.current === null) return;
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    };

    const flush = (nextText: string) => {
      renderedTextRef.current = nextText;
      lastFlushAtRef.current = Date.now();
      setRenderedText(nextText);
    };

    if (!running) {
      clearScheduledFlush();
      pendingTextRef.current = text;
      lastFlushAtRef.current = 0;
      if (renderedTextRef.current !== text) {
        flush(text);
      }
      return;
    }

    pendingTextRef.current = text;

    if (text.length === 0) {
      clearScheduledFlush();
      lastFlushAtRef.current = 0;
      if (renderedTextRef.current.length > 0) {
        flush("");
      }
      return;
    }

    if (renderedTextRef.current.length === 0) {
      clearScheduledFlush();
      flush(text);
      return;
    }

    if (renderedTextRef.current === text) {
      return;
    }

    const elapsedMs = Date.now() - lastFlushAtRef.current;
    const remainingMs = Math.max(
      STREAMING_MARKDOWN_RENDER_INTERVAL_MS - elapsedMs,
      0,
    );

    if (remainingMs === 0) {
      clearScheduledFlush();
      flush(text);
      return;
    }

    if (timeoutRef.current !== null) {
      return;
    }

    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      if (pendingTextRef.current !== renderedTextRef.current) {
        flush(pendingTextRef.current);
      }
    }, remainingMs);
  }, [running, text]);

  if (running && renderedText.length === 0 && text.length > 0) {
    return text;
  }

  return running ? renderedText : text;
}

export const MarkdownContent = memo(function MarkdownContent({
  text,
}: {
  text: string;
}) {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={defaultComponents}>
      {text}
    </ReactMarkdown>
  );
});

const CodeHeader: FC<{
  language?: string;
  code: string;
}> = ({ language, code }) => {
  const clipboard = useClipboard({ timeout: 3000 });

  return (
    <div className="md-code-bg" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderRadius: "8px 8px 0 0", padding: "8px 16px", fontSize: 12 }}>
      <span style={{ color: "var(--mantine-color-dimmed)" }}>{language}</span>
      <button
        onClick={() => code && clipboard.copy(code)}
        aria-label="Copy code"
        className="md-icon-btn"
        style={{ display: "flex", alignItems: "center", gap: 4 }}
      >
        {clipboard.copied ? (
          <CheckIcon style={{ width: 14, height: 14 }} />
        ) : (
          <CopyIcon style={{ width: 14, height: 14 }} />
        )}
      </button>
    </div>
  );
};

const defaultComponents = memoizeMarkdownComponents({
  a: ({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href) openUrl(href);
      }}
      style={{ color: "var(--mantine-color-blue-6)", textDecoration: "underline" }}
      {...props}
    >
      {children}
    </a>
  ),
  pre: ({ style, ...props }) => (
    <pre
      className="md-code-bg"
      style={{
        overflowX: "auto",
        borderRadius: 8,
        padding: 16,
        ...style,
      }}
      {...props}
    />
  ),
  code: function Code({ style, ...props }) {
    const isCodeBlock = useIsMarkdownCodeBlock();
    return (
      <code
        className={!isCodeBlock ? "md-code-bg" : undefined}
        style={
          !isCodeBlock
            ? {
                borderRadius: 4,
                padding: "2px 6px",
                fontSize: 14,
                ...style,
              }
            : style
        }
        {...props}
      />
    );
  },
  CodeHeader,
});
