import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { GhdagRow } from "../../src/api/ghdag.ts";
import type { ChargeData } from "../../src/api/charge.ts";
import type { Config } from "../../src/config.ts";
import {
  __resetViewStateForTest,
  __setCurrentViewForTest,
  nextView,
} from "../../src/state/view.ts";
import {
  __resetChargeCacheForTest,
  __resetFetchChargeForTest,
  __setFetchChargeForTest,
} from "../../src/views/charge.ts";
import {
  __getPollTimerForTest,
  __pollOnceForTest,
  __resetDashboardStateForTest,
  __resetFetchGhdagRowsForTest,
  __setFetchGhdagRowsForTest,
  bucketizeRows,
  buildGhdagSummaryLine,
  registerDashboardLifecycle,
  startDashboard,
  stopDashboard,
} from "../../src/views/dashboard.ts";

const CONFIG: Config = {
  chargeServerUrl: "http://localhost:8088",
  ghdagUiUrl: "http://localhost:8080",
};

const CHARGE_DATA: ChargeData = {
  updated_at: "2026-01-01T00:00:00Z",
  claude: {
    weekly: { used_percent: 50, reset_at: "2026-01-05T00:00:00Z" },
    session_5h: { used_percent: 10, reset_at: "2026-01-01T05:00:00Z" },
  },
  cursor: {
    monthly: {
      total_percent: 40,
      auto_percent: 30,
      api_percent: 20,
      reset_at: "2026-01-20T00:00:00Z",
    },
  },
};

let upgradeContents: string[] = [];

const mockBridge = {
  textContainerUpgrade: async (upgrade: { content?: string }) => {
    upgradeContents.push(upgrade.content ?? "");
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

describe("dashboard — ghdag aggregation", () => {
  it("bucketizeRows groups states into 4 buckets", () => {
    const counts = bucketizeRows([
      row("実行中"),
      row("待機（依存未充足）"),
      row("待機（実行可能）"),
      row("完了（成功）"),
      row("完了（その他）"),
      row("完了（失敗）"),
      row("完了（REJECTED）"),
      row("完了（EMPTY_RESULT）"),
    ]);
    assert.deepEqual(counts, { 実行中: 1, 待機中: 2, 完了: 2, 失敗: 3 });
  });

  it("bucketizeRows ignores unknown states", () => {
    const counts = bucketizeRows([row("謎の状態"), row("実行中")]);
    assert.deepEqual(counts, { 実行中: 1, 待機中: 0, 完了: 0, 失敗: 0 });
  });

  it("buildGhdagSummaryLine formats counts on one line", () => {
    assert.equal(
      buildGhdagSummaryLine({ 実行中: 1, 待機中: 2, 完了: 3, 失敗: 4 }),
      "実行中 1 / 待機中 2 / 完了 3 / 失敗 4",
    );
  });
});

describe("dashboard — lifecycle", () => {
  beforeEach(() => {
    upgradeContents = [];
    __resetDashboardStateForTest();
    __resetChargeCacheForTest();
    __resetViewStateForTest();
    __setFetchChargeForTest(async () => ({ ok: true, data: CHARGE_DATA }));
    __setFetchGhdagRowsForTest(async () => ({ ok: true, data: [row("実行中")] }));
  });

  afterEach(() => {
    __resetDashboardStateForTest();
    __resetFetchChargeForTest();
    __resetFetchGhdagRowsForTest();
    __resetChargeCacheForTest();
    __resetViewStateForTest();
  });

  it("starts polling immediately when dashboard is the current (default) view", async () => {
    const unsubscribe = registerDashboardLifecycle(CONFIG, mockBridge as never);
    assert.notEqual(__getPollTimerForTest(), null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(upgradeContents.length >= 1);
    unsubscribe();
    stopDashboard();
  });

  it("does not start when a non-dashboard view is current", () => {
    __setCurrentViewForTest("message");
    const unsubscribe = registerDashboardLifecycle(CONFIG, mockBridge as never);
    assert.equal(__getPollTimerForTest(), null);
    unsubscribe();
    stopDashboard();
  });

  it("stops on switch to message and restarts on switch back", async () => {
    const unsubscribe = registerDashboardLifecycle(CONFIG, mockBridge as never);
    assert.notEqual(__getPollTimerForTest(), null);

    nextView(); // dashboard → message
    assert.equal(__getPollTimerForTest(), null);

    nextView(); // message → dashboard
    assert.notEqual(__getPollTimerForTest(), null);

    unsubscribe();
    stopDashboard();
  });

  it("renders combined charge + ghdag summary on poll", async () => {
    startDashboard(CONFIG, mockBridge as never);
    await __pollOnceForTest();
    const last = upgradeContents[upgradeContents.length - 1] ?? "";
    const lines = last.split("\n");
    // LLM usage 4 行 + ghdag サマリ 1 行
    assert.equal(lines.length, 5);
    assert.match(lines[0] ?? "", /^Claude wk /);
    assert.equal(lines[4], "実行中 1 / 待機中 0 / 完了 0 / 失敗 0");
    stopDashboard();
  });

  it("renders error text when ghdag fetch fails", async () => {
    __setFetchGhdagRowsForTest(async () => ({
      ok: false,
      error: "ghdag UI に接続できません",
    }));
    startDashboard(CONFIG, mockBridge as never);
    await __pollOnceForTest();
    const last = upgradeContents[upgradeContents.length - 1] ?? "";
    assert.ok(last.includes("ghdag UI に接続できません"));
    stopDashboard();
  });
});
