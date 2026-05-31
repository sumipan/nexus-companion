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
// glass 576 px に 6 行を収めるため、バー幅は短めに。
// 1 行のフォーマット: "<label14> <bar18> <pct3>%" → 約 14 + 1 + 18 + 1 + 4 = 38 文字
const BAR_WIDTH = 18;

type FetchCharge = (config: Config) => Promise<Result<ChargeData>>;

let fetchCharge: FetchCharge = defaultFetchCharge;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let activeConfig: Config | null = null;
let activeBridge: EvenAppBridge | null = null;

export type ChargeMetric = {
  label: string;
  // 実使用率 (0-100)。バー描画の埋め率はこれ
  usedPercent: number;
  // 期間進捗 (0-100)。分母として "12 / 14 %" のように表示する
  periodPercent: number;
};

/**
 * reset_at と期間日数から「今が期間のどれだけ進んだか」を 0-100 で返す。
 * 例: 週次 reset_at = 日曜 04:00、periodDays = 7 → 経過 / 7 日 * 100
 */
function progressPercent(resetAtIso: string, periodDays: number): number {
  const reset = new Date(resetAtIso).getTime();
  if (Number.isNaN(reset)) return 0;
  const periodMs = periodDays * 24 * 60 * 60 * 1000;
  const start = reset - periodMs;
  const elapsed = Date.now() - start;
  return Math.max(0, Math.min(100, Math.round((elapsed / periodMs) * 100)));
}

const FIVE_HOURS_DAYS = 5 / 24;

export function extractMetrics(data: ChargeData): ChargeMetric[] {
  const weekProg = progressPercent(data.claude.weekly.reset_at, 7);
  const monthProg = progressPercent(data.cursor.monthly.reset_at, 30);
  const sessionProg = progressPercent(
    data.claude.session_5h.reset_at,
    FIVE_HOURS_DAYS,
  );
  return [
    {
      label: "Claude wk",
      usedPercent: data.claude.weekly.used_percent,
      periodPercent: weekProg,
    },
    {
      label: "Claude 5h",
      usedPercent: data.claude.session_5h.used_percent,
      periodPercent: sessionProg,
    },
    {
      label: "Cursor Au",
      usedPercent: data.cursor.monthly.auto_percent,
      periodPercent: monthProg,
    },
    {
      label: "Cursor Ap",
      usedPercent: data.cursor.monthly.api_percent,
      periodPercent: monthProg,
    },
  ];
}

function buildBar(percent: number): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((BAR_WIDTH * clamped) / 100);
  const empty = BAR_WIDTH - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

export function buildChargeText(metrics: ChargeMetric[]): string {
  const lines: string[] = ["LLM usage"];
  for (const m of metrics) {
    const used = String(Math.round(m.usedPercent)).padStart(3, " ");
    const period = String(Math.round(m.periodPercent)).padStart(3, " ");
    const label = m.label.padEnd(9, " ");
    // 使用率 / 期間進捗 % 形式 (例: " 12/ 14 %"). バーは実使用率を描画
    lines.push(`${label} ${buildBar(m.usedPercent)} ${used}/${period} %`);
  }
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

  const metrics = extractMetrics(result.data);
  await applyContent(activeBridge, buildChargeText(metrics));
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
