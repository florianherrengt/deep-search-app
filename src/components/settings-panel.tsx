import { useState } from "react";
import { Alert, Modal, Button, Text, Group, Divider, Stack } from "@mantine/core";
import { SettingsDiagnosticsSection, SettingsFields, SettingsUpdateSection } from "@/components/settings-fields";
import { useSettings } from "@/hooks/use-settings";
import { PageHeader, PageLayout } from "@/components/page-layout";

export function SettingsPanel() {
  const { settings, updateSetting, resetAll } = useSettings();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  async function handleConfirmReset() {
    setResetPending(true);
    setResetError(null);
    try {
      await resetAll();
      setConfirmOpen(false);
    } catch (error) {
      setResetError(error instanceof Error ? error.message : "Could not reset settings.");
    } finally {
      setResetPending(false);
    }
  }

  return (
    <PageLayout size="sm">
      <Stack gap="xl">
        <PageHeader
          title="Settings"
          description="Configure model providers, search services, integrations, and application preferences."
        />

        <Stack gap="md">
          <SettingsFields settings={settings} updateSetting={updateSetting} />
        </Stack>

        <Divider />
        <Stack gap="md">
          <SettingsUpdateSection />
          <SettingsDiagnosticsSection />
          <Button
            color="red"
            variant="light"
            size="sm"
            w="fit-content"
            onClick={() => {
              setResetError(null);
              setConfirmOpen(true);
            }}
          >
            Reset all settings
          </Button>
        </Stack>

        <Modal
          opened={confirmOpen}
          onClose={() => {
            if (!resetPending) setConfirmOpen(false);
          }}
          title="Reset all settings"
          size="sm"
          closeOnClickOutside={!resetPending}
          closeOnEscape={!resetPending}
        >
          <Text size="sm">
            This will clear all API keys and preferences. This action cannot be undone.
          </Text>
          {resetError ? (
            <Alert color="red" variant="light" mt="md" role="alert">
              {resetError}
            </Alert>
          ) : null}
          <Group justify="flex-end" mt="md">
            <Button variant="default" size="sm" disabled={resetPending} onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button color="red" size="sm" loading={resetPending} onClick={() => void handleConfirmReset()}>
              Reset settings
            </Button>
          </Group>
        </Modal>
      </Stack>
    </PageLayout>
  );
}
