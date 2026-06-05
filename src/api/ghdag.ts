import type { Config } from "../config";
import type { Result } from "./types";

// ghdag_ui 自体は HTTP/1.0 BaseHTTPServer + 5 秒近い応答時間で iOS WKWebView 越し
// fetch が安定しないため、charge_server (HTTP/1.1 / uvicorn) の /ghdag/rows
// プロキシ経由で取る。タイムアウトは ghdag_ui の応答実測 5 秒前後 + 余裕で 12 秒。
const TIMEOUT_MS = 12_000;

export type GhdagRow = {
  uuid: string;
  state: string;
  cmd_preview: string;
  tree_ts: string;
  engine_model: string;
};

export async function fetchGhdagRows(
  config: Config,
): Promise<Result<GhdagRow[]>> {
  const url = `${config.chargeServerUrl}/ghdag/rows?limit=40`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return { ok: false, error: "ghdag UI に接続できません" };
    }
    const data = (await res.json()) as GhdagRow[];
    return { ok: true, data };
  } catch {
    return { ok: false, error: "ghdag UI に接続できません" };
  } finally {
    clearTimeout(timer);
  }
}
