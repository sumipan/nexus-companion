import type { Config } from "../config";
import type { Result } from "./types";

const TIMEOUT_MS = 5000;

/**
 * 秘書エージェントからのメッセージ (`${NIKKI_ROOT}/message.txt`) を charge_server
 * の /message endpoint 経由で取得する。
 *
 * - 200: 本文 (text/plain UTF-8)
 * - 404: message.txt 未配置 → `Result.ok = false`, error = "メッセージ未配置"
 * - その他失敗 → "サーバに接続できません"
 */
export async function fetchMessage(config: Config): Promise<Result<string>> {
  const url = `${config.chargeServerUrl}/message`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (res.status === 404) {
      return { ok: false, error: "メッセージ未配置" };
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
