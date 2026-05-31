// ─────────────────────────────────────────────────────────────
// diagnostic 版 — ガラスが描画されない原因を切り分けるため、
// スマホ画面 WebView に各 step のログを表示する。次のリリースで戻す。
// ─────────────────────────────────────────────────────────────

const logBuffer: string[] = [];
let logEl: HTMLElement | null = null;

function flushLogs(): void {
  if (logEl) {
    logEl.textContent = logBuffer.join("\n");
  }
}

function log(msg: string): void {
  const stamp = new Date().toISOString().slice(11, 23);
  const line = `${stamp}  ${msg}`;
  // eslint-disable-next-line no-console
  console.log(line);
  logBuffer.push(line);
  flushLogs();
}

function setupLogEl(): void {
  if (logEl) return;
  const el = document.createElement("pre");
  el.style.cssText =
    "margin:0;padding:12px;font:13px/1.4 monospace;white-space:pre-wrap;word-break:break-all;color:#000;background:#fff";
  document.body.appendChild(el);
  logEl = el;
  flushLogs();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupLogEl);
} else {
  setupLogEl();
}

log("1: script loaded");
log(`   userAgent: ${navigator.userAgent}`);
log(`   location: ${location.href}`);
log(
  `   window keys re bridge: ${Object.keys(window)
    .filter((k) => /bridge|even|hub|webkit|app/i.test(k))
    .join(",")}`,
);

// 動的 import を避ける（vite は IIFE bundle で全部固める）
import {
  CreateStartUpPageContainer,
  EventSourceType,
  OsEventTypeList,
  TextContainerProperty,
  waitForEvenAppBridge,
} from "@evenrealities/even_hub_sdk";

import { loadConfig } from "./config";
import { dispatchTextEvent, nextView } from "./state/view";
import { preloadMessage, registerBlankLifecycle } from "./views/blank";
import {
  preloadCharge,
  preloadDashboard,
  registerDashboardLifecycle,
} from "./views/dashboard";
import { initDiaryView, preloadDiary } from "./views/diary";

log("2: imports resolved");

async function main(): Promise<void> {
  log("3: main() entered");

  // bridge 取得を 5 秒タイムアウト付きで待つ（待ち続けると永遠に止まる事故を防ぐ）
  const bridge = await Promise.race([
    waitForEvenAppBridge().then((b) => {
      log("4a: waitForEvenAppBridge resolved");
      return b;
    }),
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error("waitForEvenAppBridge timeout after 5s"));
      }, 5000);
    }),
  ]);

  log("4: bridge ready");

  const config = loadConfig();
  log(`5: config = ${JSON.stringify(config)}`);

  // ───────── event capture 用 container を起動時に 1 回 create ─────────
  // SDK の `isEventCapture: 1` を持つ container が glass 上に無いと、OS は
  // テンプル event をアプリに送らず OS デフォルト動作（ダッシュボードに戻る）に
  // 消化してしまう。blank が default の構成で create が呼ばれないと event 自体
  // 届かなくなる事象が実機で確認されたため、bootstrap で空 content の container
  // を 1 個だけ作って event capture を成立させる。
  //
  // 後続の各 view (diary / dashboard / charge) は同じ containerID=1 に対して
  // textContainerUpgrade / rebuildPageContainer で content を上書きする。
  // 既存 diary.ts も createStartUpPageContainer を呼ぶが、SDK 仕様で
  // 2 回目以降の create は戻り値 1（失敗）を返すだけで害は無く、続く
  // textContainerUpgrade は同じ container 上で動く。
  try {
    const initContainer = new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [
        new TextContainerProperty({
          containerID: 1,
          containerName: "main",
          content: "",
          isEventCapture: 1,
          xPosition: 0,
          yPosition: 0,
          width: 576,
          height: 288,
        }),
      ],
    });
    const r = await bridge.createStartUpPageContainer(initContainer);
    log(`5a: initial container created (returned: ${JSON.stringify(r)})`);
  } catch (e) {
    log(`init container failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  registerBlankLifecycle(bridge, config);
  log("5b: blank lifecycle registered (default view, shows secretary message)");

  initDiaryView(bridge, config);
  log("6: diary view registered");

  registerDashboardLifecycle(config, bridge);
  log("7: dashboard lifecycle registered (LLM usage + ghdag tasks)");

  // ───────── 各 view のデータを背景で fire-and-forget で先取り ─────────
  // タップで view が切り替わった時に fetch 完了を待たず即描画できるようにする。
  // 失敗結果も cache に入るので 1 回目の表示も即出る (古いエラー文字列だが)。
  // bridge.onEvenHubEvent の登録より前に kick して、register 中にも fetch が
  // 進むようにする。
  void preloadMessage(config);
  void preloadDiary(config);
  void preloadDashboard(config);
  void preloadCharge(config);
  log("8a: preload kicked (message / diary / dashboard / charge)");

  // 右テンプルタップ間隔のデバウンス（同一タップで複数 event が飛ぶケースに備える）
  let lastTriggerAt = 0;
  const DEBOUNCE_MS = 400;

  bridge.onEvenHubEvent((event) => {
    // event の型 / source を enum 名でデコードして log する
    const sys = event.sysEvent;
    const typeName =
      sys?.eventType !== undefined
        ? `${OsEventTypeList[sys.eventType] ?? "?"}(${sys.eventType})`
        : "(none)";
    const sourceName =
      sys?.eventSource !== undefined
        ? `${EventSourceType[sys.eventSource] ?? "?"}(${sys.eventSource})`
        : "(none)";
    const textEvt = event.textEvent ? ` text=${JSON.stringify(event.textEvent)}` : "";
    log(`event: type=${typeName} source=${sourceName}${textEvt}`);

    // 実機ログより、右テンプル シングルタップは
    //   { sysEvent: { eventSource: 1 } }  (eventType 欠落)
    // で届く。`type === CLICK_EVENT(0)` の比較は undefined===0=false で発火しないので
    // **eventSource のみ**で判定する。
    // テンプル ダブルタップは OS が握って「終了？」ダイアログを出すためアプリには
    // 届かない仕様（実機検証で確認）。代替操作として右テンプル単タップに集約する。
    if (sys?.eventSource === EventSourceType.TOUCH_EVENT_FROM_GLASSES_R) {
      const now = Date.now();
      if (now - lastTriggerAt < DEBOUNCE_MS) {
        log("→ skip (debounced)");
        return;
      }
      lastTriggerAt = now;
      log("→ nextView() trigger: right-temple touch");
      nextView();
    }

    // textEvent (SCROLL_TOP_EVENT / SCROLL_BOTTOM_EVENT etc.) は current view の
    // handler に dispatch する。bridge.onEvenHubEvent を view 内で別途登録すると
    // 競合するため、view 側は state.registerTextEventHandler() を使う。
    if (event.textEvent) {
      dispatchTextEvent(event.textEvent);
    }
  });
  log("9: event listener registered — bootstrap complete");
}

main().catch((error: unknown) => {
  const msg = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
  log(`FATAL: ${msg}`);
  // eslint-disable-next-line no-console
  console.error("Failed to initialize nexus-companion:", error);
});
