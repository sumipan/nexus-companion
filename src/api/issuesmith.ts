import type { Config } from "../config";
import type { Result } from "./types";

const TIMEOUT_MS = 5000;

export type QueueActiveItem = {
  request_id: string;
  issue: number;
  phase: "draft" | "sub" | "develop" | "merge";
  priority: "high" | "normal" | "low";
  source: string;
  requested_at: string;
};

export type QueueInFlightItem = {
  issue: number;
  engine: string;
};

export type QueueEngineState = {
  status: string;
  reason: string | null;
  resume_at: string | null;
};

export type QueueData = {
  updated_at: string;
  halt: boolean;
  halt_reason: string | null;
  last_issue: number | null;
  serial: boolean;
  in_flight: QueueInFlightItem[];
  limits: Record<string, number>;
  active: QueueActiveItem[];
  engines: Record<string, QueueEngineState>;
};

export async function fetchIssuesmithQueue(
  config: Config,
): Promise<Result<QueueData>> {
  const url = `${config.chargeServerUrl}/issuesmith/queue`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return { ok: false, error: "issuesmith queue 取得失敗" };
    }
    const data = (await res.json()) as QueueData;
    return { ok: true, data };
  } catch {
    return { ok: false, error: "issuesmith queue 取得失敗" };
  } finally {
    clearTimeout(timer);
  }
}
