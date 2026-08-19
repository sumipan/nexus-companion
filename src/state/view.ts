import type { Text_ItemEvent } from "@evenrealities/even_hub_sdk";

export type ViewName = "message" | "dashboard";

const ORDER: ViewName[] = ["dashboard", "message"];

// メッセージ表示の表示時間。経過したら dashboard (ステータス表示) へ自動で戻す。
// 手動タップ / 自動切替のどちらで message になった場合も適用する。
export const MESSAGE_DISPLAY_MS = 30_000;

type Listener = (v: ViewName) => void;
let current: ViewName = "dashboard";
const listeners: Set<Listener> = new Set();

let returnTimer: ReturnType<typeof setTimeout> | undefined;

function setView(view: ViewName): void {
  current = view;
  // message になったら 30 秒後に dashboard へ戻すタイマーを張り直す。
  // message 以外へ切り替わったら pending タイマーを破棄する。
  if (returnTimer !== undefined) {
    clearTimeout(returnTimer);
    returnTimer = undefined;
  }
  if (view === "message") {
    returnTimer = setTimeout(() => {
      returnTimer = undefined;
      if (current === "message") {
        setView("dashboard");
      }
    }, MESSAGE_DISPLAY_MS);
  }
  listeners.forEach((fn) => fn(current));
}

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
  setView(ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]);
}

export function autoSwitchTo(view: ViewName): void {
  if (current === view) return;
  setView(view);
}

// テスト用: current を初期状態 (dashboard) に戻し、pending タイマーを破棄する
export function __resetViewStateForTest(): void {
  if (returnTimer !== undefined) {
    clearTimeout(returnTimer);
    returnTimer = undefined;
  }
  current = "dashboard";
}

/** @internal test only */
export function __setCurrentViewForTest(v: ViewName): void {
  current = v;
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
