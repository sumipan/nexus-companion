import { waitForEvenAppBridge } from "@evenrealities/even_hub_sdk";

import { loadConfig } from "./config";

async function main(): Promise<void> {
  await waitForEvenAppBridge();
  const config = loadConfig();
  // config.chargeServerUrl, config.ghdagUiUrl を以降の処理で使用
  void config.chargeServerUrl;
  void config.ghdagUiUrl;
}

main().catch((error: unknown) => {
  console.error("Failed to initialize nexus-companion:", error);
});
