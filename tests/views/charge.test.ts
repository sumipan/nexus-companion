import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import type { ChargeData } from "../../src/api/charge.ts";
import type { Config } from "../../src/config.ts";
import { nextView } from "../../src/state/view.ts";

function parseHexColor(color: string): [number, number, number, number] {
  if (color === "#FFFFFF") {
    return [255, 255, 255, 255];
  }
  if (color === "#000000") {
    return [0, 0, 0, 255];
  }
  if (color === "#E0E0E0") {
    return [224, 224, 224, 255];
  }
  if (color === "#4A90D9") {
    return [74, 144, 217, 255];
  }
  if (color === "#5CB85C") {
    return [92, 184, 92, 255];
  }
  return [0, 0, 0, 255];
}

class TestOffscreenCanvas {
  #data: Uint8ClampedArray;
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.#data = new Uint8ClampedArray(width * height * 4);
  }

  getContext(type: string): OffscreenCanvasRenderingContext2D | null {
    if (type !== "2d") {
      return null;
    }

    const data = this.#data;
    const width = this.width;
    const height = this.height;
    let fillStyle = "#000000";

    return {
      fillStyle,
      font: "12px sans-serif",
      set fillStyle(value: string) {
        fillStyle = value;
      },
      get fillStyle() {
        return fillStyle;
      },
      fillRect(x: number, y: number, w: number, h: number): void {
        const [r, g, b, a] = parseHexColor(fillStyle);
        for (let py = y; py < y + h; py += 1) {
          for (let px = x; px < x + w; px += 1) {
            if (px < 0 || py < 0 || px >= width || py >= height) {
              continue;
            }
            const index = (py * width + px) * 4;
            data[index] = r;
            data[index + 1] = g;
            data[index + 2] = b;
            data[index + 3] = a;
          }
        }
      },
      fillText(text: string, x: number, y: number): void {
        const [r, g, b, a] = parseHexColor(fillStyle);
        for (let i = 0; i < text.length; i += 1) {
          const px = x + i * 6;
          const py = y - 10;
          for (let dy = 0; dy < 10; dy += 1) {
            for (let dx = 0; dx < 5; dx += 1) {
              const drawX = px + dx;
              const drawY = py + dy;
              if (drawX < 0 || drawY < 0 || drawX >= width || drawY >= height) {
                continue;
              }
              const index = (drawY * width + drawX) * 4;
              data[index] = r;
              data[index + 1] = g;
              data[index + 2] = b;
              data[index + 3] = a;
            }
          }
        }
      },
      getImageData(
        _sx: number,
        _sy: number,
        sw: number,
        sh: number,
      ): ImageData {
        return { data, width: sw, height: sh } as ImageData;
      },
    } as OffscreenCanvasRenderingContext2D;
  }
}

(globalThis as unknown as { OffscreenCanvas: typeof OffscreenCanvas }).OffscreenCanvas =
  TestOffscreenCanvas as unknown as typeof OffscreenCanvas;

const {
  __getPollTimerForTest,
  __pollOnceForTest,
  __resetChargeStateForTest,
  __resetFetchChargeForTest,
  __setFetchChargeForTest,
  extractMetrics,
  registerChargeLifecycle,
  renderChargeBar,
  renderErrorImage,
  startCharge,
  stopCharge,
} = await import("../../src/views/charge.ts");

const CONFIG: Config = {
  chargeServerUrl: "http://localhost:8088",
  ghdagUiUrl: "http://localhost:8080",
};

const POLL_MS = 30_000;
const IMAGE_PIXELS = 200 * 100 * 4;

const CHARGE_DATA: ChargeData = {
  updated_at: "2026-05-31T00:00:00Z",
  claude: {
    weekly: { used_percent: 75, reset_at: "2026-06-01T00:00:00Z" },
    session_5h: { used_percent: 10, reset_at: "2026-05-31T05:00:00Z" },
  },
  cursor: {
    monthly: {
      total_percent: 30,
      auto_percent: 20,
      api_percent: 10,
      reset_at: "2026-06-01T00:00:00Z",
    },
  },
};

type FetchResult =
  | { ok: true; data: ChargeData }
  | { ok: false; error: string };

let fetchResults: FetchResult[] = [];
let createContainerCalls = 0;
let updateImageCalls: number[][] = [];
let shutDownCalls = 0;

const mockBridge = {
  createStartUpPageContainer: async () => {
    createContainerCalls += 1;
    return 0;
  },
  updateImageRawData: async (data: { imageData?: number[] }) => {
    updateImageCalls.push(data.imageData ?? []);
    return 0;
  },
  shutDownPageContainer: async () => {
    shutDownCalls += 1;
    return true;
  },
};

function nextFetchResult(): FetchResult {
  const next = fetchResults.shift();
  if (!next) {
    return { ok: true, data: CHARGE_DATA };
  }
  return next;
}

describe("charge view", () => {
  beforeEach(() => {
    fetchResults = [];
    createContainerCalls = 0;
    updateImageCalls = [];
    shutDownCalls = 0;
    __setFetchChargeForTest(async () => nextFetchResult());
  });

  afterEach(() => {
    __resetChargeStateForTest();
    __resetFetchChargeForTest();
    mock.timers.reset();
  });

  it("extractMetrics reads Claude weekly and Cursor monthly percentages", () => {
    assert.deepEqual(extractMetrics(CHARGE_DATA), {
      claudePercent: 75,
      cursorPercent: 30,
    });
  });

  it("renderChargeBar returns RGBA pixel data with expected length", () => {
    const imageData = renderChargeBar(75, 30);
    assert.equal(imageData.length, IMAGE_PIXELS);
    assert.ok(imageData.some((value) => value !== 0));
  });

  it("renderErrorImage returns non-empty pixel data", () => {
    const imageData = renderErrorImage("進捗データ取得失敗");
    assert.equal(imageData.length, IMAGE_PIXELS);
    assert.ok(imageData.some((value) => value !== 0));
  });

  it("startCharge creates container, draws immediately, and polls every 30 seconds", async () => {
    mock.timers.enable({ apis: ["setInterval"] });
    fetchResults = [
      { ok: true, data: CHARGE_DATA },
      {
        ok: true,
        data: {
          ...CHARGE_DATA,
          claude: {
            ...CHARGE_DATA.claude,
            weekly: { used_percent: 80, reset_at: "2026-06-01T00:00:00Z" },
          },
        },
      },
    ];

    startCharge(CONFIG, mockBridge as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(createContainerCalls, 1);
    assert.equal(updateImageCalls.length, 1);
    assert.equal(updateImageCalls[0]?.length, IMAGE_PIXELS);

    mock.timers.tick(POLL_MS);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(updateImageCalls.length, 2);
    stopCharge();
  });

  it("stopCharge clears polling and shuts down the page container", async () => {
    mock.timers.enable({ apis: ["setInterval"] });
    fetchResults = [{ ok: true, data: CHARGE_DATA }];

    startCharge(CONFIG, mockBridge as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    stopCharge();

    assert.equal(__getPollTimerForTest(), null);
    assert.equal(shutDownCalls, 1);

    mock.timers.tick(POLL_MS);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(updateImageCalls.length, 1);
  });

  it("draws an error image when fetchCharge fails", async () => {
    fetchResults = [{ ok: false, error: "進捗データ取得失敗" }];

    startCharge(CONFIG, mockBridge as never);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(updateImageCalls.length, 1);
    assert.equal(updateImageCalls[0]?.length, IMAGE_PIXELS);
    assert.notDeepEqual(updateImageCalls[0], renderChargeBar(0, 0));
    stopCharge();
  });

  it("updates image on charge view and stops polling on other views", async () => {
    fetchResults = [
      { ok: true, data: CHARGE_DATA },
      { ok: true, data: CHARGE_DATA },
    ];

    const unsubscribe = registerChargeLifecycle(CONFIG, mockBridge as never);
    assert.equal(__getPollTimerForTest(), null);

    nextView();
    assert.equal(__getPollTimerForTest(), null);

    nextView();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.notEqual(__getPollTimerForTest(), null);
    assert.equal(createContainerCalls, 1);
    assert.equal(updateImageCalls.length, 1);

    nextView();
    assert.equal(__getPollTimerForTest(), null);
    assert.equal(shutDownCalls, 1);

    await __pollOnceForTest();
    assert.equal(updateImageCalls.length, 1);

    unsubscribe();
    stopCharge();
  });
});
