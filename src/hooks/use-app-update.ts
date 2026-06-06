import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useReducer, useRef } from "react";

const CHECK_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

interface AppUpdateInfo {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
}

export type AppUpdateState =
  | { status: "hidden" }
  | { status: "checking" }
  | { status: "available"; update: AppUpdateInfo }
  | { status: "downloading"; update: AppUpdateInfo; progress: number | null }
  | { status: "installing"; update: AppUpdateInfo; progress: number | null }
  | { status: "restarting"; update: AppUpdateInfo }
  | { status: "error"; update: AppUpdateInfo; error: string };

type AppUpdateAction =
  | { type: "check_started" }
  | { type: "check_completed"; update: AppUpdateInfo | null }
  | { type: "download_started"; update: AppUpdateInfo }
  | { type: "download_progress"; update: AppUpdateInfo; progress: number | null }
  | { type: "install_started"; update: AppUpdateInfo; progress: number | null }
  | { type: "relaunch_started"; update: AppUpdateInfo }
  | { type: "install_failed"; update: AppUpdateInfo; error: string }
  | { type: "dismissed" };

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

export function useAppUpdate() {
  const updateRef = useRef<Update | null>(null);
  const [state, dispatch] = useReducer(appUpdateReducer, {
    status: "hidden",
  });

  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;
    dispatch({ type: "check_started" });

    void check({ timeout: CHECK_TIMEOUT_MS })
      .then((update) => {
        if (cancelled) {
          void update?.close().catch(() => undefined);
          return;
        }

        if (!update) {
          dispatch({ type: "check_completed", update: null });
          return;
        }

        updateRef.current = update;
        dispatch({
          type: "check_completed",
          update: toUpdateInfo(update),
        });
      })
      .catch(() => {
        if (!cancelled) {
          dispatch({ type: "check_completed", update: null });
        }
      });

    return () => {
      cancelled = true;
      const update = updateRef.current;
      updateRef.current = null;
      void update?.close().catch(() => undefined);
    };
  }, []);

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
      await relaunch();
    } catch (error) {
      dispatch({
        type: "install_failed",
        update: updateInfo,
        error: getErrorMessage(error),
      });
    }
  }, []);

  const dismissUpdate = useCallback(() => {
    const update = updateRef.current;
    updateRef.current = null;
    void update?.close().catch(() => undefined);
    dispatch({ type: "dismissed" });
  }, []);

  return {
    state,
    installUpdate,
    dismissUpdate,
  };
}

function toUpdateInfo(update: Update): AppUpdateInfo {
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    date: update.date,
    body: update.body,
  };
}

function getDownloadProgress(
  event: DownloadEvent,
  current: { contentLength: number | null; downloaded: number },
) {
  let { contentLength, downloaded } = current;

  if (event.event === "Started") {
    contentLength = event.data.contentLength ?? null;
    downloaded = 0;
  }

  if (event.event === "Progress") {
    downloaded += event.data.chunkLength;
  }

  const percent =
    contentLength && contentLength > 0
      ? Math.min(100, Math.round((downloaded / contentLength) * 100))
      : null;

  return { contentLength, downloaded, percent };
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Could not install the update.";
}
