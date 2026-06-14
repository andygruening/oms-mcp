import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import test from "node:test";

import { envStatus, runTool, tools } from "../src/mcp-server";

test("exports the expected MCP tools", () => {
  assert.deepEqual(
    tools.map((tool) => tool.name),
    [
      "oms_env_status",
      "oms_session_status",
      "oms_start_email_auth",
      "oms_complete_email_auth",
      "oms_sign_message",
      "oms_get_token_balances",
      "oms_get_native_token_balance",
      "oms_send_erc20_token",
      "oms_send_native_token",
      "oms_sign_out",
    ],
  );
});

test("tools expose object input schemas", () => {
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, "object", tool.name);
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
  }
});

test("oms_env_status reports booleans without exposing values", async () => {
  const result = await runTool("oms_env_status", {});

  assert.deepEqual(result, envStatus());
  assert.deepEqual(Object.keys(result as Record<string, boolean>).sort(), [
    "OMS_PROJECT_ID",
    "OMS_PUBLISHABLE_KEY",
  ]);
  assert.equal(typeof (result as Record<string, boolean>).OMS_PUBLISHABLE_KEY, "boolean");
  assert.equal(typeof (result as Record<string, boolean>).OMS_PROJECT_ID, "boolean");
});

test("unknown tools fail before touching the OMS client", async () => {
  await assert.rejects(
    () => runTool("missing_tool", {}),
    /Unknown tool: missing_tool/,
  );
});

test("argument validation fails before touching the OMS client", async () => {
  await assert.rejects(
    () => runTool("oms_sign_message", {}),
    /message must be a non-empty string/,
  );

  await assert.rejects(
    () => runTool("oms_complete_email_auth", { code: "" }),
    /code must be a non-empty string/,
  );

  await assert.rejects(
    () => runTool("oms_start_email_auth", {}),
    /email must be a non-empty string/,
  );

  await assert.rejects(
    () => runTool("oms_send_erc20_token", { tokenAddress: "not-an-address" }),
    /tokenAddress must be a valid EVM address/,
  );

  await assert.rejects(
    () =>
      runTool("oms_send_erc20_token", {
        tokenAddress: "0x0000000000000000000000000000000000000000",
        to: "0x0000000000000000000000000000000000000001",
        amountRaw: "1.5",
      }),
    /amountRaw must be a positive integer string/,
  );

  await assert.rejects(
    () =>
      runTool("oms_send_native_token", {
        to: "0x0000000000000000000000000000000000000001",
        amountWei: "0",
      }),
    /amountWei must be greater than zero/,
  );
});

test("stdio MCP server handles initialize and tools/list", () => {
  const input = [
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.0" },
      },
    }),
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    }),
    "",
  ].join("\n");

  const result = spawnSync("pnpm", ["--silent", "mcp"], {
    input,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);

  const responses = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  assert.equal(responses[0].id, 1);
  assert.equal(responses[0].result.serverInfo.name, "oms-client-agent");
  assert.equal(responses[1].id, 2);
  assert.equal(responses[1].result.tools.length, tools.length);
  assert.equal(responses[1].result.tools[0].name, "oms_env_status");
});

test("stdio MCP server handles oms_env_status tool calls", () => {
  const input = [
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.0" },
      },
    }),
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "oms_env_status",
        arguments: {},
      },
    }),
    "",
  ].join("\n");

  const result = spawnSync("pnpm", ["--silent", "mcp"], {
    input,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);

  const responses = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const toolResult = responses[1].result.content[0];

  assert.equal(toolResult.type, "text");
  assert.deepEqual(JSON.parse(toolResult.text), envStatus());
});
