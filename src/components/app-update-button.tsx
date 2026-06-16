import { AlertCircle, Download, Loader2, RotateCcw, X } from "lucide-react";
import { Button, Group, Text, ActionIcon } from "@mantine/core";
import { useAppUpdate, type AppUpdateState } from "@/hooks/use-app-update";

export function AppUpdateButton() {
  const { state, installUpdate, retryUpdate, dismissUpdate } = useAppUpdate();

  if (state.status === "hidden" || state.status === "checking") {
    return null;
  }

  const isBusy =
    state.status === "downloading" ||
    state.status === "installing" ||
    state.status === "restarting";
  const isError = state.status === "error" || state.status === "check-error";
  const StatusIcon = isBusy ? Loader2 : isError ? RotateCcw : Download;
  const errorMessage = state.status === "check-error" ? state.error : state.status === "error" ? state.error : undefined;
  const statusLabel = state.status === "check-error" ? "Update check failed" : getStatusLabel(state);
  const actionLabel = state.status === "check-error" ? "Retry" : getActionLabel(state);

  return (
    <Group
      gap={4}
      style={{
        height: 32,
        maxWidth: "42vw",
        padding: "0 6px",
        borderRadius: 6,
        border: "1px solid",
        fontSize: 12,
        ...(isError
          ? { borderColor: "light-dark(var(--mantine-color-red-3), var(--mantine-color-red-7))", backgroundColor: "light-dark(var(--mantine-color-red-0), var(--mantine-color-red-9))", color: "var(--mantine-color-red-text)" }
          : { borderColor: "light-dark(var(--mantine-color-orange-3), var(--mantine-color-orange-7))", backgroundColor: "light-dark(var(--mantine-color-orange-0), var(--mantine-color-orange-9))", color: "var(--mantine-color-orange-text)" }),
      }}
      data-testid="app-update"
      title={isError ? errorMessage : state.update.body}
    >
      {isError ? (
        <AlertCircle size={14} style={{ flexShrink: 0 }} />
      ) : (
        <Download size={14} style={{ flexShrink: 0 }} />
      )}
      <Text size="xs" style={{ maxWidth: 180 }} truncate hiddenFrom="sm">
        {statusLabel}
      </Text>
      <Button
        size="compact-xs"
        variant={isError ? "outline" : "filled"}
        color={isError ? "red" : "gray"}
        disabled={isBusy}
        onClick={() => void (state.status === "check-error" ? retryUpdate() : installUpdate())}
        leftSection={<StatusIcon size={12} style={isBusy ? { animation: "spin 1s linear infinite" } : undefined} />}
      >
        <Text size="xs" hiddenFrom="md">{actionLabel}</Text>
      </Button>
      <ActionIcon
        size="xs"
        variant="subtle"
        color="gray"
        disabled={isBusy}
        aria-label="Dismiss update notification"
        onClick={dismissUpdate}
      >
        <X size={12} />
      </ActionIcon>
    </Group>
  );
}

function getStatusLabel(state: Extract<AppUpdateState, { update: unknown }>) {
  switch (state.status) {
    case "available":
      return `Version ${state.update.version} is available`;
    case "downloading":
      return state.progress === null
        ? "Downloading update"
        : `Downloading ${state.progress}%`;
    case "installing":
      return "Installing update";
    case "restarting":
      return "Restarting";
    case "error":
      return "Update failed";
  }
}

function getActionLabel(state: Extract<AppUpdateState, { update: unknown }>) {
  switch (state.status) {
    case "available":
      return "Update";
    case "downloading":
      return "Downloading";
    case "installing":
      return "Installing";
    case "restarting":
      return "Restarting";
    case "error":
      return "Retry";
  }
}
