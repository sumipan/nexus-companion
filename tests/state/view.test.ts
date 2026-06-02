import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import {
  __resetAutoSwitchTimersForTest,
  autoSwitchTo,
  getView,
  nextView,
  subscribe,
} from "../../src/state/view.ts";

function resetState(): void {
  while (getView() !== "blank") {
    nextView();
  }
  __resetAutoSwitchTimersForTest();
}

describe("view state", () => {
  afterEach(() => {
    resetState();
    mock.timers.reset();
  });

  it("starts at blank", () => {
    assert.equal(getView(), "blank");
  });

  it("cycles blank → tasks → dashboard → blank on three nextView calls", () => {
    nextView();
    assert.equal(getView(), "tasks");
    nextView();
    assert.equal(getView(), "dashboard");
    nextView();
    assert.equal(getView(), "blank");
  });

  it("notifies subscribe listeners on nextView", () => {
    const seen: string[] = [];
    const unsub = subscribe((v) => seen.push(v));
    nextView();
    assert.deepEqual(seen, ["tasks"]);
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
    resetState();
    mock.timers.reset();
  });

  it("switches view when no grace/cooldown active", () => {
    nextView(); // blank → tasks
    __resetAutoSwitchTimersForTest(); // clear grace set by nextView
    autoSwitchTo("blank");
    assert.equal(getView(), "blank");
  });

  it("is suppressed within 90s grace period after manual switch", () => {
    mock.timers.enable({ apis: ["Date"] });
    nextView(); // manual: blank → tasks, sets lastManualSwitchAt = now
    autoSwitchTo("blank"); // within grace → suppressed
    assert.equal(getView(), "tasks");
  });

  it("fires after grace period expires", () => {
    mock.timers.enable({ apis: ["Date"] });
    nextView(); // manual switch at T=0
    mock.timers.tick(90_001);
    autoSwitchTo("blank");
    assert.equal(getView(), "blank");
  });

  it("does not switch when already on target view", () => {
    __resetAutoSwitchTimersForTest();
    const seen: string[] = [];
    const unsub = subscribe((v) => seen.push(v));
    autoSwitchTo("blank"); // already blank
    assert.deepEqual(seen, []);
    unsub();
  });

  it("notifies subscribers on successful auto-switch", () => {
    nextView(); // blank → tasks
    __resetAutoSwitchTimersForTest(); // clear grace timer set by nextView
    const seen: string[] = [];
    const unsub = subscribe((v) => seen.push(v));
    autoSwitchTo("blank");
    assert.deepEqual(seen, ["blank"]);
    unsub();
  });
});
