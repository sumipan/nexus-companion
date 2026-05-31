import { waitForEvenAppBridge } from "@evenrealities/even_hub_sdk";

async function main(): Promise<void> {
  await waitForEvenAppBridge();
}

main().catch((error: unknown) => {
  console.error("Failed to initialize nexus-companion:", error);
});
