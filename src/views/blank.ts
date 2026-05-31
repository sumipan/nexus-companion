import type { EvenAppBridge } from "@evenrealities/even_hub_sdk";

import { getView, subscribe, type ViewName } from "../state/view.ts";

/**
 * 何も表示しない View。
 *
 * 起動時の default。普段は glass に何も出さず、テンプル単タップで
 * diary → dashboard → charge → blank と循環する。
 *
 * blank に切り替わったら `shutDownPageContainer` を呼んで他 view が作った
 * container を破棄し glass を空に戻す。初回 (まだ何も create していない時点) で
 * shutdown が失敗してもアプリは継続させる。
 */
export function registerBlankLifecycle(bridge: EvenAppBridge): () => void {
  let blankActive = false;

  async function activate(): Promise<void> {
    if (blankActive) return;
    blankActive = true;
    try {
      await bridge.shutDownPageContainer();
    } catch (e) {
      // 初回起動 (まだ createStartUpPageContainer が呼ばれていない状態) で
      // shutdown を投げると失敗するが、glass は元々空なので問題ない
      // eslint-disable-next-line no-console
      console.warn(
        "[blank] shutDownPageContainer failed:",
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
