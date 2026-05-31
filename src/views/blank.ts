import type { EvenAppBridge } from "@evenrealities/even_hub_sdk";

import { getView, subscribe, type ViewName } from "../state/view.ts";

/**
 * 何も表示しない View。
 *
 * 起動時の default。普段は glass に何も出さず、テンプル単タップで
 * diary → dashboard → charge → blank と循環する。
 *
 * 実装メモ:
 * - v0.1.6 で blank activate 時に `bridge.shutDownPageContainer()` を呼んだら
 *   bridge の event 流入自体が止まり、その後の単タップが届かなくなる事象が実機で
 *   確認された。SDK の `shutDownPageContainer(exitMode?)` は名前通り「アプリ
 *   終了系」の API で container だけを削除するわけではなさそう。
 * - 起動時の glass は元々何も描画されていない状態 (createStartUpPageContainer
 *   未呼出) なので、blank が default なら**何もしないだけで glass は空**。
 * - 別 view からの戻りで blank に来た場合は、現状 glass に前 view の内容が
 *   残るが、`rebuildPageContainer` 経由で content="" を流す対応は v0.2.0 で
 *   create→rebuild 統一と合わせて行う。
 */
export function registerBlankLifecycle(_bridge: EvenAppBridge): () => void {
  const unsubscribe = subscribe((_view: ViewName) => {
    // 何もしない。bridge を握って終了系 API を呼ぶ実装はやらない。
  });

  // 初回起動 (`getView() === "blank"`) でも何もしない: container が未作成なので
  // glass は元から空。これで右テンプル単タップが届くまで bridge は生きたまま。
  void getView;

  return unsubscribe;
}
