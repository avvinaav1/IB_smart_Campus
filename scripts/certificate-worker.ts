import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

async function main() {
  // Load after .env.local, before any module reads configuration constants.
  const { runWorker } = await import("../lib/certificates/worker");
  await runWorker(process.argv.includes("--once"));
}
main().catch(() => { console.error("Certificate worker stopped. Check Firebase credentials, indexes, fonts and SMTP configuration."); process.exitCode = 1; });
