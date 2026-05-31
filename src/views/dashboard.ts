import {
  EvenAppBridge,
  TextContainerUpgrade,
} from "@evenrealities/even_hub_sdk";

import {
  fetchGhdagRows as defaultFetchGhdagRows,
  type GhdagRow,
} from "../api/ghdag.ts";
import type { Result } from "../api/types.ts";
import type { Config } from "../config.ts";
import { subscribe, type ViewName } from "../state/view.ts";

const POLL_INTERVAL_MS = 10_000;
type FetchGhdagRows = (config: Config) => Promise<Result<GhdagRow[]>>;

let fetchGhdagRows: FetchGhdagRows = defaultFetchGhdagRows;
const LABEL_WIDTH = 18;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let previousCounts: Map<string, number> | null = null;
let activeConfig: Config | null = null;
let activeBridge: EvenAppBridge | null = null;

export function aggregateByState(rows: GhdagRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.state, (counts.get(row.state) ?? 0) + 1);
  }
  return counts;
}

export function buildSummaryText(counts: Map<string, number>): string {
  const lines: string[] = ["ghdag tasks"];
  let total = 0;

  for (const [state, count] of counts) {
    total += count;
    const label = `${state}:`;
    const padding = " ".repeat(Math.max(1, LABEL_WIDTH - label.length));
    lines.push(`${label}${padding}${count}`);
  }

  lines.push("─────────────────");
  const totalLabel = "total:";
  lines.push(`${totalLabel}${" ".repeat(LABEL_WIDTH - totalLabel.length)}${total}`);
  return lines.join("\n");
}

export function countsEqual(
  a: Map<string, number>,
  b: Map<string, number>,
): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [key, value] of a) {
    if (b.get(key) !== value) {
      return false;
    }
  }
  return true;
}

/**
 * bootstrap で作った containerID=1 の TextContainer に content だけ流す。
 *
 * 以前は rebuildPageContainer を使っていたが、v0.1.9 でも `isEventCapture: 1`
 * を明示しても dashboard 遷移後にタップが届かなくなる事象が継続 (rebuildPage
 * Container は container 構造を再構築する API なので、isEventCapture の指定が
 * あっても何かしらの形で event capture を破壊している模様)。
 *
 * textContainerUpgrade は content だけ更新する API で container 構造を触らない
 * ので、bootstrap で立てた isEventCapture=1 がそのまま維持される。diary view と
 * 同じパターン。
 */
async function applyContent(bridge: EvenAppBridge, content: string): Promise<void> {
  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: 1,
      containerName: "main",
      content,
    }),
  );
}

async function pollOnce(): Promise<void> {
  if (!activeConfig || !activeBridge) {
    return;
  }

  const result = await fetchGhdagRows(activeConfig);
  if (!result.ok) {
    await applyContent(activeBridge, result.error);
    return;
  }

  const counts = aggregateByState(result.data);
  if (previousCounts !== null && countsEqual(previousCounts, counts)) {
    return;
  }

  previousCounts = new Map(counts);
  await applyContent(activeBridge, buildSummaryText(counts));
}

export function startDashboard(config: Config, bridge: EvenAppBridge): void {
  stopDashboard();
  activeConfig = config;
  activeBridge = bridge;
  previousCounts = null;
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

  return subscribe(onViewChange);
}

export function __resetDashboardStateForTest(): void {
  stopDashboard();
  previousCounts = null;
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

export async function __pollOnceForTest(): Promise<void> {
  await pollOnce();
}
