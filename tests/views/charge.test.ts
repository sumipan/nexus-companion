import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { ChargeData } from "../../src/api/charge.ts";
import type { Config } from "../../src/config.ts";
import {
  __resetChargeCacheForTest,
  __resetFetchChargeForTest,
  __setFetchChargeForTest,
  buildChargeText,
  extractMetrics,
  fetchChargeWithCache,
  getCachedCharge,
  preloadCharge,
  type ChargeMetric,
} from "../../src/views/charge.ts";

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

describe("charge helpers", () => {
  it("extractMetrics maps ChargeData to 4 metrics when codex is absent", () => {
    const metrics = extractMetrics(CHARGE_DATA);
    assert.equal(metrics.length, 4);
    assert.deepEqual(
      metrics.map((m) => m.label),
      ["Claude wk", "Claude 5h", "Cursor Au", "Cursor Ap"],
    );
    assert.equal(metrics[0]?.usedPercent, 50);
    assert.equal(metrics[1]?.usedPercent, 10);
    assert.equal(metrics[2]?.usedPercent, 30);
    assert.equal(metrics[3]?.usedPercent, 20);
  });

  it("extractMetrics appends Codex 5h / Codex wk when codex is present", () => {
    const withCodex: ChargeData = {
      ...CHARGE_DATA,
      codex: {
        session_5h: { used_percent: 100, reset_at: "2026-09-10T02:13:57+09:00" },
        weekly: { used_percent: 52, reset_at: "2026-09-15T13:07:05+09:00" },
        credits: { balance: "0", has_credits: false },
      },
    };
    const metrics = extractMetrics(withCodex);
    assert.equal(metrics.length, 6);
    assert.deepEqual(
      metrics.map((m) => m.label),
      ["Claude wk", "Claude 5h", "Cursor Au", "Cursor Ap", "Codex 5h", "Codex wk"],
    );
    assert.equal(metrics[4]?.usedPercent, 100);
    assert.equal(metrics[5]?.usedPercent, 52);
  });

  it("buildChargeText renders one line per metric with bar and percents", () => {
    const metrics: ChargeMetric[] = [
      { label: "Claude wk", usedPercent: 50, periodPercent: 25 },
      { label: "Claude 5h", usedPercent: 0, periodPercent: 100 },
    ];
    const text = buildChargeText(metrics);
    const lines = text.split("\n");
    assert.equal(lines.length, 2);
    assert.equal(lines[0], "Claude wk █████████░░░░░░░░░  50/ 25 %");
    assert.equal(lines[1], "Claude 5h ░░░░░░░░░░░░░░░░░░   0/100 %");
  });

  it("buildChargeText clamps out-of-range percents into the bar width", () => {
    const text = buildChargeText([
      { label: "X", usedPercent: 150, periodPercent: 0 },
    ]);
    assert.match(text, /█{18}/);
    assert.doesNotMatch(text, /░/);
  });
});

describe("charge cache", () => {
  beforeEach(() => {
    __resetChargeCacheForTest();
  });

  afterEach(() => {
    __resetFetchChargeForTest();
    __resetChargeCacheForTest();
  });

  it("fetchChargeWithCache stores result in cache", async () => {
    __setFetchChargeForTest(async () => ({ ok: true, data: CHARGE_DATA }));
    assert.equal(getCachedCharge(), null);
    const result = await fetchChargeWithCache(CONFIG);
    assert.equal(result.ok, true);
    assert.deepEqual(getCachedCharge(), { ok: true, data: CHARGE_DATA });
  });

  it("deduplicates concurrent fetches (single inflight)", async () => {
    let calls = 0;
    __setFetchChargeForTest(async () => {
      calls += 1;
      return { ok: true, data: CHARGE_DATA };
    });
    await Promise.all([preloadCharge(CONFIG), fetchChargeWithCache(CONFIG)]);
    assert.equal(calls, 1);
  });

  it("caches error results too", async () => {
    __setFetchChargeForTest(async () => ({ ok: false, error: "進捗データ取得失敗" }));
    await fetchChargeWithCache(CONFIG);
    assert.deepEqual(getCachedCharge(), { ok: false, error: "進捗データ取得失敗" });
  });
});
