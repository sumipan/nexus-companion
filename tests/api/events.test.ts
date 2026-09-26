import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { Config } from "../../src/config.ts";
import {
  parseSseChunk,
  subscribeEvents,
  type SseEvent,
} from "../../src/api/events.ts";

const CONFIG: Config = {
  chargeServerUrl: "http://localhost:8088",
  ghdagUiUrl: "http://localhost:8080",
};

describe("parseSseChunk", () => {
  it("returns completed events and keeps the unfinished tail as rest", () => {
    const { events, rest } = parseSseChunk(
      "event: message\nid: a\ndata: L1\ndata: L2\n\n: ping\n\nevent: rows\ndata: [",
    );
    assert.deepEqual(events, [{ event: "message", id: "a", data: "L1\nL2" }]);
    assert.equal(rest, "event: rows\ndata: [");
  });

  it("ignores heartbeat comment blocks", () => {
    const { events, rest } = parseSseChunk(": ping\n\n: ping\n\n");
    assert.deepEqual(events, []);
    assert.equal(rest, "");
  });

  it("keeps an empty data line as an empty string", () => {
    const { events } = parseSseChunk("event: message\nid: x\ndata: \n\n");
    assert.deepEqual(events, [{ event: "message", id: "x", data: "" }]);
  });

  it("defaults event to message and id to null", () => {
    const { events } = parseSseChunk("data: hello\n\n");
    assert.deepEqual(events, [{ event: "message", id: null, data: "hello" }]);
  });

  it("handles CRLF line endings and multiple events", () => {
    const { events, rest } = parseSseChunk(
      "event: usage\r\ndata: {}\r\n\r\nevent: queue\r\ndata: []\r\n\r\n",
    );
    assert.deepEqual(events, [
      { event: "usage", id: null, data: "{}" },
      { event: "queue", id: null, data: "[]" },
    ]);
    assert.equal(rest, "");
  });

  it("returns nothing for an incomplete buffer", () => {
    const { events, rest } = parseSseChunk("event: rows\ndata: [1,");
    assert.deepEqual(events, []);
    assert.equal(rest, "event: rows\ndata: [1,");
  });
});

describe("subscribeEvents", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = {
    EventSource: g.EventSource,
    fetch: g.fetch,
  };

  afterEach(() => {
    g.EventSource = saved.EventSource;
    g.fetch = saved.fetch;
  });

  it("returns null when neither EventSource nor fetch is available", () => {
    g.EventSource = undefined;
    g.fetch = undefined;
    const handle = subscribeEvents(CONFIG, () => {}, () => {});
    assert.equal(handle, null);
  });

  it("reads the fetch stream and reports connected state", async () => {
    g.EventSource = undefined;
    const encoder = new TextEncoder();
    const chunks = [
      "event: message\nid: a\ndata: hi\n\n: pi",
      "ng\n\nevent: rows\ndata: []\n\nevent: diary\ndata: x\n\n",
    ];
    let requestedUrl = "";
    g.fetch = async (url: string) => {
      requestedUrl = url;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const c of chunks) controller.enqueue(encoder.encode(c));
          // keep the stream open (aborted by close())
        },
      });
      return new Response(body, { status: 200 });
    };

    const events: SseEvent[] = [];
    const states: boolean[] = [];
    const handle = subscribeEvents(
      CONFIG,
      (e) => events.push(e),
      (c) => states.push(c),
    );
    assert.notEqual(handle, null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    handle?.close();

    assert.equal(requestedUrl, "http://localhost:8088/events");
    assert.deepEqual(states, [true]);
    // types other than the 4 (diary) are not dispatched
    assert.deepEqual(events, [
      { event: "message", id: "a", data: "hi" },
      { event: "rows", id: null, data: "[]" },
    ]);
  });

  it("reports disconnected when the fetch fails", async () => {
    g.EventSource = undefined;
    g.fetch = async () => {
      throw new TypeError("network error");
    };
    const states: boolean[] = [];
    const handle = subscribeEvents(CONFIG, () => {}, (c) => states.push(c));
    await new Promise((resolve) => setTimeout(resolve, 10));
    handle?.close();
    assert.deepEqual(states, [false]);
  });

  it("uses EventSource when available", () => {
    const listeners: string[] = [];
    let openedUrl = "";
    let closed = false;
    class FakeEventSource {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readyState = 0;
      constructor(url: string) {
        openedUrl = url;
      }
      addEventListener(type: string): void {
        listeners.push(type);
      }
      close(): void {
        closed = true;
      }
    }
    g.EventSource = FakeEventSource;
    const handle = subscribeEvents(CONFIG, () => {}, () => {});
    assert.notEqual(handle, null);
    assert.equal(openedUrl, "http://localhost:8088/events");
    assert.deepEqual(listeners.sort(), ["message", "queue", "rows", "usage"]);
    handle?.close();
    assert.equal(closed, true);
  });
});
