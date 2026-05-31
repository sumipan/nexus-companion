import type { Config } from "../config";
import type { Result } from "./types";

const TIMEOUT_MS = 5000;

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
  const url = `${config.ghdagUiUrl}/api/rows`;
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
