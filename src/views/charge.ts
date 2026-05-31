import {
  TextContainerUpgrade,
  type EvenAppBridge,
} from "@evenrealities/even_hub_sdk";

import {
  fetchCharge as defaultFetchCharge,
  type ChargeData,
} from "../api/charge.ts";
import type { Result } from "../api/types.ts";
import type { Config } from "../config.ts";
import { subscribe, type ViewName } from "../state/view.ts";

const POLL_INTERVAL_MS = 30_000;
const ERROR_MESSAGE = "進捗データ取得失敗";
// bootstrap (main.ts) で立てた container を共有
const CONTAINER_ID = 1;
const CONTAINER_NAME = "main";
// glass 576 px に収まる範囲で、見やすいバー幅
const BAR_WIDTH = 24;

type FetchCharge = (config: Config) => Promise<Result<ChargeData>>;

let fetchCharge: FetchCharge = defaultFetchCharge;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let activeConfig: Config | null = null;
let activeBridge: EvenAppBridge | null = null;

export function extractMetrics(
  data: ChargeData,
): { claudePercent: number; cursorPercent: number } {
  return {
    claudePercent: data.claude.weekly.used_percent,
    cursorPercent: data.cursor.monthly.total_percent,
  };
}

function buildBar(percent: number): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((BAR_WIDTH * clamped) / 100);
  const empty = BAR_WIDTH - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

export function buildChargeText(
  claudePercent: number,
  cursorPercent: number,
): string {
  const lines: string[] = [];
  lines.push("LLM usage");
  lines.push("");
  lines.push(
    `Claude  ${buildBar(claudePercent)}  ${String(claudePercent).padStart(3, " ")}% (weekly)`,
  );
  lines.push(
    `Cursor  ${buildBar(cursorPercent)}  ${String(cursorPercent).padStart(3, " ")}% (monthly)`,
  );
  return lines.join("\n");
}

async function applyContent(bridge: EvenAppBridge, content: string): Promise<void> {
  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: CONTAINER_ID,
      containerName: CONTAINER_NAME,
      content,
    }),
  );
}

async function pollOnce(): Promise<void> {
  if (!activeConfig || !activeBridge) {
    return;
  }

  const result = await fetchCharge(activeConfig);
  if (!result.ok) {
    await applyContent(activeBridge, result.error || ERROR_MESSAGE);
    return;
  }

  const { claudePercent, cursorPercent } = extractMetrics(result.data);
  await applyContent(activeBridge, buildChargeText(claudePercent, cursorPercent));
}

export function startCharge(config: Config, bridge: EvenAppBridge): void {
  stopCharge();
  activeConfig = config;
  activeBridge = bridge;
  void pollOnce();
  pollTimer = setInterval(() => {
    void pollOnce();
  }, POLL_INTERVAL_MS);
}

export function stopCharge(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  activeConfig = null;
  activeBridge = null;
  // bridge.shutDownPageContainer はアプリ終了系の API なので呼ばない (v0.1.14 確認済み)。
  // bootstrap で立てた container を blank / diary / dashboard と共有しているので、
  // ここで何かを破棄する必要はない。
}

export function registerChargeLifecycle(
  config: Config,
  bridge: EvenAppBridge,
): () => void {
  const onViewChange = (view: ViewName): void => {
    if (view === "charge") {
      startCharge(config, bridge);
    } else {
      stopCharge();
    }
  };

  return subscribe(onViewChange);
}

export function __resetChargeStateForTest(): void {
  stopCharge();
}

export function __getPollTimerForTest(): ReturnType<typeof setInterval> | null {
  return pollTimer;
}

export function __setFetchChargeForTest(fetchFn: FetchCharge): void {
  fetchCharge = fetchFn;
}

export function __resetFetchChargeForTest(): void {
  fetchCharge = defaultFetchCharge;
}

export async function __pollOnceForTest(): Promise<void> {
  await pollOnce();
}
