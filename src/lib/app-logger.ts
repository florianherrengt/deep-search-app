import {
  appendAppLog,
  isTauri,
  type AppLogEntry,
} from "@/lib/tauri-bridge";

type ConsoleLevel = "debug" | "info" | "log" | "warn" | "error";
type OriginalConsole = Record<ConsoleLevel, (...args: unknown[]) => void>;

const CONSOLE_LEVELS: readonly ConsoleLevel[] = [
  "debug",
  "info",
  "log",
  "warn",
  "error",
];
const FLUSH_DELAY_MS = 250;
const ERROR_FLUSH_DELAY_MS = 0;
const MAX_PENDING_ENTRIES = 500;
const MAX_SERIALIZED_ARG_CHARS = 16_000;
const REDACTED_LOG_VALUE = "[REDACTED]";

interface LoggerInstall {
  originalConsole: OriginalConsole;
  removeEventListeners: () => void;
  flushing: boolean;
  lastLogPath: string | null;
}

let install: LoggerInstall | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingEntries: AppLogEntry[] = [];
let droppedEntryCount = 0;

export function initializeAppLogger(): void {
  if (install || typeof window === "undefined" || !isTauri()) return;

  const originalConsole = captureOriginalConsole();

  for (const level of CONSOLE_LEVELS) {
    console[level] = (...args: unknown[]) => {
      originalConsole[level](...args);
      enqueueLogEntry({
        timestamp: new Date().toISOString(),
        level,
        target: "console",
        message: formatLogArgs(args),
      });
    };
  }

  const handleError = (event: ErrorEvent) => {
    enqueueLogEntry(
      {
        timestamp: new Date().toISOString(),
        level: "error",
        target: "window.error",
        message: formatWindowError(event),
      },
      true,
    );
  };
  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    enqueueLogEntry(
      {
        timestamp: new Date().toISOString(),
        level: "error",
        target: "window.unhandledrejection",
        message: `Unhandled promise rejection: ${serializeLogArg(event.reason)}`,
      },
      true,
    );
  };
  const handlePageHide = () => {
    void flushLogEntries();
  };

  window.addEventListener("error", handleError);
  window.addEventListener("unhandledrejection", handleUnhandledRejection);
  window.addEventListener("pagehide", handlePageHide);

  install = {
    originalConsole,
    flushing: false,
    lastLogPath: null,
    removeEventListeners: () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      window.removeEventListener("pagehide", handlePageHide);
    },
  };

  enqueueLogEntry({
    timestamp: new Date().toISOString(),
    level: "info",
    target: "logger",
    message: "App file logging initialized.",
  });
}

export function disposeAppLoggerForTests(): void {
  if (!install) return;

  for (const level of CONSOLE_LEVELS) {
    (console as Record<ConsoleLevel, (...args: unknown[]) => void>)[level] =
      install.originalConsole[level];
  }
  install.removeEventListeners();
  install = null;
  pendingEntries = [];
  droppedEntryCount = 0;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

function captureOriginalConsole(): OriginalConsole {
  return {
    debug: console.debug.bind(console),
    info: console.info.bind(console),
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };
}

function enqueueLogEntry(entry: AppLogEntry, urgent = false): void {
  if (!install) return;

  if (pendingEntries.length >= MAX_PENDING_ENTRIES) {
    pendingEntries.shift();
    droppedEntryCount += 1;
  }

  pendingEntries.push(entry);
  scheduleFlush(urgent ? ERROR_FLUSH_DELAY_MS : FLUSH_DELAY_MS);
}

function scheduleFlush(delayMs: number): void {
  if (flushTimer && delayMs !== ERROR_FLUSH_DELAY_MS) return;
  if (flushTimer) {
    clearTimeout(flushTimer);
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushLogEntries();
  }, delayMs);
}

async function flushLogEntries(): Promise<void> {
  const activeInstall = install;
  if (!activeInstall || activeInstall.flushing) return;

  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  const entries = pendingEntries.splice(0, pendingEntries.length);
  if (droppedEntryCount > 0) {
    entries.unshift({
      timestamp: new Date().toISOString(),
      level: "warn",
      target: "logger",
      message: `Dropped ${droppedEntryCount} renderer log entries because the pending log buffer was full.`,
    });
    droppedEntryCount = 0;
  }

  if (entries.length === 0) return;

  activeInstall.flushing = true;
  try {
    const logPath = await appendAppLog(entries);
    if (logPath && activeInstall.lastLogPath !== logPath) {
      activeInstall.lastLogPath = logPath;
      activeInstall.originalConsole.info(`[app-logger] Writing logs to ${logPath}`);
    }
  } catch (error) {
    activeInstall.originalConsole.warn(
      "[app-logger] Failed to write app log file:",
      error,
    );
  } finally {
    activeInstall.flushing = false;
    if (pendingEntries.length > 0) {
      scheduleFlush(FLUSH_DELAY_MS);
    }
  }
}

function formatLogArgs(args: unknown[]): string {
  return args.map((arg) => serializeLogArg(arg)).join(" ");
}

function formatWindowError(event: ErrorEvent): string {
  const parts = ["Unhandled window error"];
  if (event.message) {
    parts.push(event.message);
  }
  if (event.filename) {
    parts.push(`at ${event.filename}:${event.lineno}:${event.colno}`);
  }
  if (event.error) {
    parts.push(serializeLogArg(event.error));
  }
  return truncateSerializedArg(redactSerializedText(parts.join(" | ")));
}

export function serializeLogArg(value: unknown): string {
  if (value instanceof Error) {
    return truncateSerializedArg(
      redactSerializedText(value.stack || `${value.name}: ${value.message}`),
    );
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed === "object" && parsed !== null) {
        return serializeLogArg(parsed);
      }
    } catch {
      // Plain log text is handled by the credential patterns below.
    }
    return truncateSerializedArg(redactSerializedText(value));
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }
  if (typeof value === "symbol") {
    return value.toString();
  }
  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }

  try {
    const seen = new WeakSet<object>();
    const serialized = JSON.stringify(value, (key, nestedValue: unknown) => {
      if (key && isSensitiveLogKey(key)) {
        return REDACTED_LOG_VALUE;
      }
      if (typeof nestedValue === "bigint") {
        return `${nestedValue.toString()}n`;
      }
      if (nestedValue instanceof Error) {
        return {
          name: nestedValue.name,
          message: nestedValue.message,
          stack: nestedValue.stack,
        };
      }
      if (typeof nestedValue === "string") {
        return redactSerializedText(nestedValue);
      }
      if (typeof nestedValue === "object" && nestedValue !== null) {
        if (seen.has(nestedValue)) {
          return "[Circular]";
        }
        seen.add(nestedValue);
      }
      return nestedValue;
    });
    return truncateSerializedArg(
      redactSerializedText(serialized ?? String(value)),
    );
  } catch {
    return truncateSerializedArg(redactSerializedText(String(value)));
  }
}

function isSensitiveLogKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return (
    normalized.endsWith("preview") ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("password") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("token") ||
    normalized.endsWith("accesskey") ||
    normalized.endsWith("privatekey") ||
    normalized.endsWith("passphrase") ||
    normalized.endsWith("authorizationheader") ||
    normalized.endsWith("cookieheader") ||
    normalized === "authorization" ||
    normalized === "credential" ||
    normalized === "credentials" ||
    normalized === "cookie" ||
    normalized === "cookies" ||
    normalized === "setcookie"
  );
}

function redactSerializedText(value: string): string {
  return value
    .replace(
      /("([^"\\]+)"\s*:\s*")((?:\\.|[^"\\])*)"/g,
      (match, prefix: string, key: string) =>
        isSensitiveLogKey(key)
          ? `${prefix}${REDACTED_LOG_VALUE}"`
          : match,
    )
    .replace(
      /([?&](?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|key|secret|password)=)[^&#\s"']*/gi,
      `$1${REDACTED_LOG_VALUE}`,
    )
    .replace(
      /(\b(?:authorization|proxy-authorization|cookie|set-cookie)\b\s*[:=]\s*)[^\r\n]*/gi,
      `$1${REDACTED_LOG_VALUE}`,
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED_LOG_VALUE}`)
    .replace(
      /(\b(?:api[-_ ]?key|password|client[-_ ]?secret|access[-_ ]?token|refresh[-_ ]?token)\b\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&"']+)/gi,
      `$1${REDACTED_LOG_VALUE}`,
    );
}

function truncateSerializedArg(value: string): string {
  if (value.length <= MAX_SERIALIZED_ARG_CHARS) return value;
  return `${value.slice(0, MAX_SERIALIZED_ARG_CHARS)}... [truncated]`;
}
