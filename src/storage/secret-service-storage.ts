import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import type { StorageManager } from "@0xsequence/typescript-sdk";

export class LinuxSecretServiceStorageManager implements StorageManager {
  constructor(private readonly serviceName: string) {
    if (serviceName.length === 0) {
      throw new Error("serviceName must not be empty");
    }
  }

  get(key: string): string | null {
    this.assertValidKey(key);

    const result = runSecretTool("lookup", this.serviceName, key);

    if (result.status === 0) {
      return trimTrailingNewline(result.stdout);
    }

    if (result.status === 1 && isMissingSecret(result.stderr)) {
      return null;
    }

    throw new Error(
      `Failed to read "${key}" from Linux Secret Service: ${formatSecretToolError(result)}`,
    );
  }

  set(key: string, value: string): void {
    this.assertValidKey(key);

    const result = runSecretTool("store", this.serviceName, key, value);

    if (result.status !== 0) {
      throw new Error(
        `Failed to write "${key}" to Linux Secret Service: ${formatSecretToolError(result)}`,
      );
    }
  }

  delete(key: string): void {
    this.assertValidKey(key);

    const result = runSecretTool("clear", this.serviceName, key);

    if (result.status === 0 || (result.status === 1 && isMissingSecret(result.stderr))) {
      return;
    }

    throw new Error(
      `Failed to delete "${key}" from Linux Secret Service: ${formatSecretToolError(result)}`,
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

function runSecretTool(
  operation: "lookup" | "store" | "clear",
  serviceName: string,
  key: string,
  input?: string,
): SpawnSyncReturns<string> {
  const args =
    operation === "store"
      ? [
          "store",
          "--label",
          `OMS MCP ${serviceName}`,
          "service",
          serviceName,
          "key",
          key,
        ]
      : [operation, "service", serviceName, "key", key];

  return spawnSync("secret-tool", args, {
    encoding: "utf8",
    input,
    maxBuffer: 1024 * 1024,
  });
}

function trimTrailingNewline(value: string): string {
  return value.replace(/\r?\n$/, "");
}

function isMissingSecret(stderr: string | null): boolean {
  const message = stderr?.toLowerCase() ?? "";
  return message.length === 0 || message.includes("no such secret");
}

function formatSecretToolError(result: SpawnSyncReturns<string>): string {
  if (result.error) {
    if (isEnoent(result.error)) {
      return "missing secret-tool. Install libsecret-tools and ensure a Secret Service provider such as GNOME Keyring or KWallet is available.";
    }

    return result.error.message;
  }

  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  const message = stderr || stdout || `secret-tool exited with status ${result.status}`;

  return message;
}

function isEnoent(error: Error): boolean {
  return "code" in error && error.code === "ENOENT";
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32);
}
