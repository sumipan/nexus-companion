import {
  EvenAppBridge,
  TextContainerUpgrade,
} from "@evenrealities/even_hub_sdk";

import {
  fetchGhdagRows as defaultFetchGhdagRows,
  type GhdagRow,
} from "../api/ghdag.ts";
import {
  fetchIssuesmithQueue as defaultFetchIssuesmithQueue,
  type QueueActiveItem,
  type QueueData,
} from "../api/issuesmith.ts";
import type { Result } from "../api/types.ts";
import type { Config } from "../config.ts";
import { getView, subscribe, type ViewName } from "../state/view.ts";
import { truncateToMaxWidth } from "../util/textWidth.ts";

import type { ChargeData } from "../api/charge.ts";
import {
  buildChargeText,
  extractMetrics,
  fetchChargeWithCache,
  getCachedCharge,
  preloadCharge as preloadChargeImpl,
} from "./charge.ts";

const POLL_INTERVAL_MS = 10_000;
type FetchGhdagRows = (config: Config) => Promise<Result<GhdagRow[]>>;
type FetchQueue = (config: Config) => Promise<Result<QueueData>>;

let fetchGhdagRows: FetchGhdagRows = defaultFetchGhdagRows;
let fetchQueue: FetchQueue = defaultFetchIssuesmithQueue;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let activeConfig: Config | null = null;
let activeBridge: EvenAppBridge | null = null;

// preload cache: bootstrap で fire-and-forget で fetch しておき、activate 時の
// 描画 latency を消す
let cachedRows: Result<GhdagRow[]> | null = null;
let inflightRows: Promise<Result<GhdagRow[]>> | null = null;

let cachedQueue: Result<QueueData> | null = null;
let inflightQueue: Promise<Result<QueueData>> | null = null;

async function fetchRowsWithCache(config: Config): Promise<Result<GhdagRow[]>> {
  if (inflightRows) return inflightRows;
  inflightRows = fetchGhdagRows(config).then((r) => {
    cachedRows = r;
    inflightRows = null;
    return r;
  });
  return inflightRows;
}

export async function fetchQueueWithCache(
  config: Config,
): Promise<Result<QueueData>> {
  if (inflightQueue) return inflightQueue;
  inflightQueue = fetchQueue(config).then((r) => {
    cachedQueue = r;
    inflightQueue = null;
    return r;
  });
  return inflightQueue;
}

/** bootstrap で fire-and-forget で呼ぶ。背景で fetch して cache。 */
export function preloadDashboard(config: Config): Promise<Result<GhdagRow[]>> {
  void fetchQueueWithCache(config);
  return fetchRowsWithCache(config);
}

// ─── ghdag rows → カテゴリ別カウント ───────────────────────────────────
// ghdag の state 文字列はソース (/var/tmp/ghdag/src/ghdag/pipeline/status.py) より:
//   STATE_PENDING_DEPS = "待機（依存未充足）"
//   STATE_PENDING_RUN  = "待機（実行可能）"
//   STATE_RUNNING      = "実行中"
//   STATE_OK           = "完了（成功）"
//   STATE_FAIL         = "完了（失敗）"
//   STATE_REJECTED     = "完了（REJECTED）"
//   STATE_EMPTY        = "完了（EMPTY_RESULT）"
//   STATE_UNKNOWN_DONE = "完了（その他）"
// これを 4 カテゴリ「実行中 / 待機中 / 完了 / 失敗」に集約する。
const STATE_BUCKET: ReadonlyArray<{
  label: "実行中" | "待機中" | "完了" | "失敗";
  match: (state: string) => boolean;
}> = [
  { label: "実行中", match: (s) => s === "実行中" },
  { label: "待機中", match: (s) => s.startsWith("待機") },
  {
    label: "完了",
    match: (s) => s === "完了（成功）" || s === "完了（その他）",
  },
  {
    label: "失敗",
    match: (s) =>
      s === "完了（失敗）" || s === "完了（REJECTED）" || s === "完了（EMPTY_RESULT）",
  },
];

export type BucketCounts = {
  実行中: number;
  待機中: number;
  完了: number;
  失敗: number;
};

export function bucketizeRows(rows: GhdagRow[]): BucketCounts {
  const c: BucketCounts = { 実行中: 0, 待機中: 0, 完了: 0, 失敗: 0 };
  for (const r of rows) {
    const state = r.state ?? "";
    const bucket = STATE_BUCKET.find((b) => b.match(state));
    if (bucket) c[bucket.label] += 1;
  }
  return c;
}

export function buildGhdagSummaryLine(counts: BucketCounts): string {
  return `実行中 ${counts.実行中} / 待機中 ${counts.待機中} / 完了 ${counts.完了} / 失敗 ${counts.失敗}`;
}

// ─── issuesmith queue 行 ───────────────────────────────────────────────
const PHASE_ABBR: Record<QueueActiveItem["phase"], string> = {
  draft: "dr",
  sub: "sb",
  develop: "dev",
  merge: "mg",
};

export function buildQueueLine(active: QueueActiveItem[]): string {
  if (active.length === 0) {
    return truncateToMaxWidth("Q -");
  }
  const shown = active.slice(0, 3);
  const parts = shown.map((item) => {
    const abbr = PHASE_ABBR[item.phase] ?? item.phase;
    const bang = item.priority === "high" ? "!" : "";
    return `#${item.issue} ${abbr}${bang}`;
  });
  let line = `Q ${parts.join(" > ")}`;
  const rest = active.length - 3;
  if (rest > 0) {
    line += ` (+${rest})`;
  }
  return truncateToMaxWidth(line);
}

function formatResumeAt(resumeAt: string | null): string {
  if (!resumeAt) return "??:??";
  const d = new Date(resumeAt);
  if (Number.isNaN(d.getTime())) return "??:??";
  return d.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function buildStatusLine(queue: QueueData): string {
  const parts: string[] = [];
  if (queue.halt) {
    parts.push("HALT");
  }
  if (queue.in_flight.length > 0) {
    const runs = queue.in_flight
      .map((item) => `${item.engine}#${item.issue}`)
      .join(" ");
    parts.push(`run ${runs}`);
  }
  for (const [name, state] of Object.entries(queue.engines)) {
    if (state.status === "paused") {
      parts.push(`pause ${name}~${formatResumeAt(state.resume_at)}`);
    }
  }
  if (parts.length === 0) {
    return truncateToMaxWidth("idle");
  }
  return truncateToMaxWidth(parts.join(" | "));
}

// ─── 統合表示 (LLM usage + queue + ghdag tasks サマリ) ─────────────────
export function buildCombinedText(
  charge: Result<ChargeData> | null,
  rows: Result<GhdagRow[]> | null,
  queue: Result<QueueData> | null,
): string {
  const lines: string[] = [];

  // LLM usage 部
  if (charge && charge.ok) {
    lines.push(buildChargeText(extractMetrics(charge.data)));
  } else if (charge && !charge.ok) {
    lines.push(charge.error || "進捗データ取得失敗");
  } else {
    lines.push("loading...");
  }

  // issuesmith キュー 2 行（失敗時は offline 1 行）
  if (queue && queue.ok) {
    lines.push(buildQueueLine(queue.data.active));
    lines.push(buildStatusLine(queue.data));
  } else if (queue && !queue.ok) {
    lines.push("queue: offline");
  } else {
    lines.push("queue loading...");
  }

  // ghdag サマリ 1 行
  if (rows && rows.ok) {
    lines.push(buildGhdagSummaryLine(bucketizeRows(rows.data)));
  } else if (rows && !rows.ok) {
    lines.push(rows.error);
  } else {
    lines.push("ghdag loading...");
  }

  return lines.join("\n");
}

async function applyContent(bridge: EvenAppBridge, content: string): Promise<void> {
  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: 1,
      containerName: "main",
      content,
    }),
  );
}

async function renderCurrent(bridge: EvenAppBridge): Promise<void> {
  const text = buildCombinedText(getCachedCharge(), cachedRows, cachedQueue);
  await applyContent(bridge, text);
}

async function pollOnce(): Promise<void> {
  if (!activeConfig || !activeBridge) return;
  // 3 系統を並列に fetch (cache 経由でリクエスト重複排除)
  await Promise.all([
    fetchChargeWithCache(activeConfig),
    fetchRowsWithCache(activeConfig),
    fetchQueueWithCache(activeConfig),
  ]);
  if (!activeBridge) return;
  await renderCurrent(activeBridge);
}

export function startDashboard(config: Config, bridge: EvenAppBridge): void {
  stopDashboard();
  activeConfig = config;
  activeBridge = bridge;
  // cache hit があれば即描画 (両 cache あれば即完全表示、片方だけなら部分表示)。
  // 続けて背景で両方の最新化を試みる。
  void renderCurrent(bridge);
  void pollOnce();
  pollTimer = setInterval(() => {
    void pollOnce();
  }, POLL_INTERVAL_MS);
}

export function stopDashboard(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  activeConfig = null;
  activeBridge = null;
}

export function registerDashboardLifecycle(
  config: Config,
  bridge: EvenAppBridge,
): () => void {
  const onViewChange = (view: ViewName): void => {
    if (view === "dashboard") {
      startDashboard(config, bridge);
    } else {
      stopDashboard();
    }
  };

  const unsubscribe = subscribe(onViewChange);

  // dashboard が default view のため、起動時に current が dashboard なら即開始する
  if (getView() === "dashboard") {
    startDashboard(config, bridge);
  }

  return unsubscribe;
}

// charge 側の preload も dashboard 配下から再 export しておく
// (main.ts の bootstrap で 1 行 import で済むよう)。
export const preloadCharge = preloadChargeImpl;

// ─── test helpers ─────────────────────────────────────────────────────
export function __resetDashboardStateForTest(): void {
  stopDashboard();
}

export function __getPollTimerForTest(): ReturnType<typeof setInterval> | null {
  return pollTimer;
}

export function __setFetchGhdagRowsForTest(fetchFn: FetchGhdagRows): void {
  fetchGhdagRows = fetchFn;
}

export function __resetFetchGhdagRowsForTest(): void {
  fetchGhdagRows = defaultFetchGhdagRows;
}

export function __setFetchQueueForTest(fetchFn: FetchQueue): void {
  fetchQueue = fetchFn;
}

export function __resetFetchQueueForTest(): void {
  fetchQueue = defaultFetchIssuesmithQueue;
}

export function __resetQueueCacheForTest(): void {
  cachedQueue = null;
  inflightQueue = null;
}

export async function __pollOnceForTest(): Promise<void> {
  await pollOnce();
}
