import {
  CreateStartUpPageContainer,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  type EvenAppBridge,
  type Text_ItemEvent,
} from "@evenrealities/even_hub_sdk";

import { fetchDiary } from "../api/diary.ts";
import type { Config } from "../config.ts";
import { getView, subscribe } from "../state/view.ts";

export const LINES_PER_PAGE = 10;

const DIARY_CONTAINER_ID = 1;
const DIARY_CONTAINER_NAME = "diary";
const POLL_INTERVAL_MS = 60_000;

export function paginate(text: string): string[] {
  if (text === "") {
    return [""];
  }
  const lines = text.split("\n");
  const pages: string[] = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
    pages.push(lines.slice(i, i + LINES_PER_PAGE).join("\n"));
  }
  return pages;
}

export function initDiaryView(bridge: EvenAppBridge, config: Config): () => void {
  let pageIndex = 0;
  let pages: string[] = [""];
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let unsubscribeEvents: (() => void) | undefined;
  let diaryActive = false;

  async function createContainer(): Promise<void> {
    const container = new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [
        new TextContainerProperty({
          containerID: DIARY_CONTAINER_ID,
          containerName: DIARY_CONTAINER_NAME,
          // 空文字列だとガラスに何も描画されない可能性があるので初期 content を入れる
          content: "loading...",
          isEventCapture: 1,
          // glasses display は 576x288 px。288x144 だと画面左上 1/4 しか
          // 使えず日記本文ですぐスクロールが要る。フルスクリーンに広げて
          // paginate(LINES_PER_PAGE=10) と協調させる。
          xPosition: 0,
          yPosition: 0,
          width: 576,
          height: 288,
        }),
      ],
    });
    const result = await bridge.createStartUpPageContainer(container);
    // 描画されない原因切り分けのため戻り値を console に流す（diagnostic build の
    // main.ts が WebView に表示する分岐とは別経路、simulator の /api/console でも見える）
    // eslint-disable-next-line no-console
    console.log(`[diary] createStartUpPageContainer returned: ${JSON.stringify(result)}`);
  }

  async function displayPage(): Promise<void> {
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: DIARY_CONTAINER_ID,
        containerName: DIARY_CONTAINER_NAME,
        content: pages[pageIndex] ?? "",
      }),
    );
  }

  async function loadAndDisplay(): Promise<void> {
    const result = await fetchDiary(config);
    if (result.ok) {
      pages = paginate(result.data);
    } else {
      pages = [result.error];
    }
    if (pageIndex >= pages.length) {
      pageIndex = Math.max(0, pages.length - 1);
    }
    await displayPage();
  }

  function handleTextEvent(event: Text_ItemEvent): void {
    if (event.containerID !== DIARY_CONTAINER_ID) {
      return;
    }
    if (event.eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      if (pageIndex < pages.length - 1) {
        pageIndex += 1;
        void displayPage();
      }
    } else if (event.eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
      if (pageIndex > 0) {
        pageIndex -= 1;
        void displayPage();
      }
    }
  }

  async function activateDiary(): Promise<void> {
    if (diaryActive) {
      return;
    }
    diaryActive = true;
    pageIndex = 0;
    await createContainer();
    await loadAndDisplay();
    pollTimer = setInterval(() => {
      void loadAndDisplay();
    }, POLL_INTERVAL_MS);
    // v0.1.10 で実機検証したところ、ここで bridge.onEvenHubEvent を別途登録すると
    // main.ts 側で登録した TOUCH event リスナーが上書きされて view 切替が止まる
    // 事象が確認された (SDK の onEvenHubEvent は後勝ち / 単一 listener 仕様の模様)。
    // → diary 内の textEvent ハンドリング (ページスクロール) は v0.2.0 で main.ts
    //    から dispatch する設計に変えるまで一時的に無効化する。
    //
    // unsubscribeEvents = bridge.onEvenHubEvent((event) => {
    //   if (event.textEvent) {
    //     handleTextEvent(event.textEvent);
    //   }
    // });
  }

  async function deactivateDiary(): Promise<void> {
    if (!diaryActive) {
      return;
    }
    diaryActive = false;
    if (pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
    if (unsubscribeEvents) {
      unsubscribeEvents();
      unsubscribeEvents = undefined;
    }
    await bridge.shutDownPageContainer();
  }

  const unsubscribeView = subscribe((view) => {
    if (view === "diary") {
      void activateDiary();
    } else {
      void deactivateDiary();
    }
  });

  if (getView() === "diary") {
    void activateDiary();
  }

  return () => {
    unsubscribeView();
    void deactivateDiary();
  };
}
