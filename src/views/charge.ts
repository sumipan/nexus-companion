import {
  CreateStartUpPageContainer,
  EvenAppBridge,
  ImageContainerProperty,
  ImageRawDataUpdate,
} from "@evenrealities/even_hub_sdk";

import {
  fetchCharge as defaultFetchCharge,
  type ChargeData,
} from "../api/charge.ts";
import type { Result } from "../api/types.ts";
import type { Config } from "../config.ts";
import { subscribe, type ViewName } from "../state/view.ts";

const IMAGE_WIDTH = 200;
const IMAGE_HEIGHT = 100;
const IMAGE_CONTAINER_ID = 1;
const POLL_INTERVAL_MS = 30_000;
const ERROR_MESSAGE = "進捗データ取得失敗";

type FetchCharge = (config: Config) => Promise<Result<ChargeData>>;

let fetchCharge: FetchCharge = defaultFetchCharge;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let activeConfig: Config | null = null;
let activeBridge: EvenAppBridge | null = null;
let containerCreated = false;

export function extractMetrics(
  data: ChargeData,
): { claudePercent: number; cursorPercent: number } {
  return {
    claudePercent: data.claude.weekly.used_percent,
    cursorPercent: data.cursor.monthly.total_percent,
  };
}

function drawBar(
  ctx: OffscreenCanvasRenderingContext2D,
  y: number,
  percent: number,
  color: string,
  label: string,
): void {
  const barHeight = 40;
  const barWidth = IMAGE_WIDTH - 10;
  const x = 5;

  ctx.fillStyle = "#E0E0E0";
  ctx.fillRect(x, y, barWidth, barHeight);

  const fillWidth = Math.round((barWidth * Math.max(0, Math.min(100, percent))) / 100);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, fillWidth, barHeight);

  ctx.fillStyle = "#000000";
  ctx.font = "12px sans-serif";
  ctx.fillText(`${label} ${percent}%`, x + 4, y + 24);
}

function renderImage(
  draw: (ctx: OffscreenCanvasRenderingContext2D) => void,
): number[] {
  const canvas = new OffscreenCanvas(IMAGE_WIDTH, IMAGE_HEIGHT);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2d context unavailable");
  }
  draw(ctx);
  return Array.from(ctx.getImageData(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT).data);
}

export function renderChargeBar(
  claudePercent: number,
  cursorPercent: number,
): number[] {
  return renderImage((ctx) => {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
    drawBar(ctx, 5, claudePercent, "#4A90D9", "Claude");
    drawBar(ctx, 55, cursorPercent, "#5CB85C", "Cursor");
  });
}

export function renderErrorImage(message: string = ERROR_MESSAGE): number[] {
  return renderImage((ctx) => {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
    ctx.fillStyle = "#000000";
    ctx.font = "14px sans-serif";
    ctx.fillText(message, 10, 50);
  });
}

async function createContainer(bridge: EvenAppBridge): Promise<void> {
  const container = new CreateStartUpPageContainer({
    containerTotalNum: 1,
    imageObject: [
      new ImageContainerProperty({
        containerID: IMAGE_CONTAINER_ID,
        width: IMAGE_WIDTH,
        height: IMAGE_HEIGHT,
        xPosition: 0,
        yPosition: 0,
      }),
    ],
  });
  await bridge.createStartUpPageContainer(container);
  containerCreated = true;
}

async function updateImage(
  bridge: EvenAppBridge,
  imageData: number[],
): Promise<void> {
  await bridge.updateImageRawData(
    new ImageRawDataUpdate({
      containerID: IMAGE_CONTAINER_ID,
      imageData,
    }),
  );
}

async function pollOnce(): Promise<void> {
  if (!activeConfig || !activeBridge) {
    return;
  }

  const result = await fetchCharge(activeConfig);
  let imageData: number[];
  if (result.ok) {
    const { claudePercent, cursorPercent } = extractMetrics(result.data);
    imageData = renderChargeBar(claudePercent, cursorPercent);
  } else {
    imageData = renderErrorImage(result.error);
  }

  await updateImage(activeBridge, imageData);
}

export function startCharge(config: Config, bridge: EvenAppBridge): void {
  stopCharge();
  activeConfig = config;
  activeBridge = bridge;

  void (async () => {
    await createContainer(bridge);
    await pollOnce();
  })();

  pollTimer = setInterval(() => {
    void pollOnce();
  }, POLL_INTERVAL_MS);
}

export function stopCharge(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  const bridge = activeBridge;
  activeConfig = null;
  activeBridge = null;

  if (bridge !== null && containerCreated) {
    containerCreated = false;
    void bridge.shutDownPageContainer();
  }
}

export function registerChargeLifecycle(
  config: Config,
  bridge: EvenAppBridge,
): () => void {
  const onViewChange = (view: ViewName): void => {
    if (view === "charge") {
      startCharge(config, bridge);
    } else {
      stopCharge();
    }
  };

  return subscribe(onViewChange);
}

export function __resetChargeStateForTest(): void {
  stopCharge();
  containerCreated = false;
}

export function __getPollTimerForTest(): ReturnType<typeof setInterval> | null {
  return pollTimer;
}

export function __setFetchChargeForTest(fetchFn: FetchCharge): void {
  fetchCharge = fetchFn;
}

export function __resetFetchChargeForTest(): void {
  fetchCharge = defaultFetchCharge;
}

export async function __pollOnceForTest(): Promise<void> {
  await pollOnce();
}
