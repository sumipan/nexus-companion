import {
  TextContainerUpgrade,
  type EvenAppBridge,
} from "@evenrealities/even_hub_sdk";

import { fetchMessage } from "../api/message.ts";
import type { Result } from "../api/types.ts";
import type { Config } from "../config.ts";
import { getView, subscribe, type ViewName } from "../state/view.ts";
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
    if (!blankActive) return;
    const content = resultToContent(result);
    if (lastContent !== null && content === lastContent) {
      // 前回と同じメッセージ → 表示クリア
      await applyContent(CLEAR_CONTENT);
    } else {
      await applyContent(content);
      lastContent = content;
    }
  }

  _pollFn = refresh;

  async function activate(): Promise<void> {
    if (blankActive) return;
    blankActive = true;
    // cache hit があれば即描画
    if (cachedMessage !== null) {
      const content = resultToContent(cachedMessage);
      lastContent = content;
      await applyContent(content);
      // 背景で最新化
      void refresh();
    } else {
      await refresh();
    }
    pollTimer = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
  }

  _activateFn = activate;

  function deactivate(): void {
    blankActive = false;
    lastContent = null;
    if (pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  }

  const unsubscribe = subscribe((view: ViewName) => {
    if (view === "blank") {
      void activate();
    } else {
      deactivate();
    }
  });

  if (getView() === "blank") {
    void activate();
  }

  return () => {
    unsubscribe();
    deactivate();
  };
}
