import { AlertCircle, Download, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppUpdate, type AppUpdateState } from "@/hooks/use-app-update";
import { cn } from "@/lib/utils";

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
  const ActionIcon = isBusy ? Loader2 : isError ? RotateCcw : Download;

  return (
    <div
      className={cn(
        "flex h-8 max-w-[42vw] items-center gap-1 rounded-md border px-1.5 text-xs",
        isError
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100",
      )}
      data-testid="app-update"
      title={isError ? state.error : state.update.body}
    >
      {isError ? (
        <AlertCircle className="size-3.5 shrink-0" />
      ) : (
        <Download className="size-3.5 shrink-0" />
      )}
      <span className="hidden max-w-[180px] truncate sm:inline">
        {getStatusLabel(state)}
      </span>
      <Button
        type="button"
        size="xs"
        variant={isError ? "outline" : "default"}
        className="h-6"
        disabled={isBusy}
        onClick={() => {
          void installUpdate();
        }}
      >
        <ActionIcon className={cn(isBusy && "animate-spin")} />
        <span className="hidden md:inline">{getActionLabel(state)}</span>
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        disabled={isBusy}
        aria-label="Dismiss update notification"
        onClick={dismissUpdate}
      >
        <X />
      </Button>
    </div>
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
