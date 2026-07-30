import { AlertCircle, Download, Loader2, RefreshCw, X } from "lucide-react";
import {
  ActionIcon,
  Badge,
  Box,
  Group,
  Text,
  Tooltip,
} from "@mantine/core";
import { useAppUpdate, type AppUpdateState } from "@/hooks/use-app-update";
import { useSettings } from "@/hooks/use-settings";

type VisibleAppUpdateState = Exclude<
  AppUpdateState,
  { status: "hidden" } | { status: "checking" }
>;

export function AppUpdateButton() {
  const { settings } = useSettings();
  const { state, installUpdate, retryUpdate, dismissUpdate } = useAppUpdate({
    autoDownload: settings.auto_download_updates,
  });

  if (state.status === "hidden" || state.status === "checking") {
    return null;
  }

  const visibleState: VisibleAppUpdateState = state;
  const isBusy =
    visibleState.status === "downloading" ||
    visibleState.status === "installing" ||
    visibleState.status === "restarting";
  const isError =
    visibleState.status === "error" || visibleState.status === "check-error";
  const isAvailable = visibleState.status === "available";
  const autoDownload = settings.auto_download_updates;
  const canDismiss = !isBusy;

  function handleAction() {
    if (visibleState.status === "available") {
      void installUpdate();
      return;
    }

    if (
      visibleState.status === "check-error" ||
      visibleState.status === "error"
    ) {
      retryUpdate();
    }
  }

  // Highlighted "available" pill: version + Download action + dismiss.
  if (isAvailable) {
    const actionLabel = autoDownload
      ? "Downloading…"
      : "Download";
    return (
      <Group
        gap={6}
        h={28}
        wrap="nowrap"
        align="center"
        data-testid="app-update"
      >
        <Badge
          size="md"
          radius="xl"
          variant="filled"
          color="blue"
          leftSection={<Download size={12} />}
          styles={{ root: { paddingRight: 4 }, label: { textTransform: "none" } }}
        >
          v{visibleState.update.version}
        </Badge>
        <Tooltip
          label={getTooltipLabel(visibleState)}
          position="bottom-end"
          withArrow
        >
          <Box
            component="button"
            type="button"
            onClick={handleAction}
            disabled={autoDownload}
            aria-label={`Download version ${visibleState.update.version}`}
            data-testid="app-update-download"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 26,
              paddingInline: 10,
              borderRadius: 999,
              border: "none",
              cursor: autoDownload ? "default" : "pointer",
              color: "var(--mantine-color-white)",
              backgroundColor: "var(--mantine-color-blue-filled)",
              transition: "background-color 100ms ease",
            }}
          >
            {autoDownload ? (
              <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
            ) : null}
            <Text component="span" size="xs" fw={600} c="white">
              {actionLabel}
            </Text>
          </Box>
        </Tooltip>
        {canDismiss && (
          <Tooltip
            label="Dismiss update notification"
            position="bottom-end"
            withArrow
          >
            <ActionIcon
              size={22}
              radius={999}
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

  // Busy state: compact pill with spinner + inline percent.
  if (isBusy) {
    const label = getStatusLabel(visibleState);
    return (
      <Group gap={6} h={28} wrap="nowrap" align="center" data-testid="app-update">
        <Badge
          size="md"
          radius="xl"
          variant="light"
          color="blue"
          leftSection={
            <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
          }
          styles={{ root: { paddingLeft: 6 }, label: { textTransform: "none" } }}
        >
          {label}
        </Badge>
      </Group>
    );
  }

  // Error state: red-emphasized pill with visible short label + Retry.
  if (isError) {
    const tooltipLabel = getTooltipLabel(visibleState);
    return (
      <Group gap={6} h={28} wrap="nowrap" align="center" data-testid="app-update">
        <Tooltip label={tooltipLabel} position="bottom-end" withArrow>
          <Box
            component="button"
            type="button"
            onClick={handleAction}
            aria-label={tooltipLabel}
            data-testid="app-update-retry"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 26,
              paddingInline: 10,
              borderRadius: 999,
              border: "1px solid var(--mantine-color-red-4)",
              cursor: "pointer",
              color: "var(--mantine-color-red-7)",
              backgroundColor: "var(--mantine-color-red-light)",
            }}
          >
            <AlertCircle size={13} />
            <Text component="span" size="xs" fw={600}>
              {visibleState.status === "check-error"
                ? "Check failed"
                : "Update failed"}
            </Text>
            <RefreshCw size={12} />
          </Box>
        </Tooltip>
        <Tooltip
          label="Dismiss update notification"
          position="bottom-end"
          withArrow
        >
          <ActionIcon
            size={22}
            radius={999}
            variant="subtle"
            color="gray"
            aria-label="Dismiss update notification"
            onClick={dismissUpdate}
          >
            <X size={12} />
          </ActionIcon>
        </Tooltip>
      </Group>
    );
  }

  return null;
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
        : `Downloading ${state.progress}%`;
    case "installing":
      return state.progress === null
        ? "Installing update"
        : `Installing ${state.progress}%`;
    case "restarting":
      return "Restarting";
    case "error":
      return "Update failed";
  }
}

function getTooltipLabel(state: VisibleAppUpdateState) {
  const statusLabel = getStatusLabel(state);

  if (state.status === "available") {
    return `${statusLabel}. Click to download.`;
  }

  if (state.status === "check-error" || state.status === "error") {
    return `${statusLabel}: ${state.error}. Click to retry.`;
  }

  return statusLabel;
}
