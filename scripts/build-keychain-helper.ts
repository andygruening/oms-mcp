import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

if (process.platform !== "darwin") {
  console.log("Skipping macOS Keychain helper build on non-macOS platform");
  process.exit(0);
}

const projectRoot = resolve(import.meta.dirname, "..");

mkdirSync(resolve(projectRoot, "bin"), { recursive: true });

const build = spawnSync(
  "swiftc",
  [
    "-suppress-warnings",
    "src/storage/keychain-helper.swift",
    "-o",
    "bin/keychain-helper",
  ],
  {
    cwd: projectRoot,
    stdio: "inherit",
  },
);

process.exit(build.status ?? 1);
