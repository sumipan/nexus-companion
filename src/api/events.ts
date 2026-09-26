import type { Config } from "../config";

/**
 * Subscription to charge_server `GET /events` (SSE).
 *
 * The 4 types `message` / `usage` / `rows` / `queue` are multiplexed on one stream.
 * On connect, the current value of each type is sent once, then only on change. A
 * `: ping` heartbeat arrives every 15 seconds.
 *
 * Transport is chosen in order: `EventSource` -> `fetch` stream -> unavailable (null).
 * Switching to polling on null / disconnect is the caller's (main.ts) job.
 */

export type SseEvent = { event: string; id: string | null; data: string };

export type EventsHandle = { close(): void; reconnect(): void };

const EVENT_TYPES = ["message", "usage", "rows", "queue"] as const;
const RETRY_MS = 3000;

/**
 * Extract only the events completed by a blank line from the received buffer.
 * The incomplete tail is returned as `rest`; prepend it to the next chunk.
 * Comment lines starting with `:` (heartbeat) are ignored; multiple `data:` lines are joined with `\n`.
 */
export function parseSseChunk(buffer: string): { events: SseEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n?/g, "\n");
  const events: SseEvent[] = [];
  let start = 0;
  for (;;) {
    const end = normalized.indexOf("\n\n", start);
    if (end === -1) break;
    const block = normalized.slice(start, end);
    start = end + 2;

    let event = "message";
    let id: string | null = null;
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line === "" || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      else if (field === "id") id = value;
      else if (field === "data") data.push(value);
    }
    // blocks without a data line (heartbeat etc.) are not events
    if (data.length > 0) {
      events.push({ event, id, data: data.join("\n") });
    }
  }
  return { events, rest: normalized.slice(start) };
}

function isKnownType(event: string): boolean {
  return (EVENT_TYPES as readonly string[]).includes(event);
}

/**
 * Subscribe to `/events`. Connection state is reported to `onState` only on change
 * (the first result is always reported). Returns null if no transport is available.
 */
export function subscribeEvents(
  config: Config,
  onEvent: (event: SseEvent) => void,
  onState: (connected: boolean) => void,
): EventsHandle | null {
  const url = `${config.chargeServerUrl}/events`;

  let connected: boolean | null = null;
  const setConnected = (next: boolean): void => {
    if (connected === next) return;
    connected = next;
    onState(next);
  };

  if (typeof EventSource === "function") {
    return subscribeWithEventSource(url, onEvent, setConnected);
  }
  if (typeof fetch === "function" && typeof ReadableStream === "function") {
    return subscribeWithFetch(url, onEvent, setConnected);
  }
  return null;
}

function subscribeWithEventSource(
  url: string,
  onEvent: (event: SseEvent) => void,
  setConnected: (connected: boolean) => void,
): EventsHandle {
  let source: EventSource | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  function open(): void {
    clearTimeout(retryTimer);
    source?.close();
    const es = new EventSource(url);
    source = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => {
      setConnected(false);
      // EventSource reconnects on its own, but gives up once CLOSED, so re-open it
      if (es.readyState === EventSource.CLOSED && !closed && source === es) {
        retryTimer = setTimeout(open, RETRY_MS);
      }
    };
    for (const type of EVENT_TYPES) {
      es.addEventListener(type, (ev: MessageEvent<string>) => {
        onEvent({ event: type, id: ev.lastEventId || null, data: ev.data });
      });
    }
  }

  open();

  return {
    close() {
      closed = true;
      clearTimeout(retryTimer);
      source?.close();
      source = null;
    },
    reconnect() {
      if (!closed) open();
    },
  };
}

function subscribeWithFetch(
  url: string,
  onEvent: (event: SseEvent) => void,
  setConnected: (connected: boolean) => void,
): EventsHandle {
  let controller: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let closed = false;

  async function run(gen: number, signal: AbortSignal): Promise<void> {
    try {
      const res = await fetch(url, { signal });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      setConnected(true);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseChunk(buffer);
        buffer = parsed.rest;
        for (const e of parsed.events) {
          if (gen !== generation) return;
          if (isKnownType(e.event)) onEvent(e);
        }
      }
    } catch {
      // disconnects / connect failures are retried below
    }
    if (closed || gen !== generation) return;
    setConnected(false);
    retryTimer = setTimeout(open, RETRY_MS);
  }

  function open(): void {
    clearTimeout(retryTimer);
    controller?.abort();
    generation += 1;
    controller = new AbortController();
    void run(generation, controller.signal);
  }

  open();

  return {
    close() {
      closed = true;
      generation += 1;
      clearTimeout(retryTimer);
      controller?.abort();
      controller = null;
    },
    reconnect() {
      if (!closed) open();
    },
  };
}
