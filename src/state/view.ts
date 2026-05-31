import type { Text_ItemEvent } from "@evenrealities/even_hub_sdk";

export type ViewName = "blank" | "diary" | "dashboard";
// blank を起動時 default にし、テンプル単タップで diary → dashboard → blank と
// 循環。普段は何も表示せず、見たい時だけタップで切り替える運用。
//
// v0.3.0 で旧 charge view を dashboard に統合 (LLM usage 上 + ghdag tasks
// 集約 1 行) し 3 段 rotation に整理。
const ORDER: ViewName[] = ["blank", "diary", "dashboard"];

type Listener = (v: ViewName) => void;
let current: ViewName = "blank";
const listeners: Set<Listener> = new Set();

export function getView(): ViewName {
  return current;
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function nextView(): void {
  current = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  listeners.forEach((fn) => fn(current));
}

// ─────────────────────────────────────────────────────────────
// textEvent dispatcher
// ─────────────────────────────────────────────────────────────
// SDK の `bridge.onEvenHubEvent` を複数回呼ぶと後から登録した listener が前の
// listener を上書きする/競合する事象を避けるため、event listener は main.ts に
// 1 本だけ持ち、textEvent (ページスクロール等) は各 view が register する
// handler に dispatch する設計に統一する。
//
// register された handler のうち current view に対応するものだけが呼ばれる。

export type TextEventHandler = (event: Text_ItemEvent) => void;

const textEventHandlers: Map<ViewName, TextEventHandler> = new Map();

export function registerTextEventHandler(
  view: ViewName,
  handler: TextEventHandler,
): () => void {
  textEventHandlers.set(view, handler);
  return () => {
    if (textEventHandlers.get(view) === handler) {
      textEventHandlers.delete(view);
    }
  };
}

export function dispatchTextEvent(event: Text_ItemEvent): void {
  const handler = textEventHandlers.get(current);
  if (handler) {
    handler(event);
  }
}
