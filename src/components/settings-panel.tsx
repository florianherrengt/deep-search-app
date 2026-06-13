import { useState } from "react";
import { Modal, Button, Text, Group, Box, ScrollArea, Stack } from "@mantine/core";
import { SettingsFields } from "@/components/settings-fields";
import { useSettings } from "@/hooks/use-settings";

export function SettingsPanel() {
  const { settings, updateSetting, resetAll } = useSettings();
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function handleConfirmReset() {
    await resetAll();
    setConfirmOpen(false);
  }

  return (
    <ScrollArea style={{ height: "100%" }}>
      <Box maw={512} mx="auto" p="md" py={32}>
        <Text size="lg" fw={600}>Settings</Text>
        <Text size="sm" c="dimmed" mt={4}>
          Configure API keys and preferences. Provider changes are saved on demand.
        </Text>

        <Stack gap="md" mt="md">
          <SettingsFields settings={settings} updateSetting={updateSetting} />
        </Stack>

        <Box mt="md" className="md-divider-top" pt={16}>
          <Button
            color="red"
            size="sm"
            onClick={() => setConfirmOpen(true)}
          >
            Reset All Settings
          </Button>
        </Box>

        <Modal
          opened={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          title="Reset All Settings"
          size="sm"
        >
          <Text size="sm">
            This will clear all API keys and preferences. This action cannot be undone.
          </Text>
          <Group justify="flex-end" mt="md">
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button color="red" size="sm" onClick={handleConfirmReset}>
              Confirm Reset
            </Button>
          </Group>
        </Modal>
      </Box>
    </ScrollArea>
  );
}
