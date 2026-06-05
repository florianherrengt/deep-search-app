import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";

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

export function useAppUpdate() {
  const updateRef = useRef<Update | null>(null);
  const [state, setState] = useState<AppUpdateState>({ status: "hidden" });

  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;
    setState({ status: "checking" });

    void check({ timeout: CHECK_TIMEOUT_MS })
      .then((update) => {
        if (cancelled) {
          void update?.close().catch(() => undefined);
          return;
        }

        if (!update) {
          setState({ status: "hidden" });
          return;
        }

        updateRef.current = update;
        setState({ status: "available", update: toUpdateInfo(update) });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: "hidden" });
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
      setState({
        status: "downloading",
        update: updateInfo,
        progress: null,
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
            setState({
              status: "installing",
              update: updateInfo,
              progress: progress.percent,
            });
            return;
          }

          setState({
            status: "downloading",
            update: updateInfo,
            progress: progress.percent,
          });
        },
        { timeout: DOWNLOAD_TIMEOUT_MS },
      );

      setState({ status: "restarting", update: updateInfo });
      await relaunch();
    } catch (error) {
      setState({
        status: "error",
        update: updateInfo,
        error: getErrorMessage(error),
      });
    }
  }, []);

  const dismissUpdate = useCallback(() => {
    const update = updateRef.current;
    updateRef.current = null;
    void update?.close().catch(() => undefined);
    setState({ status: "hidden" });
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
