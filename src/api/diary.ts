import type { Config } from "../config";
import type { Result } from "./types";

const TIMEOUT_MS = 5000;

export async function fetchDiary(config: Config): Promise<Result<string>> {
  const url = `${config.chargeServerUrl}/diary/today`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (res.status === 404) {
      return { ok: false, error: "日記がまだありません" };
    }
    if (!res.ok) {
      return { ok: false, error: "サーバに接続できません" };
    }
    const body = await res.text();
    return { ok: true, data: body };
  } catch {
    return { ok: false, error: "サーバに接続できません" };
  } finally {
    clearTimeout(timer);
  }
}
