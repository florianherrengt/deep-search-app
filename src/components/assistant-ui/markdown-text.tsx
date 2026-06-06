import "@assistant-ui/react-markdown/styles/dot.css";
import {
  MarkdownTextPrimitive,
  unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { type AnchorHTMLAttributes, type FC, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

const MarkdownTextImpl = () => {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      components={defaultComponents}
    />
  );
};
export const MarkdownText = MarkdownTextImpl;

const CodeHeader: FC<{
  language?: string;
  code: string;
}> = ({ language, code }) => {
  const [isCopied, setIsCopied] = useState(false);

  const onCopy = () => {
    if (!code || isCopied) return;
    navigator.clipboard.writeText(code).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 3000);
    });
  };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderRadius: "8px 8px 0 0", backgroundColor: "var(--mantine-color-gray-1)", padding: "8px 16px", fontSize: 12 }}>
      <span style={{ color: "var(--mantine-color-dimmed)" }}>{language}</span>
      <button
        onClick={onCopy}
        aria-label="Copy code"
        style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--mantine-color-dimmed)", background: "none", border: "none", cursor: "pointer" }}
      >
        {isCopied ? (
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
      style={{
        overflowX: "auto",
        borderRadius: 8,
        backgroundColor: "var(--mantine-color-gray-1)",
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
        style={
          !isCodeBlock
            ? {
                borderRadius: 4,
                backgroundColor: "var(--mantine-color-gray-1)",
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
