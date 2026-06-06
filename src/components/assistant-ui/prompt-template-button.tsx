import { useState } from "react";
import { useAui } from "@assistant-ui/react";
import { ChevronDownIcon, FileTextIcon } from "lucide-react";
import { Menu, UnstyledButton } from "@mantine/core";
import { usePromptTemplates } from "@/hooks/use-prompt-templates";

export function PromptTemplateButton() {
  const [open, setOpen] = useState(false);
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
  }

  function handleSelectTemplate(name: string) {
    const template = templates.find((t) => t.name === name);
    if (!template) return;
    void setLastSelectedTemplate(name);
    aui.composer().setText(template.text);
    setOpen(false);
  }

  if (templates.length === 0) return null;

  return (
    <Menu
      shadow="md"
      position="top-start"
      opened={open}
      onChange={setOpen}
      width={220}
    >
      <Menu.Target>
        <UnstyledButton
          aria-label="Prompt templates"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 30,
            padding: "0 10px",
            fontSize: 13,
            borderRadius: 6,
            color: "var(--mantine-color-dimmed)",
            cursor: "pointer",
          }}
        >
          <FileTextIcon size={14} />
          <span style={{ maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {lastTemplate?.name ?? "Templates"}
          </span>
          <ChevronDownIcon size={12} style={{ opacity: 0.5 }} />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        {lastTemplate && (
          <>
            <Menu.Item
              onClick={() => { handleSendTemplate(); setOpen(false); }}
            >
              Send &ldquo;{lastTemplate.name}&rdquo;
            </Menu.Item>
            <Menu.Divider />
          </>
        )}
        {templates.map((template) => (
          <Menu.Item
            key={template.name}
            onClick={() => handleSelectTemplate(template.name)}
            title={template.text}
          >
            {template.name}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
