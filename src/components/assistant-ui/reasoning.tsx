import { useCallback, useRef, useState } from "react";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import { useScrollLock } from "@assistant-ui/react";
import { UnstyledButton, Box } from "@mantine/core";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";

const ANIMATION_DURATION = 200;

export type ReasoningRootProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  variant?: "outline" | "ghost" | "muted";
  className?: string;
  children?: React.ReactNode;
};

function ReasoningRoot({
  variant = "outline",
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  children,
}: ReasoningRootProps) {
  const collapsibleRef = useRef<HTMLDivElement>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        lockScroll();
      }
      if (!isControlled) {
        setUncontrolledOpen(open);
      }
      controlledOnOpenChange?.(open);
    },
    [lockScroll, isControlled, controlledOnOpenChange],
  );

  const variantStyles: Record<string, React.CSSProperties> = {
    outline: { borderRadius: 8, border: "1px solid var(--mantine-color-default-border)", padding: "8px 12px" },
    ghost: {},
    muted: { borderRadius: 8, padding: "8px 12px" },
  };

  const variantClassNames: Record<string, string> = {
    outline: "",
    ghost: "",
    muted: "md-code-bg",
  };

  return (
    <Box
      ref={collapsibleRef}
      mb="md"
      className={variantClassNames[variant]}
      style={{ width: "100%", ...variantStyles[variant] }}
    >
      {typeof children === "function"
        ? (children as (props: { open: boolean; onToggle: () => void }) => React.ReactNode)({ open: isOpen, onToggle: () => handleOpenChange(!isOpen) })
        : children}
    </Box>
  );
}

function ReasoningTrigger({
  active,
  duration,
  onClick,
}: {
  active?: boolean;
  duration?: number;
  className?: string;
  onClick?: () => void;
}) {
  const durationText = duration ? ` (${duration}s)` : "";
  return (
    <UnstyledButton onClick={onClick} aria-label="Thinking process" style={{ display: "flex", width: "100%", alignItems: "center", gap: 6, fontSize: 14, color: "var(--mantine-color-dimmed)" }}>
      <BrainIcon style={{ width: 16, height: 16 }} />
      <ChevronDownIcon style={{ width: 12, height: 12, transition: "transform 0.2s" }} />
      <span>Thinking{durationText}</span>
      {active ? (
        <span style={{ display: "inline-block", marginLeft: 4, width: 12, height: 12, borderRadius: "50%", backgroundColor: "var(--mantine-color-blue-5)", animation: "pulse 1.5s ease-in-out infinite" }} />
      ) : null}
    </UnstyledButton>
  );
}

function ReasoningContent({
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <Box mt="xs">{children}</Box>
  );
}

function ReasoningText({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={className} {...props}>
      <MarkdownText />
    </div>
  );
}

export {
  ReasoningRoot,
  ReasoningTrigger,
  ReasoningContent,
  ReasoningText,
};
