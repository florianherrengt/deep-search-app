import "@assistant-ui/react-markdown/styles/dot.css";
import {
  MarkdownTextPrimitive,
  unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { type FC, memo, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const MarkdownTextImpl = () => {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      components={defaultComponents}
    />
  );
};
export const MarkdownText = memo(MarkdownTextImpl);

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
    <div className="flex items-center justify-between rounded-t-lg bg-zinc-100 px-4 py-2 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
      <span>{language}</span>
      <button
        onClick={onCopy}
        className="flex items-center gap-1 text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        {isCopied ? (
          <CheckIcon className="h-3.5 w-3.5" />
        ) : (
          <CopyIcon className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
};

const defaultComponents = memoizeMarkdownComponents({
  h1: ({ className, ...props }) => (
    <h1 className={cn("mb-4 mt-6 text-2xl font-bold", className)} {...props} />
  ),
  h2: ({ className, ...props }) => (
    <h2 className={cn("mb-3 mt-5 text-xl font-semibold", className)} {...props} />
  ),
  h3: ({ className, ...props }) => (
    <h3 className={cn("mb-2 mt-4 text-lg font-semibold", className)} {...props} />
  ),
  p: ({ className, ...props }) => (
    <p className={cn("mb-3 leading-7", className)} {...props} />
  ),
  ul: ({ className, ...props }) => (
    <ul className={cn("mb-3 ml-6 list-disc [&>li]:mt-1", className)} {...props} />
  ),
  ol: ({ className, ...props }) => (
    <ol className={cn("mb-3 ml-6 list-decimal [&>li]:mt-1", className)} {...props} />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn("border-l-4 border-zinc-300 pl-4 italic", className)}
      {...props}
    />
  ),
  pre: ({ className, ...props }) => (
    <pre
      className={cn(
        "overflow-x-auto rounded-lg bg-zinc-100 p-4 dark:bg-zinc-800",
        className,
      )}
      {...props}
    />
  ),
  code: function Code({ className, ...props }) {
    const isCodeBlock = useIsMarkdownCodeBlock();
    return (
      <code
        className={cn(
          !isCodeBlock &&
            "rounded bg-zinc-100 px-1.5 py-0.5 text-sm dark:bg-zinc-800",
          className,
        )}
        {...props}
      />
    );
  },
  CodeHeader,
});
