import { fetchMessage } from "../api/message.ts";
import { fetchTasks } from "../api/tasks.ts";
import type { Config } from "../config.ts";
import { autoSwitchTo } from "./view.ts";

const POLL_INTERVAL_MS = 30_000;

let pollTimer: ReturnType<typeof setInterval> | undefined;
let lastMessageFingerprint: string | null = null;

// module-level cache for tasks, consumed by tasks view
let cachedTasks: string | null = null;

export function getCachedTasks(): string | null {
  return cachedTasks;
}

async function poll(config: Config): Promise<void> {
  const [msgResult, tasksResult] = await Promise.all([
    fetchMessage(config),
    fetchTasks(config),
  ]);

  if (tasksResult.ok) {
    cachedTasks = tasksResult.data;
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
  cachedTasks = null;
}

export function __pollOnceForTest(config: Config): Promise<void> {
  return poll(config);
}

export function __setFingerprintForTest(fp: string): void {
  lastMessageFingerprint = fp;
}
