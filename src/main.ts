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
  EventSourceType,
  OsEventTypeList,
  waitForEvenAppBridge,
} from "@evenrealities/even_hub_sdk";

import { loadConfig } from "./config";
import { nextView } from "./state/view";
import { registerBlankLifecycle } from "./views/blank";
import { registerChargeLifecycle } from "./views/charge";
import { registerDashboardLifecycle } from "./views/dashboard";
import { initDiaryView } from "./views/diary";

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

  registerBlankLifecycle(bridge);
  log("5b: blank lifecycle registered (default view)");

  initDiaryView(bridge, config);
  log("6: diary view registered");

  registerDashboardLifecycle(config, bridge);
  log("7: dashboard lifecycle registered");

  registerChargeLifecycle(config, bridge);
  log("8: charge lifecycle registered");

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
  });
  log("9: event listener registered — bootstrap complete");
}

main().catch((error: unknown) => {
  const msg = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
  log(`FATAL: ${msg}`);
  // eslint-disable-next-line no-console
  console.error("Failed to initialize nexus-companion:", error);
});
