const FRONTEND_LOG_STORE_KEY = "temu_frontend_logs";
const MAX_FRONTEND_LOGS = 500;

type FrontendLogLevel = "log" | "info" | "warn" | "error";

export interface FrontendLogEntry {
  id: string;
  timestamp: number;
  level: FrontendLogLevel;
  source: "console" | "window-error" | "unhandledrejection" | "workflow-pack";
  message: string;
  detail?: string;
  taskId?: string;
}

declare global {
  interface WindowEventMap {
    "temu-frontend-log": CustomEvent<FrontendLogEntry>;
  }
}

let initialized = false;
let logBuffer: FrontendLogEntry[] = [];
let flushTimer: number | null = null;

function getStore() {
  return window.electronAPI?.store;
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (value === null || value === undefined) return String(value);
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }
  return String(value);
}

function formatArgs(args: unknown[]) {
  return args.map((arg) => safeStringify(arg)).join(" ");
}

function normalizeConsoleLevel(level: FrontendLogLevel, message: string): FrontendLogLevel {
  if (level !== "error") return level;

  const normalized = message.trim().toLowerCase();
  if (
    normalized.startsWith("warning:") ||
    normalized.startsWith("warn:") ||
    normalized.includes("[antd:") ||
    normalized.includes(" warning:")
  ) {
    return "warn";
  }

  return level;
}

function shouldIgnoreConsoleMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes("[antd: dropdown]")
    || normalized.includes("[antd: message]")
    || normalized.includes("[antd: card]")
    || normalized.includes("react router future flag")
    || normalized.includes("static function can not")
    || normalized.includes("dropdownrender")
    || normalized.includes("bodystyle")
  );
}

function isDevServerRuntime() {
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function shouldIgnoreRuntimeNoise(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized || !isDevServerRuntime()) return false;

  return (
    normalized.includes("[hmr]")
    || normalized.includes("failed to reload /src/")
  );
}

function shouldIgnoreLogEntry(entry: FrontendLogEntry) {
  return shouldIgnoreRuntimeNoise(entry.message || "");
}

function flushLogs() {
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
  }

  flushTimer = window.setTimeout(async () => {
    flushTimer = null;
    try {
      await getStore()?.set?.(FRONTEND_LOG_STORE_KEY, logBuffer.slice(-MAX_FRONTEND_LOGS));
    } catch {
      // Ignore storage failures to avoid recursive logging loops.
    }
  }, 300);
}

function appendLog(entry: FrontendLogEntry) {
  logBuffer = [...logBuffer, entry].slice(-MAX_FRONTEND_LOGS);
  window.dispatchEvent(new CustomEvent("temu-frontend-log", { detail: entry }));
  flushLogs();
}

function createLog(level: FrontendLogLevel, source: FrontendLogEntry["source"], message: string): FrontendLogEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    timestamp: Date.now(),
    level,
    source,
    message: message || "(empty log)",
  };
}

export async function initFrontendLogger() {
  if (initialized) return;
  initialized = true;

  try {
    const existing = await getStore()?.get?.(FRONTEND_LOG_STORE_KEY);
    if (Array.isArray(existing)) {
      const filtered = existing.filter((entry) => !shouldIgnoreLogEntry(entry));
      logBuffer = filtered.slice(-MAX_FRONTEND_LOGS);
      if (filtered.length !== existing.length) {
        await getStore()?.set?.(FRONTEND_LOG_STORE_KEY, logBuffer);
      }
    }
  } catch {
    // Ignore initialization failures.
  }

  const consoleMethods: FrontendLogLevel[] = ["log", "info", "warn", "error"];
  for (const method of consoleMethods) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      const message = formatArgs(args);
      if (shouldIgnoreConsoleMessage(message)) return;
      if (shouldIgnoreRuntimeNoise(message)) return;
      appendLog(createLog(normalizeConsoleLevel(method, message), "console", message));
    };
  }

  window.addEventListener("error", (event) => {
    const message = [
      event.message,
      event.filename ? `@ ${event.filename}:${event.lineno}:${event.colno}` : "",
    ].filter(Boolean).join(" ");
    if (shouldIgnoreRuntimeNoise(message)) return;
    appendLog(createLog("error", "window-error", message || safeStringify(event.error)));
  });

  window.addEventListener("unhandledrejection", (event) => {
    const message = safeStringify(event.reason);
    if (shouldIgnoreRuntimeNoise(message)) return;
    appendLog(createLog("error", "unhandledrejection", message));
  });
}

export async function clearFrontendLogs() {
  logBuffer = [];
  try {
    await getStore()?.set?.(FRONTEND_LOG_STORE_KEY, []);
  } catch {
    // Ignore cleanup failures.
  }
}

export { FRONTEND_LOG_STORE_KEY };
