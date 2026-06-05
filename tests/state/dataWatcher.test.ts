import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { Config } from "../../src/config.ts";
import type { Result } from "../../src/api/types.ts";
import {
  __resetAutoSwitchTimersForTest,
  __setCurrentViewForTest,
  getView,
  nextView,
} from "../../src/state/view.ts";
import {
  __pollOnceForTest,
  __resetDataWatcherForTest,
  __setFetchMessageForTest,
  __setFetchTasksForTest,
  __setFingerprintForTest,
  __setTasksContentForTest,
} from "../../src/state/dataWatcher.ts";

const CONFIG: Config = {
  chargeServerUrl: "http://localhost:8088",
  ghdagUiUrl: "http://localhost:8080",
};

function makeMsg(messages: (string | null)[]): (config: Config) => Promise<Result<string>> {
  const queue = [...messages];
  return async () => {
    const msg = queue.shift();
    if (msg === null || msg === undefined) {
      return { ok: false as const, error: "メッセージ未配置" };
    }
    return { ok: true as const, data: msg };
  };
}

function makeTasks(items: (string | null)[]): (config: Config) => Promise<Result<string>> {
  const queue = [...items];
  return async () => {
    const item = queue.shift();
    if (item === null || item === undefined) {
      return { ok: false as const, error: "取得失敗" };
    }
    return { ok: true as const, data: item };
  };
}

describe("dataWatcher — tasks auto-switch", () => {
  beforeEach(() => {
    __resetDataWatcherForTest();
    __resetAutoSwitchTimersForTest();
    __setCurrentViewForTest("blank");
  });

  afterEach(() => {
    __resetDataWatcherForTest();
    __setCurrentViewForTest("blank");
  });

  it("does not auto-switch on first poll (no baseline to compare)", async () => {
    nextView(); // blank → tasks
    __resetAutoSwitchTimersForTest();

    __setFetchMessageForTest(makeMsg(["msg"]));
    __setFetchTasksForTest(makeTasks(["- task A"]));

    await __pollOnceForTest(CONFIG);

    // First poll sets baseline; no auto-switch should happen
    assert.equal(getView(), "tasks");
  });

  it("auto-switches to tasks when tasks content changes", async () => {
    nextView(); // blank → tasks (start somewhere other than tasks... actually any view works)
    nextView(); // tasks → dashboard
    __resetAutoSwitchTimersForTest();

    // Seed: pretend we already polled once (have baseline)
    __setFingerprintForTest("msg");
    __setTasksContentForTest("- old task");

    __setFetchMessageForTest(makeMsg(["msg"]));
    __setFetchTasksForTest(makeTasks(["- new task"]));

    await __pollOnceForTest(CONFIG);

    // tasks content changed → auto-switch to tasks
    assert.equal(getView(), "tasks");
  });

  it("does not auto-switch to tasks when content is unchanged", async () => {
    nextView(); // blank → tasks
    nextView(); // tasks → dashboard
    __resetAutoSwitchTimersForTest();

    __setFingerprintForTest("msg");
    __setTasksContentForTest("- task A");

    __setFetchMessageForTest(makeMsg(["msg"]));
    __setFetchTasksForTest(makeTasks(["- task A"])); // same content

    await __pollOnceForTest(CONFIG);

    assert.equal(getView(), "dashboard"); // no switch
  });

  it("auto-switches to blank when message fingerprint changes", async () => {
    nextView(); // blank → tasks
    __resetAutoSwitchTimersForTest();

    __setFingerprintForTest("old message");
    __setTasksContentForTest("- task A");

    __setFetchMessageForTest(makeMsg(["new message"]));
    __setFetchTasksForTest(makeTasks(["- task A"]));

    await __pollOnceForTest(CONFIG);

    assert.equal(getView(), "blank"); // switched to blank for new message
  });
});
