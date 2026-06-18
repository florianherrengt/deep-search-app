export type StoreOptions = {
  autoSave: boolean;
  defaults?: { [key: string]: unknown };
};
let _isTauri: boolean | null = null;

export function isTauri(): boolean {
  if (_isTauri !== null) return _isTauri;
  if (typeof window === "undefined") {
    _isTauri = false;
    return false;
  }
  _isTauri = "__TAURI_INTERNALS__" in window;
  return _isTauri;
}

export type FetchFn = typeof fetch;

export async function fetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const mock = getBridgeMock("fetch");
  if (mock) return (mock as FetchFn)(input, init);

  if (isTauri()) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch(input, init);
  }

  return globalThis.fetch(input, init);
}

function requireTauri(): void {
  if (!isTauri()) {
    throw new Error("This function requires the Tauri runtime. Set window.__deepSearchBridgeMock to mock it in tests.");
  }
}

export async function invoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const mock = getBridgeMock("invoke");
  if (mock) return (mock(cmd, args) ?? undefined) as T;

  requireTauri();

  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

export async function writeTextFile(
  path: string,
  content: string,
  opts?: { baseDir?: number; append?: boolean },
): Promise<void> {
  const mock = getBridgeMock("writeTextFile");
  if (mock) return mock(path, content, opts);
  requireTauri();
  const { writeTextFile: fn, BaseDirectory } = await import(
    "@tauri-apps/plugin-fs"
  );
  return fn(path, content, {
    baseDir: opts?.baseDir ?? BaseDirectory.AppData,
    append: opts?.append,
  });
}

export async function readTextFile(
  path: string,
  opts?: { baseDir: number },
): Promise<string> {
  const mock = getBridgeMock("readTextFile");
  if (mock) return mock(path, opts);
  requireTauri();
  const { readTextFile: fn, BaseDirectory } = await import(
    "@tauri-apps/plugin-fs"
  );
  return fn(path, { baseDir: opts?.baseDir ?? BaseDirectory.AppData });
}

export async function exists(
  path: string,
  opts?: { baseDir: number },
): Promise<boolean> {
  const mock = getBridgeMock("exists");
  if (mock) return mock(path, opts);
  requireTauri();
  const { exists: fn, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  return fn(path, { baseDir: opts?.baseDir ?? BaseDirectory.AppData });
}

export async function readDir(
  path: string,
  opts?: { baseDir: number },
): Promise<DirEntry[]> {
  const mock = getBridgeMock("readDir");
  if (mock) return mock(path, opts);
  requireTauri();
  const { readDir: fn, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  return fn(path, { baseDir: opts?.baseDir ?? BaseDirectory.AppData });
}

export async function remove(
  path: string,
  opts?: { baseDir?: number; recursive?: boolean },
): Promise<void> {
  const mock = getBridgeMock("remove");
  if (mock) return mock(path, opts);
  requireTauri();
  const { remove: fn, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  return fn(path, {
    baseDir: opts?.baseDir ?? BaseDirectory.AppData,
    recursive: opts?.recursive,
  });
}

export async function rename(
  oldPath: string,
  newPath: string,
  opts?: { oldPathBaseDir: number; newPathBaseDir: number },
): Promise<void> {
  const mock = getBridgeMock("rename");
  if (mock) return mock(oldPath, newPath, opts);
  requireTauri();
  const { rename: fn, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  return fn(oldPath, newPath, {
    oldPathBaseDir: opts?.oldPathBaseDir ?? BaseDirectory.AppData,
    newPathBaseDir: opts?.newPathBaseDir ?? BaseDirectory.AppData,
  });
}

export async function mkdir(
  path: string,
  opts?: { baseDir?: number; recursive?: boolean },
): Promise<void> {
  const mock = getBridgeMock("mkdir");
  if (mock) return mock(path, opts);
  requireTauri();
  const { mkdir: fn, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  return fn(path, {
    baseDir: opts?.baseDir ?? BaseDirectory.AppData,
    recursive: opts?.recursive ?? true,
  });
}

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

export async function loadStore(
  filename: string,
  options: StoreOptions,
): Promise<{
  get: <V>(key: string) => Promise<V | null>;
  set: (key: string, value: unknown) => Promise<void>;
  save: () => Promise<void>;
}> {
  const mock = getBridgeMock("loadStore");
  if (mock) return mock(filename, options);

  requireTauri();
  const { load } = await import("@tauri-apps/plugin-store");
  const store = await load(filename, options as any);
  return {
    get: <V>(key: string) => store.get<V>(key) as Promise<V | null>,
    set: (key: string, value: unknown) => store.set(key, value),
    save: () => store.save(),
  };
}

export async function appDataDir(): Promise<string> {
  const mock = getBridgeMock("appDataDir");
  if (mock) return mock();

  requireTauri();
  const { appDataDir: fn } = await import("@tauri-apps/api/path");
  return fn();
}

export async function join(...paths: string[]): Promise<string> {
  const mock = getBridgeMock("join");
  if (mock) return mock(...paths);

  requireTauri();
  const { join: fn } = await import("@tauri-apps/api/path");
  return fn(...paths);
}

export async function resolveResource(path: string): Promise<string> {
  requireTauri();
  const { resolveResource: fn } = await import("@tauri-apps/api/path");
  return fn(path);
}

export async function openUrl(url: string): Promise<void> {
  const mock = getBridgeMock("openUrl");
  if (mock) return mock(url);

  requireTauri();
  const { openUrl: fn } = await import("@tauri-apps/plugin-opener");
  return fn(url);
}

export async function openPath(path: string): Promise<void> {
  const mock = getBridgeMock("openPath");
  if (mock) return mock(path);

  requireTauri();
  const { openPath: fn } = await import("@tauri-apps/plugin-opener");
  return fn(path);
}

export async function setupMenu(
  onPreferences: () => void,
  onNewChat: () => void,
): Promise<void> {
  const mock = getBridgeMock("setupMenu");
  if (mock) return mock(onPreferences, onNewChat);

  requireTauri();
  const { setupMenu: fn } = await import("@/lib/setup-menu-impl");
  return fn(onPreferences, onNewChat);
}

export async function isNotificationPermissionGranted(): Promise<boolean> {
  const { isPermissionGranted } = await import(
    "@tauri-apps/plugin-notification"
  );
  return isPermissionGranted();
}

export async function requestNotificationPermission(): Promise<string> {
  const { requestPermission } = await import(
    "@tauri-apps/plugin-notification"
  );
  return requestPermission();
}

let notificationClickHandler:
  | ((notification: { extra?: Record<string, unknown> }) => void)
  | null = null;

export function sendNotification(options: {
  title: string;
  body: string;
  extra?: Record<string, unknown>;
}): void {
  const mock = getBridgeMock("sendNotification");
  if (mock) {
    mock(options);
    return;
  }

  if (typeof window === "undefined" || !("Notification" in window)) {
    return;
  }

  const notification = new window.Notification(options.title, {
    body: options.body,
  });

  if (notificationClickHandler) {
    const extra = options.extra;
    notification.onclick = () => {
      notificationClickHandler?.({ extra });
    };
  }
}

export function onNotificationAction(
  callback: (notification: { extra?: Record<string, unknown> }) => void,
): () => void {
  notificationClickHandler = callback;

  return () => {
    notificationClickHandler = null;
  };
}

export interface SidecarCommand {
  stdout: { on(event: "data", cb: (data: string) => void): void };
  stderr: { on(event: "data", cb: (data: string) => void): void };
  on(event: "error", cb: (error: string) => void): void;
  on(event: "close", cb: (data: { code: number | null; signal: number | null }) => void): void;
  spawn(): Promise<SidecarChild>;
  execute(): Promise<{ code: number | null; signal: number | null; stdout: string; stderr: string }>;
}

export interface SidecarChild {
  readonly pid: number;
  write(data: string): Promise<void>;
  kill(): Promise<void>;
}

export async function createSidecarCommand(
  program: string,
  args: string | string[],
): Promise<SidecarCommand> {
  requireTauri();
  const { Command } = await import("@tauri-apps/plugin-shell");
  return Command.sidecar(program, args) as unknown as SidecarCommand;
}

export async function createSystemCommand(
  alias: string,
  args: string | string[],
): Promise<SidecarCommand> {
  requireTauri();
  const { Command } = await import("@tauri-apps/plugin-shell");
  return Command.create(alias, args) as unknown as SidecarCommand;
}

export async function registerSidecarPid(pid: number): Promise<void> {
  requireTauri();
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("register_sidecar_pid", { pid }).catch(() => {});
}

export async function unregisterSidecarPid(): Promise<void> {
  requireTauri();
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("unregister_sidecar_pid").catch(() => {});
}

export interface AppUpdate {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
  close(): Promise<void>;
  downloadAndInstall(
    onEvent: (event: DownloadEvent) => void,
    opts?: { timeout: number },
  ): Promise<void>;
}

export interface DownloadEvent {
  event: "Started" | "Progress" | "Finished";
  data:
    | { contentLength?: number }
    | { chunkLength: number }
    | Record<string, unknown>;
}

export function isDownloadStartedEvent(
  event: DownloadEvent,
): event is DownloadEvent & { event: "Started"; data: { contentLength?: number } } {
  return event.event === "Started";
}

export function isDownloadProgressEvent(
  event: DownloadEvent,
): event is DownloadEvent & { event: "Progress"; data: { chunkLength: number } } {
  return event.event === "Progress";
}

export async function checkForUpdate(opts?: {
  timeout: number;
}): Promise<AppUpdate | null> {
  const mock = getBridgeMock("checkForUpdate");
  if (mock) return mock(opts);

  requireTauri();
  const { check } = await import("@tauri-apps/plugin-updater");
  return check(opts) as Promise<AppUpdate | null>;
}

export async function relaunchApp(): Promise<void> {
  const mock = getBridgeMock("relaunchApp");
  if (mock) return mock();

  requireTauri();
  const { relaunch } = await import("@tauri-apps/plugin-process");
  return relaunch();
}

export type TauriBridgeMock = {
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  loadStore?: (
    filename: string,
    options: StoreOptions,
  ) => Promise<{
    get: <V>(key: string) => Promise<V | null>;
    set: (key: string, value: unknown) => Promise<void>;
    save: () => Promise<void>;
  }>;
  writeTextFile?: (path: string, content: string, opts?: { baseDir?: number; append?: boolean }) => Promise<void>;
  readTextFile?: (path: string, opts?: { baseDir: number }) => Promise<string>;
  exists?: (path: string, opts?: { baseDir: number }) => Promise<boolean>;
  readDir?: (path: string, opts?: { baseDir: number }) => Promise<DirEntry[]>;
  remove?: (path: string, opts?: { baseDir?: number; recursive?: boolean }) => Promise<void>;
  rename?: (oldPath: string, newPath: string, opts?: { oldPathBaseDir: number; newPathBaseDir: number }) => Promise<void>;
  mkdir?: (path: string, opts?: { baseDir?: number; recursive?: boolean }) => Promise<void>;
  appDataDir?: () => Promise<string>;
  join?: (...paths: string[]) => Promise<string>;
  openUrl?: (url: string) => Promise<void>;
  openPath?: (path: string) => Promise<void>;
  setupMenu?: (
    onPreferences: () => void,
    onNewChat: () => void,
  ) => Promise<void>;
  sendNotification?: (options: {
    title: string;
    body: string;
    extra?: Record<string, unknown>;
  }) => void;
  checkForUpdate?: (opts?: {
    timeout: number;
  }) => Promise<AppUpdate | null>;
  relaunchApp?: () => Promise<void>;
};

declare global {
  interface Window {
    __deepSearchBridgeMock?: TauriBridgeMock;
  }
}

function getBridgeMock<K extends keyof TauriBridgeMock>(
  key: K,
): TauriBridgeMock[K] | undefined {
  if (typeof window === "undefined") return undefined;
  return window.__deepSearchBridgeMock?.[key];
}

export function setBridgeMock(mock: TauriBridgeMock): void {
  window.__deepSearchBridgeMock = mock;
}

export function clearBridgeMock(): void {
  delete window.__deepSearchBridgeMock;
}
