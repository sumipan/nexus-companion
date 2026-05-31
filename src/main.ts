import {
  EventSourceType,
  OsEventTypeList,
  waitForEvenAppBridge,
} from "@evenrealities/even_hub_sdk";

import { loadConfig } from "./config";
import { nextView } from "./state/view";
import { registerChargeLifecycle } from "./views/charge";
import { registerDashboardLifecycle } from "./views/dashboard";
import { initDiaryView } from "./views/diary";

async function main(): Promise<void> {
  const bridge = await waitForEvenAppBridge();
  const config = loadConfig();
  initDiaryView(bridge, config);
  registerDashboardLifecycle(config, bridge);
  registerChargeLifecycle(config, bridge);

  bridge.onEvenHubEvent((event) => {
    if (
      event.sysEvent?.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT &&
      event.sysEvent?.eventSource === EventSourceType.TOUCH_EVENT_FROM_GLASSES_R
    ) {
      nextView();
    }
  });
}

main().catch((error: unknown) => {
  console.error("Failed to initialize nexus-companion:", error);
});
