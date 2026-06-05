import {
  fetchMessage as defaultFetchMessage,
} from "../api/message.ts";
import { fetchTasks as defaultFetchTasks } from "../api/tasks.ts";
import type { Config } from "../config.ts";
import type { Result } from "../api/types.ts";
import { autoSwitchTo } from "./view.ts";

const POLL_INTERVAL_MS = 30_000;

let pollTimer: ReturnType<typeof setInterval> | undefined;
let lastMessageFingerprint: string | null = null;
let lastTasksContent: string | null = null;

// DI hooks for testing
let _fetchMessage: (config: Config) => Promise<Result<string>> = defaultFetchMessage;
let _fetchTasks: (config: Config) => Promise<Result<string>> = defaultFetchTasks;

// module-level cache for tasks, consumed by tasks view
let cachedTasks: string | null = null;

export function getCachedTasks(): string | null {
  return cachedTasks;
}

async function poll(config: Config): Promise<void> {
  const [msgResult, tasksResult] = await Promise.all([
    _fetchMessage(config),
    _fetchTasks(config),
  ]);

  if (tasksResult.ok) {
    cachedTasks = tasksResult.data;
    if (lastTasksContent !== null && tasksResult.data !== lastTasksContent) {
      autoSwitchTo("tasks");
    }
    lastTasksContent = tasksResult.data;
  }

  if (msgResult.ok) {
    const fp = msgResult.data.trim();
    if (lastMessageFingerprint !== null && fp !== lastMessageFingerprint) {
      autoSwitchTo("blank");
    }
    lastMessageFingerprint = fp;
  }
}

export function startDataWatcher(config: Config): void {
  if (pollTimer !== undefined) return;
  pollTimer = setInterval(() => {
    void poll(config);
  }, POLL_INTERVAL_MS);
}

export function stopDataWatcher(): void {
  if (pollTimer !== undefined) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

// テスト用
export function __resetDataWatcherForTest(): void {
  stopDataWatcher();
  lastMessageFingerprint = null;
  lastTasksContent = null;
  cachedTasks = null;
  _fetchMessage = defaultFetchMessage;
  _fetchTasks = defaultFetchTasks;
}

export function __setTasksContentForTest(content: string): void {
  lastTasksContent = content;
}

export function __setFetchMessageForTest(fn: (config: Config) => Promise<Result<string>>): void {
  _fetchMessage = fn;
}

export function __setFetchTasksForTest(fn: (config: Config) => Promise<Result<string>>): void {
  _fetchTasks = fn;
}

export function __pollOnceForTest(config: Config): Promise<void> {
  return poll(config);
}

export function __setFingerprintForTest(fp: string): void {
  lastMessageFingerprint = fp;
}
