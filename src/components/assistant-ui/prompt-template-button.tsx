import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useAui } from "@assistant-ui/react";
import { ChevronDownIcon, FileTextIcon } from "lucide-react";
import { Box, Paper, UnstyledButton } from "@mantine/core";
import { usePromptTemplates } from "@/hooks/use-prompt-templates";

const ROOT_STYLE: CSSProperties = {
  position: "relative",
  display: "inline-flex",
};

const MENU_BUTTON_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  height: 30,
  padding: "0 10px",
  fontSize: 13,
  borderRadius: 6,
  color: "var(--mantine-color-dimmed)",
  cursor: "pointer",
};

const DROPDOWN_STYLE: CSSProperties = {
  position: "absolute",
  right: 0,
  bottom: "calc(100% + 8px)",
  width: 220,
  zIndex: 300,
  padding: 4,
};

const MENU_ITEM_STYLE: CSSProperties = {
  display: "block",
  width: "100%",
  border: 0,
  background: "transparent",
  borderRadius: 4,
  color: "var(--mantine-color-text)",
  cursor: "pointer",
  font: "inherit",
  fontSize: 13,
  padding: "8px 10px",
  textAlign: "left",
};

const MENU_DIVIDER_STYLE: CSSProperties = {
  borderTop: "1px solid var(--mantine-color-default-border)",
  margin: "4px 0",
};

export function PromptTemplateButton() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const aui = useAui();
  const {
    templates,
    lastSelectedTemplate,
    setLastSelectedTemplate,
  } = usePromptTemplates();

  const lastTemplate = templates.find(
    (t) => t.name === lastSelectedTemplate,
  );

  function handleSendTemplate() {
    if (!lastTemplate) return;
    aui.composer().setText(lastTemplate.text);
    aui.composer().send();
    setOpen(false);
  }

  function handleSelectTemplate(name: string) {
    const template = templates.find((t) => t.name === name);
    if (!template) return;
    void setLastSelectedTemplate(name);
    aui.composer().setText(template.text);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (templates.length === 0) return null;

  return (
    <Box ref={rootRef} style={ROOT_STYLE}>
      <UnstyledButton
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Prompt templates"
        onClick={() => setOpen((current) => !current)}
        style={MENU_BUTTON_STYLE}
      >
        <FileTextIcon size={14} />
        <span style={{ maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {lastTemplate?.name ?? "Templates"}
        </span>
        <ChevronDownIcon size={12} style={{ opacity: 0.5 }} />
      </UnstyledButton>
      {open && (
        <Paper role="menu" shadow="md" withBorder style={DROPDOWN_STYLE}>
          {lastTemplate && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={handleSendTemplate}
                style={MENU_ITEM_STYLE}
              >
                Send &ldquo;{lastTemplate.name}&rdquo;
              </button>
              <div style={MENU_DIVIDER_STYLE} />
            </>
          )}
          {templates.map((template) => (
            <button
              key={template.name}
              type="button"
              role="menuitem"
              onClick={() => handleSelectTemplate(template.name)}
              style={MENU_ITEM_STYLE}
              title={template.text}
            >
              {template.name}
            </button>
          ))}
        </Paper>
      )}
    </Box>
  );
}
