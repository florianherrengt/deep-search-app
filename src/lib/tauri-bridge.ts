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

  if (!isTauri() && hasBrowserStorage()) {
    return invokeBrowserFallback<T>(cmd, args);
  }

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
  if (!isTauri() && hasBrowserStorage()) {
    browserWriteTextFile(path, content, Boolean(opts?.append));
    return;
  }
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
  if (!isTauri() && hasBrowserStorage()) {
    return browserReadTextFile(path);
  }
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
  if (!isTauri() && hasBrowserStorage()) {
    return browserExists(path);
  }
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
  if (!isTauri() && hasBrowserStorage()) {
    return browserReadDir(path);
  }
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
  if (!isTauri() && hasBrowserStorage()) {
    browserRemove(path, Boolean(opts?.recursive));
    return;
  }
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
  if (!isTauri() && hasBrowserStorage()) {
    browserRename(oldPath, newPath);
    return;
  }
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
  if (!isTauri() && hasBrowserStorage()) {
    browserMkdir(path);
    return;
  }
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

  if (!isTauri() && hasBrowserStorage()) {
    return loadBrowserStore(filename, options);
  }

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

  if (!isTauri() && hasBrowserStorage()) {
    return "browser-local-storage";
  }

  requireTauri();
  const { appDataDir: fn } = await import("@tauri-apps/api/path");
  return fn();
}

export async function join(...paths: string[]): Promise<string> {
  const mock = getBridgeMock("join");
  if (mock) return mock(...paths);

  if (!isTauri() && hasBrowserStorage()) {
    return normalizeBrowserPath(paths.join("/"));
  }

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

  if (!isTauri() && typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  requireTauri();
  const { openUrl: fn } = await import("@tauri-apps/plugin-opener");
  return fn(url);
}

export async function openPath(path: string): Promise<void> {
  const mock = getBridgeMock("openPath");
  if (mock) return mock(path);

  if (!isTauri()) {
    console.info(`[Deep Search] Cannot reveal local path outside Tauri: ${path}`);
    return;
  }

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

  if (!isTauri()) {
    return;
  }

  requireTauri();
  const { setupMenu: fn } = await import("@/lib/setup-menu-impl");
  return fn(onPreferences, onNewChat);
}

export async function isNotificationPermissionGranted(): Promise<boolean> {
  if (!isTauri() && typeof window !== "undefined" && "Notification" in window) {
    return window.Notification.permission === "granted";
  }

  const { isPermissionGranted } = await import(
    "@tauri-apps/plugin-notification"
  );
  return isPermissionGranted();
}

export async function requestNotificationPermission(): Promise<string> {
  if (!isTauri() && typeof window !== "undefined" && "Notification" in window) {
    return window.Notification.requestPermission();
  }

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
  env?: Record<string, string>,
): Promise<SidecarCommand> {
  requireTauri();
  const { Command } = await import("@tauri-apps/plugin-shell");
  return Command.create(alias, args, env ? { env } : undefined) as unknown as SidecarCommand;
}

export interface ResolvedNode {
  path: string;
  dir: string;
  version: string;
  envPath: string;
}

/**
 * Resolves the Node binary to use for the chrome-devtools-mcp sidecar, via the
 * Rust `resolve_node_path` command. The returned `envPath` is the `PATH` to
 * pass when spawning the sidecar so a bare `node` resolves regardless of the
 * GUI app's PATH.
 */
export async function resolveNodePath(nodePathOverride?: string): Promise<ResolvedNode> {
  requireTauri();
  const { invoke } = await import("@tauri-apps/api/core");
  const trimmed = nodePathOverride?.trim();
  const raw = await invoke<{
    path: string;
    dir: string;
    version: string;
    env_path: string;
  }>("resolve_node_path", { nodeOverride: trimmed ? trimmed : null });
  return {
    path: raw.path,
    dir: raw.dir,
    version: raw.version,
    envPath: raw.env_path,
  };
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

  if (!isTauri()) return null;

  requireTauri();
  const { check } = await import("@tauri-apps/plugin-updater");
  return check(opts) as Promise<AppUpdate | null>;
}

export async function relaunchApp(): Promise<void> {
  const mock = getBridgeMock("relaunchApp");
  if (mock) return mock();

  if (!isTauri()) return;

  requireTauri();
  const { relaunch } = await import("@tauri-apps/plugin-process");
  return relaunch();
}

const BROWSER_STORE_PREFIX = "deep-search:store:";
const BROWSER_FS_KEY = "deep-search:browser-fs";

interface BrowserFsSnapshot {
  files: Record<string, string>;
  dirs: string[];
}

function hasBrowserStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

async function invokeBrowserFallback<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (cmd === "fetch_html") {
    const url = typeof args?.url === "string" ? args.url : "";
    if (!url) return null as T;
    try {
      const response = await globalThis.fetch(url);
      return (response.ok ? await response.text() : null) as T;
    } catch {
      return null as T;
    }
  }

  return undefined as T;
}

async function loadBrowserStore(
  filename: string,
  options: StoreOptions,
): Promise<{
  get: <V>(key: string) => Promise<V | null>;
  set: (key: string, value: unknown) => Promise<void>;
  save: () => Promise<void>;
}> {
  const storageKey = `${BROWSER_STORE_PREFIX}${filename}`;
  let state = readBrowserJson<Record<string, unknown>>(storageKey, {
    ...(options.defaults ?? {}),
  });

  return {
    get: async <V>(key: string) => (key in state ? (state[key] as V) : null),
    set: async (key: string, value: unknown) => {
      state = { ...state, [key]: value };
      if (options.autoSave) writeBrowserJson(storageKey, state);
    },
    save: async () => {
      writeBrowserJson(storageKey, state);
    },
  };
}

function browserWriteTextFile(
  path: string,
  content: string,
  append: boolean,
): void {
  const normalized = normalizeBrowserPath(path);
  const fs = readBrowserFs();
  ensureBrowserDir(fs, parentBrowserPath(normalized));
  fs.files[normalized] = append ? `${fs.files[normalized] ?? ""}${content}` : content;
  writeBrowserFs(fs);
}

function browserReadTextFile(path: string): string {
  const normalized = normalizeBrowserPath(path);
  const fs = readBrowserFs();
  const content = fs.files[normalized];
  if (content === undefined) {
    throw new Error(`File not found: ${path}`);
  }
  return content;
}

function browserExists(path: string): boolean {
  const normalized = normalizeBrowserPath(path);
  const fs = readBrowserFs();
  return normalized in fs.files || fs.dirs.includes(normalized);
}

function browserReadDir(path: string): DirEntry[] {
  const normalized = normalizeBrowserPath(path);
  const fs = readBrowserFs();
  const children = new Map<string, DirEntry>();
  const prefix = normalized ? `${normalized}/` : "";

  for (const dir of fs.dirs) {
    if (!dir.startsWith(prefix) || dir === normalized) continue;
    const childName = dir.slice(prefix.length).split("/")[0];
    if (childName) {
      children.set(childName, {
        name: childName,
        isDirectory: true,
        isFile: false,
      });
    }
  }

  for (const filePath of Object.keys(fs.files)) {
    if (!filePath.startsWith(prefix)) continue;
    const childName = filePath.slice(prefix.length).split("/")[0];
    if (!childName || children.has(childName)) continue;
    const isNestedFile = filePath.slice(prefix.length).includes("/");
    children.set(childName, {
      name: childName,
      isDirectory: isNestedFile,
      isFile: !isNestedFile,
    });
  }

  return [...children.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function browserRemove(path: string, recursive: boolean): void {
  const normalized = normalizeBrowserPath(path);
  const fs = readBrowserFs();
  const prefix = `${normalized}/`;

  delete fs.files[normalized];
  fs.dirs = fs.dirs.filter((dir) =>
    recursive ? dir !== normalized && !dir.startsWith(prefix) : dir !== normalized,
  );

  if (recursive) {
    for (const filePath of Object.keys(fs.files)) {
      if (filePath.startsWith(prefix)) delete fs.files[filePath];
    }
  }

  writeBrowserFs(fs);
}

function browserRename(oldPath: string, newPath: string): void {
  const oldNormalized = normalizeBrowserPath(oldPath);
  const newNormalized = normalizeBrowserPath(newPath);
  const fs = readBrowserFs();
  const oldPrefix = `${oldNormalized}/`;
  const nextFiles: Record<string, string> = {};

  for (const [filePath, content] of Object.entries(fs.files)) {
    if (filePath === oldNormalized) {
      nextFiles[newNormalized] = content;
    } else if (filePath.startsWith(oldPrefix)) {
      nextFiles[`${newNormalized}/${filePath.slice(oldPrefix.length)}`] = content;
    } else {
      nextFiles[filePath] = content;
    }
  }

  fs.files = nextFiles;
  fs.dirs = fs.dirs.map((dir) => {
    if (dir === oldNormalized) return newNormalized;
    if (dir.startsWith(oldPrefix)) return `${newNormalized}/${dir.slice(oldPrefix.length)}`;
    return dir;
  });
  ensureBrowserDir(fs, parentBrowserPath(newNormalized));
  writeBrowserFs(fs);
}

function browserMkdir(path: string): void {
  const fs = readBrowserFs();
  ensureBrowserDir(fs, normalizeBrowserPath(path));
  writeBrowserFs(fs);
}

function readBrowserFs(): BrowserFsSnapshot {
  const fallback: BrowserFsSnapshot = { files: {}, dirs: [] };
  const raw = readBrowserJson<BrowserFsSnapshot>(BROWSER_FS_KEY, fallback);
  return {
    files: raw.files && typeof raw.files === "object" ? raw.files : {},
    dirs: Array.isArray(raw.dirs) ? raw.dirs : [],
  };
}

function writeBrowserFs(fs: BrowserFsSnapshot): void {
  fs.dirs = [...new Set(fs.dirs.map(normalizeBrowserPath).filter(Boolean))].sort();
  writeBrowserJson(BROWSER_FS_KEY, fs);
}

function ensureBrowserDir(fs: BrowserFsSnapshot, path: string): void {
  const normalized = normalizeBrowserPath(path);
  if (!normalized) return;

  const parts = normalized.split("/");
  for (let i = 1; i <= parts.length; i += 1) {
    const dir = parts.slice(0, i).join("/");
    if (!fs.dirs.includes(dir)) fs.dirs.push(dir);
  }
}

function parentBrowserPath(path: string): string {
  const normalized = normalizeBrowserPath(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index);
}

function normalizeBrowserPath(path: string): string {
  return path
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== ".")
    .join("/");
}

function readBrowserJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeBrowserJson(key: string, value: unknown): void {
  window.localStorage.setItem(key, JSON.stringify(value));
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
