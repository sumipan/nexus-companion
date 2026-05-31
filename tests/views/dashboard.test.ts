import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import type { GhdagRow } from "../../src/api/ghdag.ts";
import type { Config } from "../../src/config.ts";
import { nextView } from "../../src/state/view.ts";
import {
  __getPollTimerForTest,
  __pollOnceForTest,
  __resetDashboardStateForTest,
  __resetFetchGhdagRowsForTest,
  __setFetchGhdagRowsForTest,
  aggregateByState,
  buildSummaryText,
  countsEqual,
  registerDashboardLifecycle,
  startDashboard,
  stopDashboard,
} from "../../src/views/dashboard.ts";

const CONFIG: Config = {
  chargeServerUrl: "http://localhost:8088",
  ghdagUiUrl: "http://localhost:8080",
};

const POLL_MS = 10_000;

type FetchResult =
  | { ok: true; data: GhdagRow[] }
  | { ok: false; error: string };

let fetchResults: FetchResult[] = [];
let rebuildCalls: string[] = [];

const mockBridge = {
  rebuildPageContainer: async (container: { textObject?: { content?: string }[] }) => {
    const content = container.textObject?.[0]?.content ?? "";
    rebuildCalls.push(content);
    return true;
  },
};

function row(state: string): GhdagRow {
  return {
    uuid: "uuid",
    state,
    cmd_preview: "cmd",
    tree_ts: "ts",
    engine_model: "model",
  };
}

function nextFetchResult(): FetchResult {
  const next = fetchResults.shift();
  if (!next) {
    return { ok: true, data: [] };
  }
  return next;
}

describe("dashboard view", () => {
  beforeEach(() => {
    fetchResults = [];
    rebuildCalls = [];
    __setFetchGhdagRowsForTest(async () => nextFetchResult());
  });

  afterEach(() => {
    __resetDashboardStateForTest();
    __resetFetchGhdagRowsForTest();
    mock.timers.reset();
  });

  it("aggregateByState groups rows by state", () => {
    const counts = aggregateByState([
      row("a"),
      row("b"),
      row("a"),
    ]);
    assert.deepEqual(counts, new Map([
      ["a", 2],
      ["b", 1],
    ]));
  });

  it("aggregateByState returns an empty map for no rows", () => {
    assert.equal(aggregateByState([]).size, 0);
  });

  it('buildSummaryText starts with "ghdag tasks"', () => {
    const text = buildSummaryText(new Map([
      ["a", 3],
      ["b", 1],
    ]));
    assert.equal(text.split("\n")[0], "ghdag tasks");
    assert.match(text, /total:\s+4$/m);
  });

  it("countsEqual detects identical maps", () => {
    assert.equal(
      countsEqual(new Map([["a", 1]]), new Map([["a", 1]])),
      true,
    );
    assert.equal(
      countsEqual(new Map([["a", 1]]), new Map([["a", 2]])),
      false,
    );
  });

  it("skips rebuildPageContainer when counts are unchanged", async () => {
    fetchResults = [
      { ok: true, data: [row("develop-running"), row("develop-running")] },
      { ok: true, data: [row("develop-running"), row("develop-running")] },
    ];

    startDashboard(CONFIG, mockBridge as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(rebuildCalls.length, 1);

    await __pollOnceForTest();
    assert.equal(rebuildCalls.length, 1);
    stopDashboard();
  });

  it("calls rebuildPageContainer once when counts change", async () => {
    fetchResults = [
      { ok: true, data: [row("develop-running")] },
      { ok: true, data: [row("develop-running"), row("review-pending")] },
    ];

    startDashboard(CONFIG, mockBridge as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(rebuildCalls.length, 1);

    await __pollOnceForTest();
    assert.equal(rebuildCalls.length, 2);
    stopDashboard();
  });

  it("polls every 10 seconds after startDashboard", async () => {
    mock.timers.enable({ apis: ["setInterval"] });
    fetchResults = [
      { ok: true, data: [row("develop-running")] },
      { ok: true, data: [row("review-pending")] },
    ];

    startDashboard(CONFIG, mockBridge as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(rebuildCalls.length, 1);

    mock.timers.tick(POLL_MS);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(rebuildCalls.length, 2);
    stopDashboard();
  });

  it("stopDashboard clears polling", async () => {
    mock.timers.enable({ apis: ["setInterval"] });
    fetchResults = [
      { ok: true, data: [row("develop-running")] },
      { ok: true, data: [row("review-pending")] },
    ];

    startDashboard(CONFIG, mockBridge as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    stopDashboard();
    assert.equal(__getPollTimerForTest(), null);

    mock.timers.tick(POLL_MS);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(rebuildCalls.length, 1);
  });

  it("shows ghdag connection error text without clearing previous counts", async () => {
    fetchResults = [
      { ok: true, data: [row("develop-running")] },
      { ok: false, error: "ghdag UI に接続できません" },
      { ok: true, data: [row("develop-running")] },
      { ok: true, data: [row("develop-running"), row("review-pending")] },
    ];

    startDashboard(CONFIG, mockBridge as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(rebuildCalls[0], /develop-running/);

    await __pollOnceForTest();
    assert.equal(rebuildCalls[1], "ghdag UI に接続できません");

    await __pollOnceForTest();
    assert.equal(rebuildCalls.length, 2);

    await __pollOnceForTest();
    assert.equal(rebuildCalls.length, 3);
    stopDashboard();
  });

  it("does not poll when a non-dashboard view is active", async () => {
    fetchResults = [
      { ok: true, data: [row("develop-running")] },
      { ok: true, data: [row("review-pending")] },
    ];

    const unsubscribe = registerDashboardLifecycle(
      CONFIG,
      mockBridge as never,
    );
    assert.equal(__getPollTimerForTest(), null);

    nextView();
    assert.notEqual(__getPollTimerForTest(), null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(rebuildCalls.length, 1);

    nextView();
    assert.equal(__getPollTimerForTest(), null);

    await __pollOnceForTest();
    assert.equal(rebuildCalls.length, 1);

    unsubscribe();
    stopDashboard();
  });
});
