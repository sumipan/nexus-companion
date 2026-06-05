/**
 * LLM usage 表示用のデータ取得 + フォーマット
 *
 * 旧 v0.2.3 までは独立した "charge" view として 1 つの view を占めていたが、
 * v0.3.0 で dashboard view に統合された (LLM usage を上、ghdag tasks 集計を下)。
 * ここでは view lifecycle は持たず、preload (cache) と「ChargeMetric への変換」
 * 「ASCII バーグラフ生成」のヘルパーのみを export する。
 */

import {
  fetchCharge as defaultFetchCharge,
  type ChargeData,
} from "../api/charge.ts";
import type { Result } from "../api/types.ts";
import type { Config } from "../config.ts";

// 1 行のフォーマット: "<label9> <bar18> <used3>/<period3> %"
const BAR_WIDTH = 18;

type FetchCharge = (config: Config) => Promise<Result<ChargeData>>;

let fetchCharge: FetchCharge = defaultFetchCharge;

// preload cache
let cachedCharge: Result<ChargeData> | null = null;
let inflightCharge: Promise<Result<ChargeData>> | null = null;

export async function fetchChargeWithCache(
  config: Config,
): Promise<Result<ChargeData>> {
  if (inflightCharge) return inflightCharge;
  inflightCharge = fetchCharge(config).then((r) => {
    cachedCharge = r;
    inflightCharge = null;
    return r;
  });
  return inflightCharge;
}

/** bootstrap で fire-and-forget で呼ぶ。背景で fetch して cache。 */
export function preloadCharge(config: Config): Promise<Result<ChargeData>> {
  return fetchChargeWithCache(config);
}

export function getCachedCharge(): Result<ChargeData> | null {
  return cachedCharge;
}

export type ChargeMetric = {
  label: string;
  // 実使用率 (0-100)。バー描画の埋め率はこれ
  usedPercent: number;
  // 期間進捗 (0-100)。分母として "12 / 14 %" のように表示する
  periodPercent: number;
};

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
  const lines: string[] = [];
  for (const m of metrics) {
    const used = String(Math.round(m.usedPercent)).padStart(3, " ");
    const period = String(Math.round(m.periodPercent)).padStart(3, " ");
    const label = m.label.padEnd(9, " ");
    lines.push(`${label} ${buildBar(m.usedPercent)} ${used}/${period} %`);
  }
  return lines.join("\n");
}

// ─── test helpers ─────────────────────────────────────────────────────
export function __setFetchChargeForTest(fetchFn: FetchCharge): void {
  fetchCharge = fetchFn;
}

export function __resetFetchChargeForTest(): void {
  fetchCharge = defaultFetchCharge;
}

export function __resetChargeCacheForTest(): void {
  cachedCharge = null;
  inflightCharge = null;
}
