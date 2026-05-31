import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getView, nextView, subscribe } from "../../src/state/view.ts";

describe("view state", () => {
  it("starts at diary", () => {
    assert.equal(getView(), "diary");
  });

  it("cycles diary → dashboard → charge → diary on three nextView calls", () => {
    nextView();
    assert.equal(getView(), "dashboard");
    nextView();
    assert.equal(getView(), "charge");
    nextView();
    assert.equal(getView(), "diary");
  });

  it("notifies subscribe listeners on nextView", () => {
    const seen: string[] = [];
    subscribe((v) => seen.push(v));
    nextView();
    assert.deepEqual(seen, ["dashboard"]);
  });

  it("unsubscribe stops notifications", () => {
    const seen: string[] = [];
    const unsub = subscribe((v) => seen.push(v));
    unsub();
    nextView();
    assert.deepEqual(seen, []);
  });
});
