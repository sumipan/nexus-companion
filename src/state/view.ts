import type { Text_ItemEvent } from "@evenrealities/even_hub_sdk";

export type ViewName = "blank" | "tasks" | "dashboard";

const ORDER: ViewName[] = ["blank", "tasks", "dashboard"];

type Listener = (v: ViewName) => void;
let current: ViewName = "blank";
const listeners: Set<Listener> = new Set();

// Grace: after manual switch (nextView), suppress autoSwitchTo for 90s.
// Cooldown: between auto-switches, enforce 5s minimum gap.
const GRACE_MS = 90_000;
const COOLDOWN_MS = 5_000;
let lastManualSwitchAt = 0;
let lastAutoSwitchAt = 0;

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
  lastManualSwitchAt = Date.now();
  current = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  listeners.forEach((fn) => fn(current));
}

export function autoSwitchTo(view: ViewName): void {
  const now = Date.now();
  if (now - lastManualSwitchAt < GRACE_MS) return;
  if (now - lastAutoSwitchAt < COOLDOWN_MS) return;
  if (current === view) return;
  lastAutoSwitchAt = now;
  current = view;
  listeners.forEach((fn) => fn(current));
}

// テスト用: タイマー状態をリセット（タイムスタンプを過去に戻す）
export function __resetAutoSwitchTimersForTest(): void {
  lastManualSwitchAt = 0;
  lastAutoSwitchAt = 0;
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
