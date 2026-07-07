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
 * blank View
 *
 * 起動時の default。秘書エージェントからの一言 (`${NIKKI_ROOT}/message.txt`
 * の本文) を glass に表示する。message.txt が無い時は空白 1 文字で
 * glass をクリアするだけにとどめる (`textContainerUpgrade({content: ""})` は
 * SDK で no-op になり前 view の描画が残るため半角スペース 1 個を送る)。
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
const POLL_INTERVAL_MS = 60_000;

// preload cache
let cachedMessage: Result<string> | null = null;
let inflightMessage: Promise<Result<string>> | null = null;

// DI hook for testing
let _fetchMessageImpl: (config: Config) => Promise<Result<string>> = fetchMessage;
let _pollFn: (() => Promise<void>) | null = null;
let _activateFn: (() => Promise<void>) | null = null;
let _clearActivateGraceFn: (() => void) | null = null;

/** @internal test only */
export function __setFetchMessageForTest(fn: (config: Config) => Promise<Result<string>>): void {
  _fetchMessageImpl = fn;
}
/** @internal test only */
export function __resetFetchMessageForTest(): void {
  _fetchMessageImpl = fetchMessage;
}
/** @internal test only */
export function __resetBlankStateForTest(): void {
  cachedMessage = null;
  inflightMessage = null;
  _pollFn = null;
  _activateFn = null;
  _clearActivateGraceFn = null;
}
/** @internal test only */
export function __pollOnceForTest(): Promise<void> {
  return _pollFn ? _pollFn() : Promise.resolve();
}
/** @internal test only */
export function __activateForTest(): Promise<void> {
  return _activateFn ? _activateFn() : Promise.resolve();
}
/** @internal test only — expire the activate grace period so poll can clear */
export function __clearActivateGraceForTest(): void {
  if (_clearActivateGraceFn) _clearActivateGraceFn();
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

export function registerBlankLifecycle(
  bridge: EvenAppBridge,
  config: Config,
): () => void {
  let blankActive = false;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let lastContent: string | null = null;
  let lastSeenContent: string | null = null;
  // 「表示→クリア」されたメッセージを記憶。re-activate 時に即クリアでフラッシュを防ぐ。
  let lastClearedContent: string | null = null;
  // activate 直後の refresh で既読クリアが即発火するのを防ぐ
  const ACTIVATE_GRACE_MS = 5_000;
  let activatedAt = 0;

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
        "[blank] textContainerUpgrade failed:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  async function refresh(): Promise<void> {
    const result = await fetchMessageWithCache(config);
    const content = resultToContent(result);

    if (!blankActive) {
      // 非表示中: 新メッセージが来ていたら blank view へ自動切替
      if (content !== CLEAR_CONTENT && content !== lastSeenContent) {
        lastSeenContent = content;
        lastClearedContent = null; // 新メッセージ → クリア済み状態をリセット
        autoSwitchTo("blank");
      }
      return;
    }

    // 表示中: 前回と同じメッセージなら表示クリア（activate 直後は猶予）
    if (lastContent !== null && content === lastContent
        && Date.now() - activatedAt >= ACTIVATE_GRACE_MS) {
      await applyContent(CLEAR_CONTENT);
      lastClearedContent = content;
    } else {
      await applyContent(content);
      lastContent = content;
      lastSeenContent = content;
      lastClearedContent = null;
    }
  }

  _pollFn = refresh;
  _clearActivateGraceFn = () => { activatedAt = 0; };

  async function activate(): Promise<void> {
    if (blankActive) return;
    blankActive = true;
    activatedAt = Date.now();
    if (cachedMessage !== null) {
      const content = resultToContent(cachedMessage);
      if (content !== CLEAR_CONTENT && content === lastClearedContent) {
        // 前回表示→クリア済みの同一メッセージ → フラッシュを防いで即クリア
        await applyContent(CLEAR_CONTENT);
        lastContent = content;
      } else {
        lastContent = content;
        lastSeenContent = content;
        lastClearedContent = null;
        await applyContent(content);
      }
      void refresh();
    } else {
      await refresh();
    }
  }

  _activateFn = activate;

  function deactivate(): void {
    blankActive = false;
    lastContent = null;
    // pollTimer は常時稼働のため止めない（背景での自動切替検出を継続）
    // lastSeenContent はリセットしない（同じメッセージでの再切替を防ぐ）
  }

  const unsubscribe = subscribe((view: ViewName) => {
    if (view === "blank") {
      void activate();
    } else {
      deactivate();
    }
  });

  // 常時稼働のバックグラウンドポーラー（blank 非表示時も動作）
  pollTimer = setInterval(() => {
    void refresh();
  }, POLL_INTERVAL_MS);

  if (getView() === "blank") {
    void activate();
  }

  return () => {
    unsubscribe();
    deactivate();
    if (pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };
}
