import { describe, it, expect } from "vitest";
import {
  appUpdateReducer,
  getDownloadProgress,
  getErrorMessage,
  type AppUpdateState,
} from "../use-app-update";
import type { DownloadEvent } from "@/lib/tauri-bridge";

const updateInfo = {
  version: "2.0.0",
  currentVersion: "1.0.0",
  date: "2026-06-06",
  body: "Release notes",
};

describe("appUpdateReducer", () => {
  it("check_started → checking", () => {
    const state: AppUpdateState = { status: "hidden" };
    const next = appUpdateReducer(state, { type: "check_started" });
    expect(next).toEqual({ status: "checking" });
  });

  it("check_completed with null → hidden", () => {
    const state: AppUpdateState = { status: "checking" };
    const next = appUpdateReducer(state, {
      type: "check_completed",
      update: null,
    });
    expect(next).toEqual({ status: "hidden" });
  });

  it("check_completed with update → available", () => {
    const state: AppUpdateState = { status: "checking" };
    const next = appUpdateReducer(state, {
      type: "check_completed",
      update: updateInfo,
    });
    expect(next).toEqual({ status: "available", update: updateInfo });
  });

  it("download_started → downloading with null progress", () => {
    const state: AppUpdateState = { status: "available", update: updateInfo };
    const next = appUpdateReducer(state, {
      type: "download_started",
      update: updateInfo,
    });
    expect(next).toEqual({
      status: "downloading",
      update: updateInfo,
      progress: null,
    });
  });

  it("download_progress → downloading with percent", () => {
    const state: AppUpdateState = {
      status: "downloading",
      update: updateInfo,
      progress: null,
    };
    const next = appUpdateReducer(state, {
      type: "download_progress",
      update: updateInfo,
      progress: 42,
    });
    expect(next).toEqual({
      status: "downloading",
      update: updateInfo,
      progress: 42,
    });
  });

  it("install_started → installing", () => {
    const state: AppUpdateState = {
      status: "downloading",
      update: updateInfo,
      progress: 100,
    };
    const next = appUpdateReducer(state, {
      type: "install_started",
      update: updateInfo,
      progress: 100,
    });
    expect(next).toEqual({
      status: "installing",
      update: updateInfo,
      progress: 100,
    });
  });

  it("relaunch_started → restarting", () => {
    const state: AppUpdateState = {
      status: "installing",
      update: updateInfo,
      progress: null,
    };
    const next = appUpdateReducer(state, {
      type: "relaunch_started",
      update: updateInfo,
    });
    expect(next).toEqual({ status: "restarting", update: updateInfo });
  });

  it("install_failed → error", () => {
    const state: AppUpdateState = {
      status: "downloading",
      update: updateInfo,
      progress: 50,
    };
    const next = appUpdateReducer(state, {
      type: "install_failed",
      update: updateInfo,
      error: "Network error",
    });
    expect(next).toEqual({
      status: "error",
      update: updateInfo,
      error: "Network error",
    });
  });

  it("dismissed → hidden", () => {
    const state: AppUpdateState = { status: "available", update: updateInfo };
    const next = appUpdateReducer(state, { type: "dismissed" });
    expect(next).toEqual({ status: "hidden" });
  });

  it("dismissed from error → hidden", () => {
    const state: AppUpdateState = {
      status: "error",
      update: updateInfo,
      error: "Some error",
    };
    const next = appUpdateReducer(state, { type: "dismissed" });
    expect(next).toEqual({ status: "hidden" });
  });
});

describe("getDownloadProgress", () => {
  it("Started event sets contentLength, resets downloaded, percent calculated", () => {
    const event: DownloadEvent = {
      event: "Started",
      data: { contentLength: 1000 },
    };
    const result = getDownloadProgress(event, {
      contentLength: null,
      downloaded: 0,
    });
    expect(result).toEqual({
      contentLength: 1000,
      downloaded: 0,
      percent: 0,
    });
  });

  it("Progress event increments downloaded and updates percent", () => {
    const event: DownloadEvent = {
      event: "Progress",
      data: { chunkLength: 500 },
    };
    const result = getDownloadProgress(event, {
      contentLength: 1000,
      downloaded: 0,
    });
    expect(result).toEqual({
      contentLength: 1000,
      downloaded: 500,
      percent: 50,
    });
  });

  it("Progress without prior Started returns null percent", () => {
    const event: DownloadEvent = {
      event: "Progress",
      data: { chunkLength: 500 },
    };
    const result = getDownloadProgress(event, {
      contentLength: null,
      downloaded: 0,
    });
    expect(result).toEqual({
      contentLength: null,
      downloaded: 500,
      percent: null,
    });
  });

  it("multiple Progress events accumulate downloaded", () => {
    const event: DownloadEvent = {
      event: "Progress",
      data: { chunkLength: 300 },
    };
    const result = getDownloadProgress(event, {
      contentLength: 1000,
      downloaded: 500,
    });
    expect(result).toEqual({
      contentLength: 1000,
      downloaded: 800,
      percent: 80,
    });
  });

  it("percent is capped at 100 when Progress exceeds contentLength", () => {
    const event: DownloadEvent = {
      event: "Progress",
      data: { chunkLength: 100 },
    };
    const result = getDownloadProgress(event, {
      contentLength: 1000,
      downloaded: 950,
    });
    expect(result).toEqual({
      contentLength: 1000,
      downloaded: 1050,
      percent: 100,
    });
  });

  it("Started with null contentLength returns null percent", () => {
    const event: DownloadEvent = {
      event: "Started",
      data: { contentLength: undefined },
    };
    const result = getDownloadProgress(event, {
      contentLength: null,
      downloaded: 100,
    });
    expect(result).toEqual({
      contentLength: null,
      downloaded: 0,
      percent: null,
    });
  });
});

describe("getErrorMessage", () => {
  it("returns message from Error instances", () => {
    const error = new Error("Something went wrong");
    expect(getErrorMessage(error)).toBe("Something went wrong");
  });

  it("returns the string as-is", () => {
    expect(getErrorMessage("Network failure")).toBe("Network failure");
  });

  it("returns default message for non-string, non-Error values", () => {
    expect(getErrorMessage(42)).toBe("Could not install the update.");
  });
});
