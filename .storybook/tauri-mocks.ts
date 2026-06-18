type StoreSeed = Record<string, Record<string, unknown>>;

declare global {
  interface Window {
    __storybookTauriStores?: StoreSeed;
  }
}

function getStores(): StoreSeed {
  if (typeof window === "undefined") return {};
  window.__storybookTauriStores ??= {};
  return window.__storybookTauriStores;
}

function getStore(filename: string, defaults?: Record<string, unknown>) {
  const stores = getStores();
  stores[filename] = {
    ...(defaults ?? {}),
    ...(stores[filename] ?? {}),
  };
  return stores[filename];
}

export const BaseDirectory = {
  AppData: "AppData",
} as const;

export function isTauri() {
  return false;
}

export class Channel<T = unknown> {
  onmessage?: (message: T) => void;
}

export class Command<T = string> {
  static sidecar(program: string, args: string[] = []) {
    return new Command(program, args);
  }

  static create(program: string, args: string[] = []) {
    return new Command(program, args);
  }

  constructor(
    readonly program: string,
    readonly args: string[] = [],
  ) {}

  async execute() {
    return { code: 0, signal: null, stdout: "", stderr: "" };
  }

  async spawn(): Promise<Child<T>> {
    return new Child<T>();
  }

  async on() {
    return () => undefined;
  }

  async write() {}
}

export class Child<T = string> {
  pid = 0;
  stdout = new Channel<T>();
  stderr = new Channel<T>();

  async write() {}

  async kill() {}
}

export async function invoke<T = unknown>(command: string): Promise<T> {
  throw new Error(`Tauri command unavailable in Storybook: ${command}`);
}

export async function addPluginListener() {
  return () => undefined;
}

export async function isPermissionGranted() {
  return false;
}

export async function requestPermission() {
  return "denied";
}

export function sendNotification() {}

export async function appDataDir() {
  return "/storybook/app-data";
}

export async function join(...segments: string[]) {
  return segments.join("/").replace(/\/+/g, "/");
}

export async function resolveResource(resourcePath: string) {
  return `/storybook/resources/${resourcePath}`;
}

export async function openPath(path: string) {
  console.info("[storybook] openPath", path);
}

export async function openUrl(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function relaunch() {
  console.info("[storybook] relaunch skipped");
}

export async function check() {
  return null;
}

export const fetch: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init);

export async function load(
  filename: string,
  options?: { defaults?: Record<string, unknown> },
) {
  const data = getStore(filename, options?.defaults);

  return {
    async get<T>(key: string) {
      return data[key] as T | undefined;
    },
    async set(key: string, value: unknown) {
      data[key] = value;
    },
    async save() {},
    async close() {},
  };
}

export async function exists() {
  return false;
}

export async function mkdir() {}

export async function readDir() {
  return [];
}

export async function readTextFile() {
  return "";
}

export async function writeTextFile() {}

export async function remove() {}

export async function rename() {}
