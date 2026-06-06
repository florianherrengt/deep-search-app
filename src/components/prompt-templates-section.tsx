import { useState, useCallback } from "react";
import { PencilIcon, TrashIcon, PlusIcon, XIcon, CheckIcon } from "lucide-react";
import { Button, TextInput, Textarea, Box, Text, Group, Paper, Stack, ScrollArea, ActionIcon } from "@mantine/core";
import { usePromptTemplates } from "@/hooks/use-prompt-templates";

type EditingState =
  | { mode: "idle" }
  | { mode: "add" }
  | { mode: "edit"; originalName: string };

export function PromptTemplatesSection() {
  const {
    templates,
    addTemplate,
    updateTemplate,
    deleteTemplate,
  } = usePromptTemplates();

  const [editing, setEditing] = useState<EditingState>({ mode: "idle" });
  const [draftName, setDraftName] = useState("");
  const [draftText, setDraftText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const startAdd = useCallback(() => {
    setEditing({ mode: "add" });
    setDraftName("");
    setDraftText("");
    setError(null);
  }, []);

  const startEdit = useCallback((template: { name: string; text: string }) => {
    setEditing({ mode: "edit", originalName: template.name });
    setDraftName(template.name);
    setDraftText(template.text);
    setError(null);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditing({ mode: "idle" });
    setDraftName("");
    setDraftText("");
    setError(null);
  }, []);

  const handleSave = useCallback(async () => {
    const name = draftName.trim();
    const text = draftText.trim();
    if (!name) {
      setError("Name is required");
      return;
    }
    if (!text) {
      setError("Prompt text is required");
      return;
    }

    try {
      if (editing.mode === "add") {
        await addTemplate({ name, text });
      } else if (editing.mode === "edit") {
        await updateTemplate(editing.originalName, { name, text });
      }
      cancelEdit();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }, [editing.mode, draftName, draftText, addTemplate, updateTemplate, cancelEdit]);

  const handleDelete = useCallback(
    async (name: string) => {
      try {
        await deleteTemplate(name);
        if (editing.mode === "edit" && editing.originalName === name) {
          cancelEdit();
        }
      } catch {
        // store handles cleanup
      }
    },
    [deleteTemplate, editing, cancelEdit],
  );

  return (
    <Box style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box maw={640} mx="auto" w="100%" px="md" py={32} style={{ flexShrink: 0 }}>
        <Group justify="space-between">
          <Box>
            <Text size="lg" fw={600}>Prompt Templates</Text>
            <Text size="sm" c="dimmed" mt={4}>
              Create reusable prompts for quick access from the chat.
            </Text>
          </Box>
          <Button
            variant="outline"
            size="sm"
            onClick={startAdd}
            disabled={editing.mode !== "idle"}
            leftSection={<PlusIcon size={14} />}
          >
            Add
          </Button>
        </Group>
      </Box>

      <ScrollArea style={{ flex: 1, minHeight: 0 }} pb={32}>
        <Box maw={640} mx="auto" w="100%" px="md">
          {editing.mode !== "idle" ? (
            <Paper withBorder p="md" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
              <Stack gap="sm" style={{ flex: 1, minHeight: 0 }}>
                <TextInput
                  label="Name"
                  value={draftName}
                  onChange={(e) => {
                    setDraftName(e.currentTarget.value);
                    setError(null);
                  }}
                  placeholder="Template name"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleSave();
                    } else if (e.key === "Escape") {
                      cancelEdit();
                    }
                  }}
                />
                <Box style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                  <Text size="sm" fw={500} mb={4}>Prompt</Text>
                  <Textarea
                    value={draftText}
                    onChange={(e) => {
                      setDraftText(e.currentTarget.value);
                      setError(null);
                    }}
                    placeholder="Enter prompt text..."
                    autosize
                    minRows={6}
                    style={{ flex: 1 }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") cancelEdit();
                    }}
                  />
                </Box>
                {error && (
                  <Text size="sm" c="red">{error}</Text>
                )}
                <Group gap="xs">
                  <Button size="sm" onClick={() => void handleSave()} leftSection={<CheckIcon size={14} />}>
                    Save
                  </Button>
                  <Button variant="outline" size="sm" onClick={cancelEdit} leftSection={<XIcon size={14} />}>
                    Cancel
                  </Button>
                </Group>
              </Stack>
            </Paper>
          ) : templates.length > 0 ? (
            <Paper withBorder>
              {templates.map((template, index) => (
                <Group
                  key={template.name}
                  justify="space-between"
                  px="md"
                  py="sm"
                  style={index > 0 ? { borderTop: "1px solid var(--mantine-color-default-border)" } : undefined}
                >
                  <Box style={{ minWidth: 0, flex: 1 }}>
                    <Text size="sm" fw={500} truncate>{template.name}</Text>
                    <Text size="xs" c="dimmed" lineClamp={2} mt={2} style={{ whiteSpace: "pre-wrap" }}>
                      {template.text}
                    </Text>
                  </Box>
                  <Group gap={2}>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="gray"
                      aria-label={`Edit ${template.name}`}
                      title="Edit"
                      onClick={() => startEdit(template)}
                    >
                      <PencilIcon size={14} />
                    </ActionIcon>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="gray"
                      aria-label={`Delete ${template.name}`}
                      title="Delete"
                      onClick={() => void handleDelete(template.name)}
                    >
                      <TrashIcon size={14} />
                    </ActionIcon>
                  </Group>
                </Group>
              ))}
            </Paper>
          ) : (
            <Paper withBorder p="sm" style={{ borderStyle: "dashed" }}>
              <Text size="sm" c="dimmed">No templates yet. Click Add to create one.</Text>
            </Paper>
          )}
        </Box>
      </ScrollArea>
    </Box>
  );
}
