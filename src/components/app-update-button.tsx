import { AlertCircle, Download, Loader2, X } from "lucide-react";
import { ActionIcon, Box, Group, Tooltip } from "@mantine/core";
import { useAppUpdate, type AppUpdateState } from "@/hooks/use-app-update";

type VisibleAppUpdateState = Exclude<
  AppUpdateState,
  { status: "hidden" } | { status: "checking" }
>;

export function AppUpdateButton() {
  const { state, installUpdate, retryUpdate, dismissUpdate } = useAppUpdate();

  if (state.status === "hidden" || state.status === "checking") {
    return null;
  }

  const visibleState: VisibleAppUpdateState = state;
  const isBusy =
    visibleState.status === "downloading" ||
    visibleState.status === "installing" ||
    visibleState.status === "restarting";
  const isError = visibleState.status === "error" || visibleState.status === "check-error";
  const StatusIcon = isBusy ? Loader2 : isError ? AlertCircle : Download;
  const actionLabel = getActionLabel(visibleState);
  const tooltipLabel = getTooltipLabel(visibleState, actionLabel);
  const canDismiss = !isBusy;

  function handleAction() {
    if (visibleState.status === "available") {
      void installUpdate();
      return;
    }

    if (visibleState.status === "check-error" || visibleState.status === "error") {
      retryUpdate();
    }
  }

  return (
    <Group
      gap={2}
      h={28}
      wrap="nowrap"
      data-testid="app-update"
      title={tooltipLabel}
    >
      <Tooltip label={tooltipLabel} position="bottom-end" withArrow>
        <ActionIcon
          size="sm"
          radius="sm"
          variant="subtle"
          color={isError ? "red" : "gray"}
          aria-label={tooltipLabel}
          disabled={isBusy}
          onClick={handleAction}
          styles={{
            root: {
              position: "relative",
            },
          }}
        >
          <StatusIcon
            size={15}
            style={isBusy ? { animation: "spin 1s linear infinite" } : undefined}
          />
          {isError && !isBusy && (
            <Box
              component="span"
              aria-hidden="true"
              style={{
                position: "absolute",
                top: 5,
                right: 5,
                width: 6,
                height: 6,
                borderRadius: 999,
                backgroundColor: "var(--mantine-color-red-6)",
                boxShadow: "0 0 0 2px var(--mantine-color-body)",
              }}
            />
          )}
        </ActionIcon>
      </Tooltip>
      {canDismiss && (
        <Tooltip label="Dismiss update notification" position="bottom-end" withArrow>
          <ActionIcon
            size={22}
            radius="sm"
            variant="subtle"
            color="gray"
            aria-label="Dismiss update notification"
            onClick={dismissUpdate}
          >
            <X size={12} />
          </ActionIcon>
        </Tooltip>
      )}
    </Group>
  );
}

function getStatusLabel(state: VisibleAppUpdateState) {
  switch (state.status) {
    case "check-error":
      return "Update check failed";
    case "available":
      return `Version ${state.update.version} is available`;
    case "downloading":
      return state.progress === null
        ? "Downloading update"
        : `Downloading update ${state.progress}%`;
    case "installing":
      return "Installing update";
    case "restarting":
      return "Restarting";
    case "error":
      return "Update failed";
  }
}

function getActionLabel(state: VisibleAppUpdateState) {
  switch (state.status) {
    case "check-error":
    case "error":
      return "Retry";
    case "available":
      return "Install";
    case "downloading":
      return "Downloading";
    case "installing":
      return "Installing";
    case "restarting":
      return "Restarting";
  }
}

function getTooltipLabel(state: VisibleAppUpdateState, actionLabel: string) {
  const statusLabel = getStatusLabel(state);

  if (state.status === "available") {
    return `${statusLabel}. Click to ${actionLabel.toLowerCase()}.`;
  }

  if (state.status === "check-error" || state.status === "error") {
    return `${statusLabel}. Click to retry.`;
  }

  return statusLabel;
}
