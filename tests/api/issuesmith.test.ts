import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  fetchIssuesmithQueue,
  type QueueData,
} from "../../src/api/issuesmith.ts";
import type { Config } from "../../src/config.ts";

const CONFIG: Config = {
  chargeServerUrl: "http://localhost:8088",
  ghdagUiUrl: "http://localhost:8080",
};

/** 実採取 (2026-09-10): 稼働中キュー + codex paused */
const FIXTURE_ACTIVE: QueueData = {
  updated_at: "2026-09-10T00:05:04.400985+09:00",
  halt: false,
  halt_reason: null,
  last_issue: 2981,
  serial: true,
  in_flight: [
    { issue: 2960, engine: "cursor" },
    { issue: 2946, engine: "claude" },
    { issue: 2981, engine: "claude" },
  ],
  limits: { claude: 1, codex: 1, cursor: 1 },
  active: [
    {
      request_id: "cefbb343",
      issue: 2934,
      phase: "draft",
      priority: "normal",
      source: "skill",
      requested_at: "2026-09-09T21:07:43.431466+09:00",
    },
    {
      request_id: "e34526a4",
      issue: 2991,
      phase: "draft",
      priority: "low",
      source: "release-watcher",
      requested_at: "2026-09-09T22:54:45.698327+09:00",
    },
  ],
  engines: {
    codex: {
      status: "paused",
      reason: "codex conditions=session_5h session_5h=100.0 weekly=52.0",
      resume_at: "2026-09-09T17:13:57+00:00",
    },
  },
};

/** 空キュー（設計書の採取ケース） */
const FIXTURE_EMPTY: QueueData = {
  updated_at: "2026-09-09T14:55:00+09:00",
  halt: false,
  halt_reason: null,
  last_issue: null,
  serial: false,
  in_flight: [],
  limits: { claude: 1, cursor: 1 },
  active: [],
  engines: {
    claude: { status: "active", reason: null, resume_at: null },
    cursor: { status: "active", reason: null, resume_at: null },
  },
};

/** halt 中（設計書の採取ケース） */
const FIXTURE_HALT: QueueData = {
  updated_at: "2026-09-09T15:00:00+09:00",
  halt: true,
  halt_reason: "manual",
  last_issue: 2940,
  serial: false,
  in_flight: [],
  limits: { claude: 1 },
  active: [
    {
      request_id: "aaaaaaaa",
      issue: 2940,
      phase: "develop",
      priority: "high",
      source: "dag",
      requested_at: "2026-09-09T14:55:56+09:00",
    },
  ],
  engines: {
    claude: { status: "active", reason: null, resume_at: null },
  },
};

/** 全 engine paused（設計書の採取ケース） */
const FIXTURE_ALL_PAUSED: QueueData = {
  updated_at: "2026-09-09T16:00:00+09:00",
  halt: false,
  halt_reason: null,
  last_issue: 2900,
  serial: false,
  in_flight: [],
  limits: { claude: 1, cursor: 1, codex: 1 },
  active: [],
  engines: {
    claude: {
      status: "paused",
      reason: "quota_exceeded",
      resume_at: "2026-09-09T10:00:00+09:00",
    },
    cursor: {
      status: "paused",
      reason: "quota_exceeded",
      resume_at: "2026-09-09T11:00:00+09:00",
    },
    codex: {
      status: "paused",
      reason: "quota_exceeded",
      resume_at: "2026-09-09T09:07:00+09:00",
    },
  },
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchIssuesmithQueue", () => {
  it("returns ok with QueueData on 200 (active fixture)", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify(FIXTURE_ACTIVE), { status: 200 });
    const result = await fetchIssuesmithQueue(CONFIG);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.halt, false);
      assert.equal(result.data.active.length, 2);
      assert.equal(result.data.engines.codex?.status, "paused");
    }
  });

  it("returns ok with empty queue fixture", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify(FIXTURE_EMPTY), { status: 200 });
    const result = await fetchIssuesmithQueue(CONFIG);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.data.active, []);
      assert.deepEqual(result.data.in_flight, []);
    }
  });

  it("returns ok with halt fixture", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify(FIXTURE_HALT), { status: 200 });
    const result = await fetchIssuesmithQueue(CONFIG);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.halt, true);
      assert.equal(result.data.halt_reason, "manual");
    }
  });

  it("returns ok with all-engines-paused fixture", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify(FIXTURE_ALL_PAUSED), { status: 200 });
    const result = await fetchIssuesmithQueue(CONFIG);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.engines.claude?.status, "paused");
      assert.equal(result.data.engines.cursor?.status, "paused");
      assert.equal(result.data.engines.codex?.status, "paused");
    }
  });

  it("returns {ok:false} on HTTP error", async () => {
    globalThis.fetch = async () => new Response("nope", { status: 500 });
    const result = await fetchIssuesmithQueue(CONFIG);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.error.length > 0);
    }
  });

  it("returns {ok:false} on timeout (AbortError)", async () => {
    globalThis.fetch = async (_url, init) => {
      const signal = init?.signal;
      return new Promise((_resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    };
    const result = await fetchIssuesmithQueue(CONFIG);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.error.length > 0);
    }
  });

  it("requests ${chargeServerUrl}/issuesmith/queue", async () => {
    let requested: string | null = null;
    globalThis.fetch = async (input) => {
      requested = String(input);
      return new Response(JSON.stringify(FIXTURE_EMPTY), { status: 200 });
    };
    await fetchIssuesmithQueue(CONFIG);
    assert.equal(requested, "http://localhost:8088/issuesmith/queue");
  });
});
