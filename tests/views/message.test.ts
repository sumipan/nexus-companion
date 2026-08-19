import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { Config } from "../../src/config.ts";
import type { Result } from "../../src/api/types.ts";
import {
  __resetViewStateForTest,
  __setCurrentViewForTest,
  getView,
  nextView,
} from "../../src/state/view.ts";
import {
  __activateForTest,
  __pollOnceForTest,
  __resetMessageStateForTest,
  __resetFetchMessageForTest,
  __setFetchMessageForTest,
  registerMessageLifecycle,
} from "../../src/views/message.ts";

const CONFIG: Config = {
  chargeServerUrl: "http://localhost:8088",
  ghdagUiUrl: "http://localhost:8080",
};

const CLEAR_CONTENT = " ";

let upgradeContents: string[] = [];

const mockBridge = {
  textContainerUpgrade: async (upgrade: { content?: string }) => {
    upgradeContents.push(upgrade.content ?? "");
  },
};

function makeResults(messages: (string | null)[]): () => Promise<Result<string>> {
  const queue = [...messages];
  return async () => {
    const msg = queue.shift();
    if (msg === undefined || msg === null) {
      return { ok: false as const, error: "メッセージ未配置" };
    }
    return { ok: true as const, data: msg };
  };
}

describe("message view — persistent display", () => {
  let unsubscribe: () => void;

  beforeEach(() => {
    upgradeContents = [];
    __resetMessageStateForTest();
    __resetViewStateForTest();
    // Start from dashboard (default) so activate is driven by tests
    __setCurrentViewForTest("dashboard");
  });

  afterEach(() => {
    if (unsubscribe) unsubscribe();
    __resetFetchMessageForTest();
    __resetMessageStateForTest();
    __resetViewStateForTest();
  });

  it("displays message on first activate", async () => {
    __setFetchMessageForTest(makeResults(["こんにちは"]));
    unsubscribe = registerMessageLifecycle(mockBridge as never, CONFIG);
    await __activateForTest();
    assert.equal(upgradeContents.length, 1);
    assert.equal(upgradeContents[0], "こんにちは");
  });

  it("keeps displaying when next poll returns the same message (no clear)", async () => {
    __setFetchMessageForTest(makeResults(["こんにちは", "こんにちは"]));
    unsubscribe = registerMessageLifecycle(mockBridge as never, CONFIG);
    await __activateForTest();
    assert.equal(upgradeContents[0], "こんにちは");

    await __pollOnceForTest();
    // 同一メッセージ → 再描画もクリアもしない
    assert.equal(upgradeContents.length, 1);
  });

  it("displays new message when content changes between polls", async () => {
    __setFetchMessageForTest(makeResults(["こんにちは", "さようなら"]));
    unsubscribe = registerMessageLifecycle(mockBridge as never, CONFIG);
    await __activateForTest();
    assert.equal(upgradeContents[0], "こんにちは");

    await __pollOnceForTest();
    assert.equal(upgradeContents[1], "さようなら");
  });

  it("shows CLEAR_CONTENT when no message has been placed (404)", async () => {
    __setFetchMessageForTest(makeResults([null]));
    unsubscribe = registerMessageLifecycle(mockBridge as never, CONFIG);
    await __activateForTest();
    assert.equal(upgradeContents[0], CLEAR_CONTENT);
  });

  it("re-displays the same message after deactivate → re-activate", async () => {
    __setFetchMessageForTest(makeResults(["Hello", "Hello", "Hello"]));
    unsubscribe = registerMessageLifecycle(mockBridge as never, CONFIG);

    // dashboard → message: activate
    nextView();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(upgradeContents[0], "Hello");

    // message → dashboard: deactivate (lastContent リセット)
    nextView();
    upgradeContents = [];

    // dashboard → message: re-activate → 同じメッセージが再描画される
    nextView();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(upgradeContents[0], "Hello");
  });
});

describe("message view — auto-switch on new message", () => {
  let unsubscribe: () => void;

  beforeEach(() => {
    upgradeContents = [];
    __resetMessageStateForTest();
    __resetViewStateForTest();
    __setCurrentViewForTest("dashboard");
  });

  afterEach(() => {
    if (unsubscribe) unsubscribe();
    __resetFetchMessageForTest();
    __resetMessageStateForTest();
    __resetViewStateForTest();
  });

  it("auto-switches to message view and displays it when background poll detects a new message", async () => {
    __setFetchMessageForTest(makeResults(["新着メッセージ"]));
    unsubscribe = registerMessageLifecycle(mockBridge as never, CONFIG);
    assert.equal(getView(), "dashboard");

    await __pollOnceForTest();

    assert.equal(getView(), "message");
    assert.equal(upgradeContents[0], "新着メッセージ");
  });

  it("does not auto-switch when no message is placed", async () => {
    __setFetchMessageForTest(makeResults([null]));
    unsubscribe = registerMessageLifecycle(mockBridge as never, CONFIG);

    await __pollOnceForTest();

    assert.equal(getView(), "dashboard");
    assert.equal(upgradeContents.length, 0);
  });

  it("does not auto-switch again for the same message after returning to dashboard", async () => {
    __setFetchMessageForTest(makeResults(["同じメッセージ", "同じメッセージ"]));
    unsubscribe = registerMessageLifecycle(mockBridge as never, CONFIG);

    // First poll: auto-switches to message
    await __pollOnceForTest();
    assert.equal(getView(), "message");

    // Return to dashboard (fires listener → deactivate)
    nextView();
    upgradeContents = [];

    // Second poll: same message → stays on dashboard
    await __pollOnceForTest();
    assert.equal(getView(), "dashboard");
    assert.equal(upgradeContents.length, 0);
  });

  it("auto-switches again when a different message arrives", async () => {
    __setFetchMessageForTest(makeResults(["メッセージ A", "メッセージ B"]));
    unsubscribe = registerMessageLifecycle(mockBridge as never, CONFIG);

    await __pollOnceForTest();
    assert.equal(getView(), "message");

    nextView(); // back to dashboard
    upgradeContents = [];

    await __pollOnceForTest();
    assert.equal(getView(), "message");
    assert.equal(upgradeContents[0], "メッセージ B");
  });
});
