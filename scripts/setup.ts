import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const envExamplePath = resolve(projectRoot, ".env.example");
const envPath = resolve(projectRoot, ".env");

if (!existsSync(envPath)) {
  copyFileSync(envExamplePath, envPath);
  console.log("Created .env from .env.example");
} else {
  console.log(".env already exists; leaving it unchanged");
}

const build = spawnSync("pnpm", ["--silent", "build:keychain-helper"], {
  cwd: projectRoot,
  stdio: "inherit",
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

console.log("");
console.log("Fill in .env with your OMS values:");
console.log("");
console.log("  OMS_PUBLISHABLE_KEY=...");
console.log("  OMS_PROJECT_ID=...");
console.log("  OMS_WALLET_EMAIL=...");
console.log("");
console.log("Codex MCP config:");
console.log("");
console.log("[mcp_servers.oms_client_agent]");
console.log('command = "pnpm"');
console.log('args = ["--silent", "mcp"]');
console.log(`cwd = ${JSON.stringify(projectRoot)}`);
console.log("");
console.log("Verify with:");
console.log("");
console.log("  pnpm check");
console.log("  pnpm test");
console.log("  pnpm test:keychain");
