import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StorageManager } from "@0xsequence/typescript-sdk";

export class MacOSKeychainStorageManager implements StorageManager {
  constructor(private readonly serviceName: string) {
    if (serviceName.length === 0) {
      throw new Error("serviceName must not be empty");
    }
  }

  get(key: string): string | null {
    this.assertValidKey(key);

    const result = runKeychainHelper("get", this.serviceName, key);

    if (result.status === 0) {
      return trimTrailingNewline(result.stdout);
    }

    if (result.status === 2 || isNotFound(result.stderr)) {
      return null;
    }

    throw new Error(
      `Failed to read "${key}" from macOS Keychain: ${formatSecurityError(result)}`,
    );
  }

  set(key: string, value: string): void {
    this.assertValidKey(key);

    const result = runKeychainHelper("set", this.serviceName, key, value);

    if (result.status !== 0) {
      throw new Error(
        `Failed to write "${key}" to macOS Keychain: ${formatSecurityError(result)}`,
      );
    }
  }

  delete(key: string): void {
    this.assertValidKey(key);

    const result = runKeychainHelper("delete", this.serviceName, key);

    if (result.status === 0 || result.status === 2 || isNotFound(result.stderr)) {
      return;
    }

    throw new Error(
      `Failed to delete "${key}" from macOS Keychain: ${formatSecurityError(result)}`,
    );
  }

  private assertValidKey(key: string): void {
    if (key.length === 0) {
      throw new Error("key must not be empty");
    }

    if (hasControlCharacter(key)) {
      throw new Error("key must not contain control characters");
    }
  }
}

const moduleDir = dirname(fileURLToPath(import.meta.url));
const keychainHelperPath = join(moduleDir, "../../bin/keychain-helper");

function runKeychainHelper(
  operation: "get" | "set" | "delete",
  serviceName: string,
  key: string,
  input?: string,
): SpawnSyncReturns<string> {
  if (!existsSync(keychainHelperPath)) {
    throw new Error(
      `Missing Keychain helper binary at ${keychainHelperPath}. Run \`pnpm build:keychain-helper\`.`,
    );
  }

  return spawnSync(
    keychainHelperPath,
    [operation, serviceName, key],
    {
      encoding: "utf8",
      input,
      maxBuffer: 1024 * 1024,
    },
  );
}

function trimTrailingNewline(value: string): string {
  return value.replace(/\r?\n$/, "");
}

function isNotFound(stderr: string | null): boolean {
  return (
    stderr?.includes("could not be found") === true ||
    stderr?.includes("The specified item could not be found") === true
  );
}

function formatSecurityError(result: SpawnSyncReturns<string>): string {
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  const message = stderr || stdout || `keychain helper exited with status ${result.status}`;

  return message;
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32);
}
