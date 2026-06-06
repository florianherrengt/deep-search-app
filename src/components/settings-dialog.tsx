import { useState } from "react";
import { Modal, Button, Text, Group } from "@mantine/core";
import { SettingsFields } from "@/components/settings-fields";
import { useSettings } from "@/hooks/use-settings";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { settings, updateSetting, resetAll } = useSettings();
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function handleConfirmReset() {
    await resetAll();
    setConfirmOpen(false);
  }

  return (
    <>
      <Modal
        opened={open}
        onClose={() => onOpenChange(false)}
        title="Settings"
        size="lg"
      >
        <Text size="sm" c="dimmed" mb="md">
          Configure API keys and preferences. Changes are saved automatically.
        </Text>

        <SettingsFields settings={settings} updateSetting={updateSetting} />

        <Group style={{ borderTop: "1px solid var(--mantine-color-default-border)", paddingTop: 16 }} mt="md">
          <Button
            color="red"
            size="sm"
            onClick={() => setConfirmOpen(true)}
          >
            Reset All Settings
          </Button>
        </Group>
      </Modal>

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
    </>
  );
}
