import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { Config } from "../../src/config.ts";
import type { Result } from "../../src/api/types.ts";
import { __setCurrentViewForTest } from "../../src/state/view.ts";
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
});
