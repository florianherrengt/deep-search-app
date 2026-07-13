import { useAui } from "@assistant-ui/react";
import { CheckIcon, ChevronDownIcon, FileTextIcon, SendIcon } from "lucide-react";
import { Button, Menu } from "@mantine/core";
import { usePromptTemplates } from "@/hooks/use-prompt-templates";

export function PromptTemplateButton() {
  const aui = useAui();
  const {
    templates,
    lastSelectedTemplate,
    setLastSelectedTemplate,
  } = usePromptTemplates();

  const lastTemplate = templates.find(
    (template) => template.name === lastSelectedTemplate,
  );

  function handleSendTemplate() {
    if (!lastTemplate) return;
    aui.composer().setText(lastTemplate.text);
    aui.composer().send();
  }

  function handleSelectTemplate(name: string) {
    const template = templates.find((candidate) => candidate.name === name);
    if (!template) return;
    void setLastSelectedTemplate(name);
    aui.composer().setText(template.text);
  }

  if (templates.length === 0) return null;

  return (
    <Menu
      position="top-end"
      width={240}
      shadow="sm"
      withinPortal
      closeOnItemClick
      returnFocus
    >
      <Menu.Target>
        <Button
          variant="subtle"
          color="gray"
          size="compact-sm"
          aria-label="Prompt templates"
          leftSection={<FileTextIcon size={14} />}
          rightSection={<ChevronDownIcon size={12} />}
          styles={{
            label: {
              maxWidth: 120,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            },
          }}
        >
          {lastTemplate?.name ?? "Templates"}
        </Button>
      </Menu.Target>

      <Menu.Dropdown>
        {lastTemplate ? (
          <>
            <Menu.Item
              leftSection={<SendIcon size={14} />}
              onClick={handleSendTemplate}
            >
              Send “{lastTemplate.name}”
            </Menu.Item>
            <Menu.Divider />
          </>
        ) : null}

        <Menu.Label>Insert a template</Menu.Label>
        {templates.map((template) => (
          <Menu.Item
            key={template.name}
            leftSection={
              template.name === lastSelectedTemplate
                ? <CheckIcon size={14} />
                : <FileTextIcon size={14} />
            }
            onClick={() => handleSelectTemplate(template.name)}
          >
            {template.name}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
