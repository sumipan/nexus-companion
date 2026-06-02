import {
  OsEventTypeList,
  TextContainerUpgrade,
  type EvenAppBridge,
  type Text_ItemEvent,
} from "@evenrealities/even_hub_sdk";

import { fetchTasks } from "../api/tasks.ts";
import type { Result } from "../api/types.ts";
import type { Config } from "../config.ts";
import { getCachedTasks } from "../state/dataWatcher.ts";
import {
  getView,
  registerTextEventHandler,
  subscribe,
} from "../state/view.ts";

export const LINES_PER_PAGE = 10;

const CONTAINER_ID = 1;
const CONTAINER_NAME = "main";
const POLL_INTERVAL_MS = 60_000;

let cachedTasksResult: Result<string> | null = null;
let inflightTasks: Promise<Result<string>> | null = null;

async function fetchTasksWithCache(config: Config): Promise<Result<string>> {
  if (inflightTasks) return inflightTasks;
  inflightTasks = fetchTasks(config).then((r) => {
    cachedTasksResult = r;
    inflightTasks = null;
    return r;
  });
  return inflightTasks;
}

export function preloadTasks(config: Config): Promise<Result<string>> {
  // Check dataWatcher cache first
  const watcherCache = getCachedTasks();
  if (watcherCache !== null && cachedTasksResult === null) {
    cachedTasksResult = { ok: true, data: watcherCache };
  }
  return fetchTasksWithCache(config);
}

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

export function initTasksView(bridge: EvenAppBridge, config: Config): () => void {
  let pageIndex = 0;
  let pages: string[] = [""];
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let unsubscribeEvents: (() => void) | undefined;
  let tasksActive = false;

  async function displayPage(): Promise<void> {
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: CONTAINER_ID,
        containerName: CONTAINER_NAME,
        content: pages[pageIndex] ?? "",
      }),
    );
  }

  function applyResultToPages(result: Result<string>): void {
    if (result.ok) {
      pages = paginate(result.data);
    } else {
      pages = [result.error];
    }
    if (pageIndex >= pages.length) {
      pageIndex = Math.max(0, pages.length - 1);
    }
  }

  async function loadAndDisplay(): Promise<void> {
    const result = await fetchTasksWithCache(config);
    applyResultToPages(result);
    await displayPage();
  }

  function handleTextEvent(event: Text_ItemEvent): void {
    if (event.containerID !== CONTAINER_ID) {
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

  async function activateTasks(): Promise<void> {
    if (tasksActive) return;
    tasksActive = true;
    pageIndex = 0;
    if (cachedTasksResult !== null) {
      applyResultToPages(cachedTasksResult);
      await displayPage();
      void fetchTasksWithCache(config).then((latest) => {
        if (!tasksActive) return;
        applyResultToPages(latest);
        void displayPage();
      });
    } else {
      await loadAndDisplay();
    }
    pollTimer = setInterval(() => {
      void loadAndDisplay();
    }, POLL_INTERVAL_MS);
    unsubscribeEvents = registerTextEventHandler("tasks", handleTextEvent);
  }

  async function deactivateTasks(): Promise<void> {
    if (!tasksActive) return;
    tasksActive = false;
    if (pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
    if (unsubscribeEvents) {
      unsubscribeEvents();
      unsubscribeEvents = undefined;
    }
  }

  const unsubscribeView = subscribe((view) => {
    if (view === "tasks") {
      void activateTasks();
    } else {
      void deactivateTasks();
    }
  });

  if (getView() === "tasks") {
    void activateTasks();
  }

  return () => {
    unsubscribeView();
    void deactivateTasks();
  };
}
