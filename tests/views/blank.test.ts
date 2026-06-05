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
  __activateForTest,
  __pollOnceForTest,
  __resetBlankStateForTest,
  __resetFetchMessageForTest,
  __setFetchMessageForTest,
  registerBlankLifecycle,
} from "../../src/views/blank.ts";

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

describe("blank view — auto-clear on same message", () => {
  let unsubscribe: () => void;

  beforeEach(() => {
    upgradeContents = [];
    __resetBlankStateForTest();
    // Prevent auto-activate: start from non-blank view
    __setCurrentViewForTest("tasks");
  });

  afterEach(() => {
    if (unsubscribe) unsubscribe();
    __resetFetchMessageForTest();
    __resetBlankStateForTest();
    __setCurrentViewForTest("blank");
  });

  it("displays message on first activate", async () => {
    __setFetchMessageForTest(makeResults(["こんにちは"]));
    unsubscribe = registerBlankLifecycle(mockBridge as never, CONFIG);
    await __activateForTest();
    assert.equal(upgradeContents.length, 1);
    assert.equal(upgradeContents[0], "こんにちは");
  });

  it("clears display when next poll returns the same message", async () => {
    __setFetchMessageForTest(makeResults(["こんにちは", "こんにちは"]));
    unsubscribe = registerBlankLifecycle(mockBridge as never, CONFIG);
    await __activateForTest();
    assert.equal(upgradeContents[0], "こんにちは");

    await __pollOnceForTest();
    assert.equal(upgradeContents[1], CLEAR_CONTENT);
  });

  it("displays new message when content changes between polls", async () => {
    __setFetchMessageForTest(makeResults(["こんにちは", "さようなら"]));
    unsubscribe = registerBlankLifecycle(mockBridge as never, CONFIG);
    await __activateForTest();
    assert.equal(upgradeContents[0], "こんにちは");

    await __pollOnceForTest();
    assert.equal(upgradeContents[1], "さようなら");
  });

  it("clears again when the new message repeats on the third poll", async () => {
    __setFetchMessageForTest(makeResults(["A", "B", "B"]));
    unsubscribe = registerBlankLifecycle(mockBridge as never, CONFIG);
    await __activateForTest();
    assert.equal(upgradeContents[0], "A");

    await __pollOnceForTest();
    assert.equal(upgradeContents[1], "B");

    await __pollOnceForTest();
    assert.equal(upgradeContents[2], CLEAR_CONTENT);
  });

  it("resets lastContent on deactivate so message re-appears after re-activate", async () => {
    __setFetchMessageForTest(makeResults(["Hello", "Hello", "Hello"]));
    unsubscribe = registerBlankLifecycle(mockBridge as never, CONFIG);

    // First activation
    await __activateForTest();
    assert.equal(upgradeContents[0], "Hello");

    // Deactivate (simulated by view change away from blank via unsubscribe + re-register)
    unsubscribe();
    __resetBlankStateForTest();
    upgradeContents = [];

    // Re-register and re-activate (lastContent should be null)
    unsubscribe = registerBlankLifecycle(mockBridge as never, CONFIG);
    await __activateForTest();
    assert.equal(upgradeContents[0], "Hello");
  });

  it("starts cleared on re-activate when the same message was previously shown and cleared", async () => {
    __setFetchMessageForTest(makeResults(["Hello", "Hello", "Hello"]));
    unsubscribe = registerBlankLifecycle(mockBridge as never, CONFIG);

    // First activate: shows "Hello"
    await __activateForTest();
    assert.equal(upgradeContents[0], "Hello");

    // Same message on next poll → clears (lastClearedContent = "Hello")
    await __pollOnceForTest();
    assert.equal(upgradeContents[1], CLEAR_CONTENT);

    // Simulate partial deactivate (view change, not full state reset)
    nextView(); // tasks → dashboard, subscriber fires → deactivate()
    __resetAutoSwitchTimersForTest();
    upgradeContents = [];

    // Re-activate: should start cleared immediately (no "Hello" flash)
    await __activateForTest();
    assert.equal(upgradeContents[0], CLEAR_CONTENT);
  });
});

describe("blank view — auto-switch to blank on new message", () => {
  let unsubscribe: () => void;

  beforeEach(() => {
    upgradeContents = [];
    __resetBlankStateForTest();
    __resetAutoSwitchTimersForTest();
    // Start from non-blank view so auto-switch has somewhere to switch from
    __setCurrentViewForTest("tasks");
  });

  afterEach(() => {
    if (unsubscribe) unsubscribe();
    __resetFetchMessageForTest();
    __resetBlankStateForTest();
    __setCurrentViewForTest("blank");
  });

  it("auto-switches to blank and displays message when background poll detects new message", async () => {
    __setFetchMessageForTest(makeResults(["新着メッセージ"]));
    unsubscribe = registerBlankLifecycle(mockBridge as never, CONFIG);
    assert.equal(getView(), "tasks");

    await __pollOnceForTest();

    assert.equal(getView(), "blank");
    assert.equal(upgradeContents[0], "新着メッセージ");
  });

  it("does not auto-switch when message is empty (CLEAR_CONTENT)", async () => {
    __setFetchMessageForTest(makeResults([null])); // null → メッセージ未配置 → CLEAR_CONTENT
    unsubscribe = registerBlankLifecycle(mockBridge as never, CONFIG);

    await __pollOnceForTest();

    assert.equal(getView(), "tasks");
    assert.equal(upgradeContents.length, 0);
  });

  it("does not auto-switch again when the same message is polled twice", async () => {
    __setFetchMessageForTest(makeResults(["同じメッセージ", "同じメッセージ"]));
    unsubscribe = registerBlankLifecycle(mockBridge as never, CONFIG);

    // First poll: auto-switches to blank
    await __pollOnceForTest();
    assert.equal(getView(), "blank");

    // Properly switch away (triggers deactivate via subscription listener)
    nextView(); // blank → tasks, fires listener → deactivate()
    __resetAutoSwitchTimersForTest();
    upgradeContents = [];

    // Second poll: same message → should NOT auto-switch
    await __pollOnceForTest();

    assert.equal(getView(), "tasks");
    assert.equal(upgradeContents.length, 0);
  });

  it("auto-switches again when a new message arrives after the previous one", async () => {
    __setFetchMessageForTest(makeResults(["最初のメッセージ", "新しいメッセージ"]));
    unsubscribe = registerBlankLifecycle(mockBridge as never, CONFIG);

    // First poll: auto-switches for first message
    await __pollOnceForTest();
    assert.equal(getView(), "blank");

    // Properly switch away (triggers deactivate via subscription listener)
    nextView(); // blank → tasks, fires listener → deactivate()
    __resetAutoSwitchTimersForTest();
    upgradeContents = [];

    // Second poll: new message → should auto-switch again
    await __pollOnceForTest();

    assert.equal(getView(), "blank");
    assert.equal(upgradeContents[0], "新しいメッセージ");
  });
});
