import { useCallback, useState } from "react";

interface AppUpdateInfo {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
}

export type AppUpdateState =
  | { status: "hidden" }
  | { status: "checking" }
  | { status: "check-error"; error: string }
  | { status: "available"; update: AppUpdateInfo }
  | { status: "downloading"; update: AppUpdateInfo; progress: number | null }
  | { status: "installing"; update: AppUpdateInfo; progress: number | null }
  | { status: "restarting"; update: AppUpdateInfo }
  | { status: "error"; update: AppUpdateInfo; error: string };

declare global {
  interface Window {
    __storybookAppUpdateState?: AppUpdateState;
  }
}

export function useAppUpdate(_options?: { manual?: boolean }) {
  const [state, setState] = useState<AppUpdateState>(
    () => window.__storybookAppUpdateState ?? { status: "hidden" },
  );

  const checkForUpdates = useCallback(() => {
    setState({ status: "checking" });
  }, []);

  const installUpdate = useCallback(async () => {
    setState((current) => {
      if (!("update" in current)) return current;
      return { status: "downloading", update: current.update, progress: 42 };
    });
  }, []);

  const retryUpdate = useCallback(() => {
    setState({ status: "checking" });
  }, []);

  const dismissUpdate = useCallback(() => {
    setState({ status: "hidden" });
  }, []);

  return { state, checkForUpdates, installUpdate, retryUpdate, dismissUpdate };
}
