import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { GhdagRow } from "../../src/api/ghdag.ts";
import type { ChargeData } from "../../src/api/charge.ts";
import type {
  QueueActiveItem,
  QueueData,
} from "../../src/api/issuesmith.ts";
import type { Config } from "../../src/config.ts";
import { textWidth } from "../../src/util/textWidth.ts";
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
  __resetFetchQueueForTest,
  __resetQueueCacheForTest,
  __setFetchGhdagRowsForTest,
  __setFetchQueueForTest,
  bucketizeRows,
  buildCombinedText,
  buildGhdagSummaryLine,
  buildQueueLine,
  buildStatusLine,
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

const QUEUE_IDLE: QueueData = {
  updated_at: "2026-09-09T14:55:00+09:00",
  halt: false,
  halt_reason: null,
  last_issue: null,
  serial: false,
  in_flight: [],
  limits: { claude: 1 },
  active: [],
  engines: {
    claude: { status: "active", reason: null, resume_at: null },
  },
};

function activeItem(
  overrides: Partial<QueueActiveItem> & Pick<QueueActiveItem, "issue" | "phase">,
): QueueActiveItem {
  return {
    request_id: "abcd1234",
    priority: "normal",
    source: "dag",
    requested_at: "2026-09-09T14:55:56+09:00",
    ...overrides,
  };
}

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

describe("dashboard — queue / status lines", () => {
  it("buildQueueLine returns Q - for empty active", () => {
    assert.equal(buildQueueLine([]), "Q -");
  });

  it("buildQueueLine formats up to 3 items with phase abbreviations", () => {
    const line = buildQueueLine([
      activeItem({ issue: 2940, phase: "develop", priority: "high" }),
      activeItem({ issue: 2939, phase: "draft", priority: "high" }),
      activeItem({ issue: 2937, phase: "draft" }),
    ]);
    assert.equal(line, "Q #2940 dev! > #2939 dr! > #2937 dr");
  });

  it("buildQueueLine appends (+N) when more than 3 items", () => {
    const line = buildQueueLine([
      activeItem({ issue: 1, phase: "sub" }),
      activeItem({ issue: 2, phase: "merge" }),
      activeItem({ issue: 3, phase: "draft" }),
      activeItem({ issue: 4, phase: "develop" }),
      activeItem({ issue: 5, phase: "draft" }),
    ]);
    assert.equal(line, "Q #1 sb > #2 mg > #3 dr (+2)");
  });

  it("buildQueueLine truncates to DEFAULT_MAX_WIDTH (540)", () => {
    const longActive = Array.from({ length: 3 }, (_, i) =>
      activeItem({
        issue: 9_999_999_999 + i,
        phase: "develop",
        priority: "high",
      }),
    );
    const line = buildQueueLine(longActive);
    assert.ok(textWidth(line) <= 540);
  });

  it("buildStatusLine returns idle when nothing is happening", () => {
    assert.equal(buildStatusLine(QUEUE_IDLE), "idle");
  });

  it("buildStatusLine starts with HALT when halt is true", () => {
    const line = buildStatusLine({
      ...QUEUE_IDLE,
      halt: true,
      halt_reason: "manual",
    });
    assert.match(line, /^HALT/);
  });

  it("buildStatusLine includes run engine#issue for in_flight", () => {
    const line = buildStatusLine({
      ...QUEUE_IDLE,
      in_flight: [{ issue: 2940, engine: "cursor" }],
    });
    assert.match(line, /run cursor#2940/);
  });

  it("buildStatusLine includes pause engine~HH:MM for paused engines", () => {
    const resumeAt = "2026-09-09T09:07:00+09:00";
    const expected = new Date(resumeAt).toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const line = buildStatusLine({
      ...QUEUE_IDLE,
      engines: {
        codex: { status: "paused", reason: "quota_exceeded", resume_at: resumeAt },
      },
    });
    assert.match(line, new RegExp(`pause codex~${expected}`));
  });

  it("buildStatusLine truncates to DEFAULT_MAX_WIDTH (540)", () => {
    const engines: QueueData["engines"] = {};
    for (let i = 0; i < 40; i++) {
      engines[`engine_${i}_${"x".repeat(20)}`] = {
        status: "paused",
        reason: "quota",
        resume_at: "2026-09-09T09:07:00+09:00",
      };
    }
    const line = buildStatusLine({
      ...QUEUE_IDLE,
      halt: true,
      in_flight: Array.from({ length: 20 }, (_, i) => ({
        issue: 1000 + i,
        engine: `engine${i}`,
      })),
      engines,
    });
    assert.ok(textWidth(line) <= 540);
  });
});

describe("dashboard — buildCombinedText", () => {
  it("inserts queue lines before ghdag summary when queue ok", () => {
    const text = buildCombinedText(
      { ok: true, data: CHARGE_DATA },
      { ok: true, data: [row("実行中")] },
      { ok: true, data: QUEUE_IDLE },
    );
    const lines = text.split("\n");
    // 4 charge + 2 queue + 1 ghdag
    assert.equal(lines.length, 7);
    assert.match(lines[0] ?? "", /^Claude wk /);
    assert.equal(lines[4], "Q -");
    assert.equal(lines[5], "idle");
    assert.equal(lines[6], "実行中 1 / 待機中 0 / 完了 0 / 失敗 0");
  });

  it("renders queue: offline and still draws charge + ghdag on queue failure", () => {
    const text = buildCombinedText(
      { ok: true, data: CHARGE_DATA },
      { ok: true, data: [row("実行中")] },
      { ok: false, error: "issuesmith queue 取得失敗" },
    );
    const lines = text.split("\n");
    // 4 charge + 1 offline + 1 ghdag
    assert.equal(lines.length, 6);
    assert.match(lines[0] ?? "", /^Claude wk /);
    assert.equal(lines[4], "queue: offline");
    assert.equal(lines[5], "実行中 1 / 待機中 0 / 完了 0 / 失敗 0");
  });
});

describe("dashboard — lifecycle", () => {
  beforeEach(() => {
    upgradeContents = [];
    __resetDashboardStateForTest();
    __resetChargeCacheForTest();
    __resetQueueCacheForTest();
    __resetViewStateForTest();
    __setFetchChargeForTest(async () => ({ ok: true, data: CHARGE_DATA }));
    __setFetchGhdagRowsForTest(async () => ({ ok: true, data: [row("実行中")] }));
    __setFetchQueueForTest(async () => ({ ok: true, data: QUEUE_IDLE }));
  });

  afterEach(() => {
    __resetDashboardStateForTest();
    __resetFetchChargeForTest();
    __resetFetchGhdagRowsForTest();
    __resetFetchQueueForTest();
    __resetChargeCacheForTest();
    __resetQueueCacheForTest();
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

  it("renders combined charge + queue + ghdag summary on poll", async () => {
    startDashboard(CONFIG, mockBridge as never);
    await __pollOnceForTest();
    const last = upgradeContents[upgradeContents.length - 1] ?? "";
    const lines = last.split("\n");
    // LLM usage 4 行 + キュー 2 行 + ghdag サマリ 1 行
    assert.equal(lines.length, 7);
    assert.match(lines[0] ?? "", /^Claude wk /);
    assert.equal(lines[4], "Q -");
    assert.equal(lines[5], "idle");
    assert.equal(lines[6], "実行中 1 / 待機中 0 / 完了 0 / 失敗 0");
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

  it("renders queue: offline when queue fetch fails but keeps charge and ghdag", async () => {
    __setFetchQueueForTest(async () => ({
      ok: false,
      error: "issuesmith queue 取得失敗",
    }));
    startDashboard(CONFIG, mockBridge as never);
    await __pollOnceForTest();
    const last = upgradeContents[upgradeContents.length - 1] ?? "";
    const lines = last.split("\n");
    assert.equal(lines.length, 6);
    assert.equal(lines[4], "queue: offline");
    assert.equal(lines[5], "実行中 1 / 待機中 0 / 完了 0 / 失敗 0");
    stopDashboard();
  });
});
