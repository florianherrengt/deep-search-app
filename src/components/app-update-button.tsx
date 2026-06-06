import { AlertCircle, Download, Loader2, RotateCcw, X } from "lucide-react";
import { Button, Group, Text, ActionIcon } from "@mantine/core";
import { useAppUpdate, type AppUpdateState } from "@/hooks/use-app-update";

export function AppUpdateButton() {
  const { state, installUpdate, dismissUpdate } = useAppUpdate();

  if (state.status === "hidden" || state.status === "checking") {
    return null;
  }

  const isBusy =
    state.status === "downloading" ||
    state.status === "installing" ||
    state.status === "restarting";
  const isError = state.status === "error";
  const StatusIcon = isBusy ? Loader2 : isError ? RotateCcw : Download;

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
          ? { borderColor: "var(--mantine-color-red-3)", backgroundColor: "var(--mantine-color-red-0)", color: "var(--mantine-color-red-7)" }
          : { borderColor: "var(--mantine-color-amber-3)", backgroundColor: "var(--mantine-color-amber-0)", color: "var(--mantine-color-amber-9)" }),
      }}
      data-testid="app-update"
      title={isError ? state.error : state.update.body}
    >
      {isError ? (
        <AlertCircle size={14} style={{ flexShrink: 0 }} />
      ) : (
        <Download size={14} style={{ flexShrink: 0 }} />
      )}
      <Text size="xs" style={{ maxWidth: 180 }} truncate hiddenFrom="sm">
        {getStatusLabel(state)}
      </Text>
      <Button
        size="compact-xs"
        variant={isError ? "outline" : "filled"}
        color={isError ? "red" : "gray"}
        disabled={isBusy}
        onClick={() => void installUpdate()}
        leftSection={<StatusIcon size={12} style={isBusy ? { animation: "spin 1s linear infinite" } : undefined} />}
      >
        <Text size="xs" hiddenFrom="md">{getActionLabel(state)}</Text>
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
