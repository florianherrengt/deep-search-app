import { describe, it, expect } from "vitest";
import { appUpdateReducer, type AppUpdateState } from "../use-app-update";

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
