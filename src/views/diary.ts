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
          content: "",
          isEventCapture: 1,
        }),
      ],
    });
    await bridge.createStartUpPageContainer(container);
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
    unsubscribeEvents = bridge.onEvenHubEvent((event) => {
      if (event.textEvent) {
        handleTextEvent(event.textEvent);
      }
    });
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
