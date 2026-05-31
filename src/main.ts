import { waitForEvenAppBridge } from "@evenrealities/even_hub_sdk";

import { loadConfig } from "./config";
import { registerChargeLifecycle } from "./views/charge";
import { initDiaryView } from "./views/diary";

async function main(): Promise<void> {
  const bridge = await waitForEvenAppBridge();
  const config = loadConfig();
  initDiaryView(bridge, config);
  registerChargeLifecycle(config, bridge);
}

main().catch((error: unknown) => {
  console.error("Failed to initialize nexus-companion:", error);
});
