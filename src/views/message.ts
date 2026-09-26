import {
  TextContainerUpgrade,
  type EvenAppBridge,
} from "@evenrealities/even_hub_sdk";

import { fetchMessage } from "../api/message.ts";
import type { Result } from "../api/types.ts";
import type { Config } from "../config.ts";
import { autoSwitchTo, getView, subscribe, type ViewName } from "../state/view.ts";
import { truncateToMaxWidth } from "../util/textWidth.ts";

/**
 * message View
 *
 * 秘書エージェントからの一言 (`${NIKKI_ROOT}/message.txt` の本文) を glass に
 * 表示する。受信済みメッセージは次のメッセージが来るまで表示し続ける
 * (旧 blank view の「同一メッセージ再表示時にクリア」は v0.4.0 で廃止)。
 * message.txt が無い時のみ空白 1 文字で glass をクリアする
 * (`textContainerUpgrade({content: ""})` は SDK で no-op になり前 view の
 * 描画が残るため半角スペース 1 個を送る)。
 *
 * New messages arrive via charge_server `/events` (`message` event); when hidden,
 * it auto-switches to the message view. Only while `/events` is disconnected,
 * a 60-second fallback poll fetches `/message`.
 * ステータス表示への復帰は state/view.ts の表示時間タイマーが担う。
 *
 * 実装メモ (経緯):
 * - `bridge.shutDownPageContainer()` はアプリ終了系の API なので呼ばない
 *   (v0.1.7 で確認済み)。
 * - bootstrap で立てた containerID=1 / isEventCapture=1 の container を共有し、
 *   textContainerUpgrade で content だけ書き換える。
 */

const CONTAINER_ID = 1;
const CONTAINER_NAME = "main";
const CLEAR_CONTENT = " "; // 空文字列は no-op になるので半角スペース 1 個で上書き
const FALLBACK_POLL_INTERVAL_MS = 60_000;

// preload cache
let cachedMessage: Result<string> | null = null;
let inflightMessage: Promise<Result<string>> | null = null;

// DI hook for testing
let _fetchMessageImpl: (config: Config) => Promise<Result<string>> = fetchMessage;
let _pollFn: (() => Promise<void>) | null = null;
let _applyResultFn: ((result: Result<string>) => Promise<void>) | null = null;
let _activateFn: (() => Promise<void>) | null = null;

// Fallback polling: runs only while `/events` is disconnected
let streamConnected = false;
let pollTimer: ReturnType<typeof setInterval> | undefined;

/** @internal test only */
export function __setFetchMessageForTest(fn: (config: Config) => Promise<Result<string>>): void {
  _fetchMessageImpl = fn;
}
/** @internal test only */
export function __resetFetchMessageForTest(): void {
  _fetchMessageImpl = fetchMessage;
}
/** @internal test only */
export function __resetMessageStateForTest(): void {
  stopMessagePoller();
  cachedMessage = null;
  inflightMessage = null;
  streamConnected = false;
  _pollFn = null;
  _applyResultFn = null;
  _activateFn = null;
}
/** @internal test only */
export function __isMessagePollingForTest(): boolean {
  return pollTimer !== undefined;
}
/** @internal test only */
export function __pollOnceForTest(): Promise<void> {
  return _pollFn ? _pollFn() : Promise.resolve();
}
/** @internal test only */
export function __activateForTest(): Promise<void> {
  return _activateFn ? _activateFn() : Promise.resolve();
}

async function fetchMessageWithCache(
  config: Config,
): Promise<Result<string>> {
  if (inflightMessage) return inflightMessage;
  inflightMessage = _fetchMessageImpl(config).then((r) => {
    cachedMessage = r;
    inflightMessage = null;
    return r;
  });
  return inflightMessage;
}

/** bootstrap で fire-and-forget で呼ぶ。背景で fetch して cache。 */
export function preloadMessage(config: Config): Promise<Result<string>> {
  return fetchMessageWithCache(config);
}

function startMessagePoller(): void {
  if (pollTimer !== undefined || !_pollFn) return;
  pollTimer = setInterval(() => {
    void _pollFn?.();
  }, FALLBACK_POLL_INTERVAL_MS);
}

function stopMessagePoller(): void {
  if (pollTimer !== undefined) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

/** `/events` connection state. Stop polling while connected; fetch every 60 s only while disconnected. */
export function setMessageStreamConnected(connected: boolean): void {
  streamConnected = connected;
  if (connected) {
    stopMessagePoller();
  } else {
    startMessagePoller();
  }
}

/** Receiver for `/events` `message` events. Goes through the same branch as fetch results. */
export function receiveMessageEvent(result: Result<string>): Promise<void> {
  cachedMessage = result;
  return _applyResultFn ? _applyResultFn(result) : Promise.resolve();
}

/** Fetch `/message` once (e.g. on foreground return). */
export function refreshMessageOnce(): Promise<void> {
  return _pollFn ? _pollFn() : Promise.resolve();
}

function resultToContent(result: Result<string>): string {
  if (result.ok) {
    const trimmed = result.data.replace(/\s+$/g, "");
    if (trimmed.length === 0) return CLEAR_CONTENT;
    return truncateToMaxWidth(trimmed);
  }
  // "メッセージ未配置" は運用上頻繁にあるので glass を空にする (主張弱め)。
  // fetch エラー (サーバに接続できません等) はそのまま表示する。
  if (result.error === "メッセージ未配置") {
    return CLEAR_CONTENT;
  }
  return result.error;
}

export function registerMessageLifecycle(
  bridge: EvenAppBridge,
  config: Config,
): () => void {
  let messageActive = false;
  // 現在 glass に描画済みの content (表示中のみ有効)
  let lastContent: string | null = null;
  // 最後に「ユーザーへ提示した」content。新着判定の基準 (非表示中も保持)。
  let lastSeenContent: string | null = null;

  async function applyContent(content: string): Promise<void> {
    try {
      await bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: CONTAINER_ID,
          containerName: CONTAINER_NAME,
          content,
        }),
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        "[message] textContainerUpgrade failed:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  async function applyResult(result: Result<string>): Promise<void> {
    const content = resultToContent(result);

    if (!messageActive) {
      // 非表示中: 新メッセージが来ていたら message view へ自動切替
      if (content !== CLEAR_CONTENT && content !== lastSeenContent) {
        lastSeenContent = content;
        autoSwitchTo("message");
      }
      return;
    }

    // 表示中: content が変化した時だけ再描画 (同一なら表示継続)
    if (content !== lastContent) {
      await applyContent(content);
      lastContent = content;
      lastSeenContent = content;
    }
  }

  async function refresh(): Promise<void> {
    await applyResult(await fetchMessageWithCache(config));
  }

  _pollFn = refresh;
  _applyResultFn = applyResult;

  async function activate(): Promise<void> {
    if (messageActive) return;
    messageActive = true;
    if (cachedMessage !== null) {
      const content = resultToContent(cachedMessage);
      lastContent = content;
      lastSeenContent = content;
      await applyContent(content);
      void refresh();
    } else {
      await refresh();
    }
  }

  _activateFn = activate;

  function deactivate(): void {
    messageActive = false;
    lastContent = null;
    // fallback poller / `/events` run regardless of visibility (keeps background auto-switch detection)
    // lastSeenContent はリセットしない（同じメッセージでの再切替を防ぐ）
  }

  const unsubscribe = subscribe((view: ViewName) => {
    if (view === "message") {
      void activate();
    } else {
      deactivate();
    }
  });

  // Run the fallback poller only while `/events` is disconnected (also when message is hidden)
  if (!streamConnected) {
    startMessagePoller();
  }

  if (getView() === "message") {
    void activate();
  }

  return () => {
    unsubscribe();
    deactivate();
    stopMessagePoller();
  };
}
