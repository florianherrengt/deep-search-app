import { isTauri, checkForUpdate, relaunchApp, type AppUpdate, type DownloadEvent, isDownloadStartedEvent, isDownloadProgressEvent } from "@/lib/tauri-bridge";
import { useCallback, useEffect, useReducer, useRef } from "react";

const CHECK_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
export const APP_UPDATE_CHECK_INTERVAL_MS = 60 * 60_000;

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

type AppUpdateAction =
  | { type: "check_started" }
  | { type: "check_completed"; update: AppUpdateInfo | null }
  | { type: "check_failed"; error: string }
  | { type: "download_started"; update: AppUpdateInfo }
  | { type: "download_progress"; update: AppUpdateInfo; progress: number | null }
  | { type: "install_started"; update: AppUpdateInfo; progress: number | null }
  | { type: "relaunch_started"; update: AppUpdateInfo }
  | { type: "install_failed"; update: AppUpdateInfo; error: string }
  | { type: "dismissed" };

type AppUpdateCheckOptions = {
  silent?: boolean;
};

type StorybookWindow = Window & {
  __storybookAppUpdateState?: AppUpdateState;
};

export function appUpdateReducer(
  _state: AppUpdateState,
  action: AppUpdateAction,
): AppUpdateState {
  switch (action.type) {
    case "check_started":
      return { status: "checking" };
    case "check_completed":
      return action.update === null
        ? { status: "hidden" }
        : { status: "available", update: action.update };
    case "check_failed":
      return { status: "check-error", error: action.error };
    case "download_started":
      return { status: "downloading", update: action.update, progress: null };
    case "download_progress":
      return {
        status: "downloading",
        update: action.update,
        progress: action.progress,
      };
    case "install_started":
      return {
        status: "installing",
        update: action.update,
        progress: action.progress,
      };
    case "relaunch_started":
      return { status: "restarting", update: action.update };
    case "install_failed":
      return {
        status: "error",
        update: action.update,
        error: action.error,
      };
    case "dismissed":
      return { status: "hidden" };
  }
}

export function useAppUpdate(options?: { manual?: boolean }) {
  const manual = options?.manual ?? false;
  const updateRef = useRef<AppUpdate | null>(null);
  const [state, dispatch] = useReducer(appUpdateReducer, {
    status: "hidden",
  }, () => getInitialAppUpdateState());
  const stateRef = useRef(state);
  stateRef.current = state;
  const latestCheckIdRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      latestCheckIdRef.current += 1;
      const update = updateRef.current;
      updateRef.current = null;
      void update?.close().catch(() => undefined);
    };
  }, []);

  const checkForUpdates = useCallback((checkOptions?: AppUpdateCheckOptions) => {
    if (!isTauri()) return;
    const silent = checkOptions?.silent ?? false;
    const checkId = latestCheckIdRef.current + 1;
    latestCheckIdRef.current = checkId;

    if (!silent) {
      dispatch({ type: "check_started" });
    }

    void checkForUpdate({ timeout: CHECK_TIMEOUT_MS })
      .then((update) => {
        if (!isMountedRef.current || checkId !== latestCheckIdRef.current) {
          void update?.close().catch(() => undefined);
          return;
        }

        if (!update) {
          if (!silent) {
            dispatch({ type: "check_completed", update: null });
          }
          return;
        }

        const previousUpdate = updateRef.current;
        if (previousUpdate && previousUpdate !== update) {
          void previousUpdate.close().catch(() => undefined);
        }

        updateRef.current = update;
        dispatch({
          type: "check_completed",
          update: toUpdateInfo(update),
        });
      })
      .catch((error) => {
        if (!silent && isMountedRef.current && checkId === latestCheckIdRef.current) {
          dispatch({
            type: "check_failed",
            error: getErrorMessage(error),
          });
        }
      });
  }, []);

  useEffect(() => {
    if (manual) return;
    checkForUpdates({ silent: true });
    const intervalId = window.setInterval(() => {
      if (stateRef.current.status === "hidden") {
        checkForUpdates({ silent: true });
      }
    }, APP_UPDATE_CHECK_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [checkForUpdates, manual]);

  const retry = useCallback(() => {
    const update = updateRef.current;
    updateRef.current = null;
    void update?.close().catch(() => undefined);
    checkForUpdates();
  }, [checkForUpdates]);

  const installUpdate = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;

    const updateInfo = toUpdateInfo(update);
    let contentLength: number | null = null;
    let downloaded = 0;

    try {
      dispatch({
        type: "download_started",
        update: updateInfo,
      });

      await update.downloadAndInstall(
        (event) => {
          const progress = getDownloadProgress(event, {
            contentLength,
            downloaded,
          });

          contentLength = progress.contentLength;
          downloaded = progress.downloaded;

          if (event.event === "Finished") {
            dispatch({
              type: "install_started",
              update: updateInfo,
              progress: progress.percent,
            });
            return;
          }

          dispatch({
            type: "download_progress",
            update: updateInfo,
            progress: progress.percent,
          });
        },
        { timeout: DOWNLOAD_TIMEOUT_MS },
      );

      dispatch({ type: "relaunch_started", update: updateInfo });
      await relaunchApp();
    } catch (error) {
      dispatch({
        type: "install_failed",
        update: updateInfo,
        error: getErrorMessage(error),
      });
    }
  }, []);

  const dismissUpdate = useCallback(() => {
    latestCheckIdRef.current += 1;
    const update = updateRef.current;
    updateRef.current = null;
    void update?.close().catch(() => undefined);
    dispatch({ type: "dismissed" });
  }, []);

  return {
    state,
    checkForUpdates,
    installUpdate,
    retryUpdate: retry,
    dismissUpdate,
  };
}

function getInitialAppUpdateState(): AppUpdateState {
  if (typeof window === "undefined") return { status: "hidden" };
  return (window as StorybookWindow).__storybookAppUpdateState ?? { status: "hidden" };
}

function toUpdateInfo(update: AppUpdate): AppUpdateInfo {
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    date: update.date,
    body: update.body,
  };
}

export function getDownloadProgress(
  event: DownloadEvent,
  current: { contentLength: number | null; downloaded: number },
) {
  let { contentLength, downloaded } = current;

  if (isDownloadStartedEvent(event)) {
    contentLength = event.data.contentLength ?? null;
    downloaded = 0;
  }

  if (isDownloadProgressEvent(event)) {
    downloaded += event.data.chunkLength;
  }

  const percent =
    contentLength && contentLength > 0
      ? Math.min(100, Math.round((downloaded / contentLength) * 100))
      : null;

  return { contentLength, downloaded, percent };
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Could not install the update.";
}
