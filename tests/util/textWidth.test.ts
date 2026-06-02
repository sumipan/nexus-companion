import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { textWidth, truncateToMaxWidth } from "../../src/util/textWidth.ts";

describe("textWidth", () => {
  it("counts ASCII chars as width 1", () => {
    assert.equal(textWidth("abc"), 3);
  });

  it("counts CJK chars as width 2", () => {
    assert.equal(textWidth("日本語"), 6);
  });

  it("counts mixed content correctly", () => {
    assert.equal(textWidth("AB日本"), 2 + 4);
  });

  it("empty string is 0", () => {
    assert.equal(textWidth(""), 0);
  });
});

describe("truncateToMaxWidth", () => {
  it("passes through short text", () => {
    assert.equal(truncateToMaxWidth("hello", 10), "hello");
  });

  it("truncates ASCII at exact boundary", () => {
    assert.equal(truncateToMaxWidth("abcde", 3), "abc");
  });

  it("does not split a wide character", () => {
    // "日" has width 2, maxWidth=1 → nothing fits
    assert.equal(truncateToMaxWidth("日本語", 1), "");
  });

  it("truncates after full-width char that fits", () => {
    // "日" width=2, "本" width=2, total=4 → maxWidth=3 keeps only "日"
    assert.equal(truncateToMaxWidth("日本語", 3), "日");
  });

  it("defaults to 540 (270 full-width chars) when no maxWidth given", () => {
    const s = "あ".repeat(270); // 270 × 2 = 540 → exactly fits
    assert.equal(truncateToMaxWidth(s), s);
    const overLimit = "あ".repeat(271);
    assert.equal(truncateToMaxWidth(overLimit), s);
  });
});
