import type { Config } from "../config";
import type { Result } from "./types";

const TIMEOUT_MS = 5000;

export type ChargeData = {
  updated_at: string;
  claude: {
    weekly: { used_percent: number; reset_at: string };
    session_5h: { used_percent: number; reset_at: string };
  };
  cursor: {
    monthly: {
      total_percent: number;
      auto_percent: number;
      api_percent: number;
      reset_at: string;
    };
  };
};

export async function fetchCharge(config: Config): Promise<Result<ChargeData>> {
  const url = `${config.chargeServerUrl}/usage-data.json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return { ok: false, error: "進捗データ取得失敗" };
    }
    const data = (await res.json()) as ChargeData;
    return { ok: true, data };
  } catch {
    return { ok: false, error: "進捗データ取得失敗" };
  } finally {
    clearTimeout(timer);
  }
}
