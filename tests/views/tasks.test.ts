import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LINES_PER_PAGE, paginate } from "../../src/views/tasks.ts";

describe("paginate", () => {
  it("returns a single empty page for empty string", () => {
    assert.deepEqual(paginate(""), [""]);
  });

  it("returns one page when lines are fewer than LINES_PER_PAGE", () => {
    assert.deepEqual(paginate("a\nb\nc"), ["a\nb\nc"]);
  });

  it("splits into two pages of LINES_PER_PAGE lines each", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
    const pages = paginate(lines.join("\n"));
    assert.equal(pages.length, 2);
    assert.equal(pages[0].split("\n").length, LINES_PER_PAGE);
    assert.equal(pages[1].split("\n").length, LINES_PER_PAGE);
    assert.equal(pages[0].split("\n")[0], "line1");
    assert.equal(pages[1].split("\n")[0], "line11");
  });

  it("keeps a partial final page when line count is not divisible", () => {
    const lines = Array.from({ length: 15 }, (_, i) => `line${i + 1}`);
    const pages = paginate(lines.join("\n"));
    assert.equal(pages.length, 2);
    assert.equal(pages[0].split("\n").length, LINES_PER_PAGE);
    assert.equal(pages[1].split("\n").length, 5);
  });
});
