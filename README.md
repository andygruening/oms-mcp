# OMS Client MCP

This project exposes the OMS client as a local MCP server over stdio.

## How it works

The MCP host starts this server as a local stdio process. The agent calls the exposed MCP tools, and the server translates those tool calls into OMS Wallet SDK calls.

Email sign-in is a two-step flow: `oms_start_email_auth` sends the OTP to the email address from the user prompt, then `oms_complete_email_auth` completes the auth attempt with the OTP code. Those two calls need to run in the same server process.

After sign-in, wallet session metadata and the credential signer key are persisted in the platform secure store. That lets a later MCP process restore the wallet session and sign messages or transactions without exposing secrets to the agent.

Token transfers are intentionally narrow. ERC20 transfers use `wallet.callContract` with `transfer(address,uint256)`, and native token transfers use `wallet.sendTransaction` with only `to` and `value` fields.

## Configure

Run setup:

```bash
pnpm run setup:mcp
```

This creates `.env` from `.env.example` if it does not already exist, builds the local Keychain helper, and prints the Codex MCP config block for this checkout.

Then fill in `.env`:

```bash
OMS_PUBLISHABLE_KEY=...
OMS_PROJECT_ID=...
```

Wallet session data, redirect auth state, and the Node credential signer key are stored in macOS Keychain under fixed `oms-client-agent-mcp:*` service names.

On Linux, the same values are stored through Freedesktop Secret Service using `secret-tool`. Install `libsecret-tools` and ensure a Secret Service provider such as GNOME Keyring or KWallet is available and unlocked.

## Example Prompts

### Sign in

```text
Sign in using your@email.com
```

Wait for response, then enter OTP code:

```text
123456
```

### Send USDC

```text
Send 1 USDC to 0xB54d0b73a40f5b9a243D142EeDDA39Bb5ed76B50 on amoy
```

### Get token balances

```text
What's my USDC balance on Polygon mainnet?
```

## Run

If you skip `pnpm run setup:mcp`, build the local Keychain helper once:

```bash
pnpm build:keychain-helper
```

Then run the MCP server:

```bash
pnpm --silent mcp
```

The `check` and test scripts compile `src/storage/keychain-helper.swift` to `bin/keychain-helper` before running. The `mcp` script expects that binary to already exist so MCP stdout stays protocol-clean.

Example MCP host config:

```json
{
  "mcpServers": {
    "oms-client-agent": {
      "command": "pnpm",
      "args": ["--silent", "mcp"],
      "cwd": "/Users/theirname/path/to/oms-mcp"
    }
  }
}
```

## Tools

- `oms_env_status`: checks required environment keys without printing secrets.
- `oms_session_status`: reports whether a wallet session is restored.
- `oms_start_email_auth`: sends an email OTP to the email address provided in the tool call.
- `oms_complete_email_auth`: completes the OTP flow in the same server process.
- `oms_sign_message`: signs a message with the active wallet session.
- `oms_get_token_balances`: queries token balances through the OMS indexer.
- `oms_get_native_token_balance`: queries the native token balance.
- `oms_send_erc20_token`: sends ERC20 tokens through `wallet.callContract` using `transfer(address,uint256)`.
- `oms_send_native_token`: sends native tokens through `wallet.sendTransaction`.
- `oms_sign_out`: clears the active wallet session.

Default network is `amoy`. Pass a supported SDK network name such as `polygon`, `base`, or `sepolia` where tools accept `network`.

Transfer tools accept raw integer amounts: `amountRaw` for ERC20 base units and `amountWei` for native token wei.
