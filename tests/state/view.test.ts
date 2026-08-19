import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import {
  __resetViewStateForTest,
  autoSwitchTo,
  getView,
  MESSAGE_DISPLAY_MS,
  nextView,
  subscribe,
} from "../../src/state/view.ts";

describe("view state", () => {
  afterEach(() => {
    __resetViewStateForTest();
    mock.timers.reset();
  });

  it("starts at dashboard", () => {
    assert.equal(getView(), "dashboard");
  });

  it("toggles dashboard → message → dashboard on nextView", () => {
    nextView();
    assert.equal(getView(), "message");
    nextView();
    assert.equal(getView(), "dashboard");
  });

  it("notifies subscribe listeners on nextView", () => {
    const seen: string[] = [];
    const unsub = subscribe((v) => seen.push(v));
    nextView();
    assert.deepEqual(seen, ["message"]);
    unsub();
  });

  it("unsubscribe stops notifications", () => {
    const seen: string[] = [];
    const unsub = subscribe((v) => seen.push(v));
    unsub();
    nextView();
    assert.deepEqual(seen, []);
  });
});

describe("autoSwitchTo", () => {
  afterEach(() => {
    __resetViewStateForTest();
    mock.timers.reset();
  });

  it("switches view and notifies subscribers", () => {
    const seen: string[] = [];
    const unsub = subscribe((v) => seen.push(v));
    autoSwitchTo("message");
    assert.equal(getView(), "message");
    assert.deepEqual(seen, ["message"]);
    unsub();
  });

  it("does nothing when already on target view", () => {
    const seen: string[] = [];
    const unsub = subscribe((v) => seen.push(v));
    autoSwitchTo("dashboard"); // already dashboard
    assert.deepEqual(seen, []);
    unsub();
  });
});

describe("message display timer", () => {
  afterEach(() => {
    __resetViewStateForTest();
    mock.timers.reset();
  });

  it("returns to dashboard after MESSAGE_DISPLAY_MS (manual switch)", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    nextView(); // dashboard → message
    assert.equal(getView(), "message");
    mock.timers.tick(MESSAGE_DISPLAY_MS - 1);
    assert.equal(getView(), "message");
    mock.timers.tick(1);
    assert.equal(getView(), "dashboard");
  });

  it("returns to dashboard after MESSAGE_DISPLAY_MS (auto switch)", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    autoSwitchTo("message");
    assert.equal(getView(), "message");
    mock.timers.tick(MESSAGE_DISPLAY_MS);
    assert.equal(getView(), "dashboard");
  });

  it("notifies subscribers when the timer returns to dashboard", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    autoSwitchTo("message");
    const seen: string[] = [];
    const unsub = subscribe((v) => seen.push(v));
    mock.timers.tick(MESSAGE_DISPLAY_MS);
    assert.deepEqual(seen, ["dashboard"]);
    unsub();
  });

  it("is cancelled by a manual return to dashboard", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    nextView(); // → message
    nextView(); // → dashboard (timer cleared)
    const seen: string[] = [];
    const unsub = subscribe((v) => seen.push(v));
    mock.timers.tick(MESSAGE_DISPLAY_MS * 2);
    assert.equal(getView(), "dashboard");
    assert.deepEqual(seen, []);
    unsub();
  });

  it("is reset when message view is re-entered", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    nextView(); // → message (T=0)
    mock.timers.tick(MESSAGE_DISPLAY_MS - 5_000);
    nextView(); // → dashboard
    nextView(); // → message (new timer)
    mock.timers.tick(MESSAGE_DISPLAY_MS - 1);
    assert.equal(getView(), "message");
    mock.timers.tick(1);
    assert.equal(getView(), "dashboard");
  });
});
