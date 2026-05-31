import {
  TextContainerUpgrade,
  type EvenAppBridge,
} from "@evenrealities/even_hub_sdk";

import { getView, subscribe, type ViewName } from "../state/view.ts";

/**
 * 何も表示しない View。
 *
 * 起動時の default。普段は glass に何も出さず、テンプル単タップで
 * diary → dashboard → blank と循環する（charge は v0.2.0 で再投入予定）。
 *
 * 実装メモ:
 * - v0.1.6 で blank activate 時に `bridge.shutDownPageContainer()` を呼んだら
 *   bridge の event 流入自体が止まる事象が実機で確認された。
 *   `shutDownPageContainer(exitMode?)` はアプリ終了系の API なので呼ばない。
 * - 別 view からの戻りで blank に来た場合は、glass に前 view の内容が残ってしまう
 *   ので `textContainerUpgrade({content: ""})` を呼んで空に上書きする。bootstrap
 *   で立てた containerID=1 / isEventCapture=1 の container を再利用するので
 *   event capture も維持される。
 * - 初回起動 (getView() === "blank") でも同じ `textContainerUpgrade` を呼ぶ。
 *   bootstrap の create container は初期 content="" だが、明示的に上書きしておく
 *   ことで「blank == 空 content」の不変条件を強化する。
 */
export function registerBlankLifecycle(bridge: EvenAppBridge): () => void {
  let blankActive = false;

  async function activate(): Promise<void> {
    if (blankActive) return;
    blankActive = true;
    try {
      // content: "" (空文字列) を送ると SDK で no-op 扱いになり前 view の glass
      // 描画が残ってしまう。半角スペース 1 個を送ることで「空白の更新」を確実に
      // 投げて glass を実質クリアする。
      await bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: 1,
          containerName: "main",
          content: " ",
        }),
      );
    } catch (e) {
      // textContainerUpgrade が失敗しても (container 未作成等)、アプリは継続
      // eslint-disable-next-line no-console
      console.warn(
        "[blank] textContainerUpgrade failed:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  function deactivate(): void {
    blankActive = false;
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

  return unsubscribe;
}
