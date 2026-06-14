import { fileURLToPath } from "node:url";
import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  EthereumPrivateKeyCredentialSigner,
  OMSClient,
  Networks,
  findNetworkByName,
  type Network,
  type StorageManager,
} from "@0xsequence/typescript-sdk";
import { hexToBytes, isAddress, type Address } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { MacOSKeychainStorageManager } from "./storage/keychain-storage";
import { LinuxSecretServiceStorageManager } from "./storage/secret-service-storage";

type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const serverInfo = {
  name: "oms-client-agent",
  version: "0.1.0",
};

const walletStorageServiceName = "oms-client-agent-mcp:wallet-session";
const redirectAuthStorageServiceName = "oms-client-agent-mcp:redirect-auth";
const credentialSignerStorageServiceName = "oms-client-agent-mcp:credential-signer";
const credentialPrivateKeyStorageKey = "ethereum-private-key";

export const tools: Tool[] = [
  {
    name: "oms_env_status",
    description: "Report whether required OMS environment values are configured without exposing their values.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "oms_session_status",
    description: "Report the restored OMS wallet session status and wallet address if present.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "oms_start_email_auth",
    description: "Start email OTP authentication. Call oms_complete_email_auth with the OTP in the same MCP server process.",
    inputSchema: {
      type: "object",
      properties: {
        email: {
          type: "string",
          description: "Email address to receive the OTP.",
        },
      },
      required: ["email"],
      additionalProperties: false,
    },
  },
  {
    name: "oms_complete_email_auth",
    description: "Complete the active email OTP authentication attempt and persist the wallet session.",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "OTP code received by email.",
        },
        sessionLifetimeSeconds: {
          type: "number",
          description: "Optional session lifetime requested from OMS.",
        },
      },
      required: ["code"],
      additionalProperties: false,
    },
  },
  {
    name: "oms_sign_message",
    description: "Sign a message with the active OMS wallet session.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string" },
        network: {
          type: "string",
          description: "Network name. Defaults to amoy.",
        },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
  {
    name: "oms_get_token_balances",
    description: "Get token balances for a wallet through the OMS indexer.",
    inputSchema: {
      type: "object",
      properties: {
        walletAddress: {
          type: "string",
          description: "Wallet address to query. Defaults to the active OMS wallet session.",
        },
        network: {
          type: "string",
          description: "Network name. Defaults to amoy.",
        },
        contractAddress: {
          type: "string",
          description: "Optional token contract filter.",
        },
        includeMetadata: {
          type: "boolean",
          description: "Whether to include token metadata. Defaults to true.",
        },
        page: {
          type: "object",
          properties: {
            page: { type: "number" },
            pageSize: { type: "number" },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "oms_get_native_token_balance",
    description: "Get the native token balance for a wallet through the OMS indexer.",
    inputSchema: {
      type: "object",
      properties: {
        walletAddress: {
          type: "string",
          description: "Wallet address to query. Defaults to the active OMS wallet session.",
        },
        network: {
          type: "string",
          description: "Network name. Defaults to amoy.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "oms_send_erc20_token",
    description: "Send ERC20 tokens with the active OMS wallet session through wallet.callContract.",
    inputSchema: {
      type: "object",
      properties: {
        network: {
          type: "string",
          description: "Network name. Defaults to amoy.",
        },
        tokenAddress: {
          type: "string",
          description: "ERC20 contract address.",
        },
        to: {
          type: "string",
          description: "Recipient wallet address.",
        },
        amountRaw: {
          type: "string",
          description: "Token amount in raw base units, for example 1000000 for 1 USDC with 6 decimals.",
        },
        waitForStatus: {
          type: "boolean",
          description: "Whether to wait for transaction status. Defaults to the SDK behavior.",
        },
      },
      required: ["tokenAddress", "to", "amountRaw"],
      additionalProperties: false,
    },
  },
  {
    name: "oms_send_native_token",
    description: "Send native tokens with the active OMS wallet session through wallet.sendTransaction.",
    inputSchema: {
      type: "object",
      properties: {
        network: {
          type: "string",
          description: "Network name. Defaults to amoy.",
        },
        to: {
          type: "string",
          description: "Recipient wallet address.",
        },
        amountWei: {
          type: "string",
          description: "Native token amount in wei.",
        },
        waitForStatus: {
          type: "boolean",
          description: "Whether to wait for transaction status. Defaults to the SDK behavior.",
        },
      },
      required: ["to", "amountWei"],
      additionalProperties: false,
    },
  },
  {
    name: "oms_sign_out",
    description: "Sign out and clear the active OMS wallet session metadata.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

let omsClient: ReturnType<typeof createOmsClient> | undefined;

export function createMcpServer(): Server {
  const server = new Server(serverInfo, {
    capabilities: {
      tools: {},
    },
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = asOptionalObject(request.params.arguments, "arguments") ?? {};

    try {
      const result = await runTool(name, args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: getErrorMessage(error),
          },
        ],
      };
    }
  });

  return server;
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "oms_env_status":
      return envStatus();
    case "oms_session_status":
      return sessionStatus();
    case "oms_start_email_auth":
      return startEmailAuth(args);
    case "oms_complete_email_auth":
      return completeEmailAuth(args);
    case "oms_sign_message":
      return signMessage(args);
    case "oms_get_token_balances":
      return getTokenBalances(args);
    case "oms_get_native_token_balance":
      return getNativeTokenBalance(args);
    case "oms_send_erc20_token":
      return sendErc20Token(args);
    case "oms_send_native_token":
      return sendNativeToken(args);
    case "oms_sign_out":
      return signOut();
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function envStatus(): Record<string, boolean> {
  return {
    OMS_PUBLISHABLE_KEY: hasEnv("OMS_PUBLISHABLE_KEY"),
    OMS_PROJECT_ID: hasEnv("OMS_PROJECT_ID"),
  };
}

function sessionStatus(): unknown {
  const oms = getOmsClient();
  const walletAddress = oms.wallet.session.walletAddress;
  return {
    hasSession: Boolean(walletAddress),
    walletAddress: walletAddress ?? null,
  };
}

async function startEmailAuth(args: Record<string, unknown>): Promise<unknown> {
  const email = requiredString(args.email, "email");
  const oms = getOmsClient();
  await oms.wallet.startEmailAuth({ email });

  return {
    status: "otp_sent",
    email: maskEmail(email),
  };
}

async function completeEmailAuth(args: Record<string, unknown>): Promise<unknown> {
  const code = requiredString(args.code, "code");
  const sessionLifetimeSeconds = optionalNumber(
    args.sessionLifetimeSeconds,
    "sessionLifetimeSeconds",
  );
  const oms = getOmsClient();
  const result = await oms.wallet.completeEmailAuth({
    code,
    ...(sessionLifetimeSeconds === undefined ? {} : { sessionLifetimeSeconds }),
  });

  return sanitizeWalletResult(result);
}

async function signMessage(args: Record<string, unknown>): Promise<unknown> {
  const message = requiredString(args.message, "message");
  const network = networkFromArgs(args);
  const oms = getOmsClientWithSession();
  const signature = await oms.wallet.signMessage({ network, message });

  return {
    network: network.name,
    walletAddress: oms.wallet.session.walletAddress,
    message,
    signature,
  };
}

async function getTokenBalances(args: Record<string, unknown>): Promise<unknown> {
  const oms = getOmsClient();
  const network = networkFromArgs(args);
  const walletAddress =
    optionalString(args.walletAddress, "walletAddress") ?? requireWalletAddress(oms);
  const contractAddress = optionalString(args.contractAddress, "contractAddress");
  const includeMetadata = optionalBoolean(args.includeMetadata, "includeMetadata") ?? true;
  const page = asOptionalObject(args.page, "page");

  return oms.indexer.getTokenBalances({
    network,
    walletAddress,
    includeMetadata,
    ...(contractAddress === undefined ? {} : { contractAddress }),
    ...(page === undefined ? {} : { page }),
  });
}

async function getNativeTokenBalance(args: Record<string, unknown>): Promise<unknown> {
  const oms = getOmsClient();
  const network = networkFromArgs(args);
  const walletAddress =
    optionalString(args.walletAddress, "walletAddress") ?? requireWalletAddress(oms);

  return oms.indexer.getNativeTokenBalance({
    network,
    walletAddress,
  });
}

async function sendErc20Token(args: Record<string, unknown>): Promise<unknown> {
  const network = networkFromArgs(args);
  const tokenAddress = requiredAddress(args.tokenAddress, "tokenAddress");
  const to = requiredAddress(args.to, "to");
  const amountRaw = requiredPositiveBigInt(args.amountRaw, "amountRaw");
  const waitForStatus = optionalBoolean(args.waitForStatus, "waitForStatus");
  const oms = getOmsClientWithSession();

  return oms.wallet.callContract({
    network,
    contractAddress: tokenAddress,
    method: "transfer(address,uint256)",
    args: [to, amountRaw.toString()],
    ...(waitForStatus === undefined ? {} : { waitForStatus }),
  });
}

async function sendNativeToken(args: Record<string, unknown>): Promise<unknown> {
  const network = networkFromArgs(args);
  const to = requiredAddress(args.to, "to");
  const amountWei = requiredPositiveBigInt(args.amountWei, "amountWei");
  const waitForStatus = optionalBoolean(args.waitForStatus, "waitForStatus");
  const oms = getOmsClientWithSession();

  return oms.wallet.sendTransaction({
    network,
    to,
    value: amountWei,
    ...(waitForStatus === undefined ? {} : { waitForStatus }),
  });
}

async function signOut(): Promise<unknown> {
  const oms = getOmsClient();
  await oms.wallet.signOut();
  return { status: "signed_out" };
}

function createOmsClient() {
  const publishableKey = requiredEnv("OMS_PUBLISHABLE_KEY");
  const projectId = requiredEnv("OMS_PROJECT_ID");
  return new OMSClient({
    publishableKey,
    projectId,
    storage: createSecureStorageManager(walletStorageServiceName),
    redirectAuthStorage: createSecureStorageManager(redirectAuthStorageServiceName),
    credentialSigner: createCredentialSigner(),
  });
}

function createCredentialSigner(): EthereumPrivateKeyCredentialSigner {
  return new EthereumPrivateKeyCredentialSigner(
    hexToBytes(getOrCreateCredentialPrivateKey()),
  );
}

function getOrCreateCredentialPrivateKey(): `0x${string}` {
  const storage = createSecureStorageManager(credentialSignerStorageServiceName);
  const storedPrivateKey = storage.get(credentialPrivateKeyStorageKey);

  if (storedPrivateKey) {
    if (!isHexPrivateKey(storedPrivateKey)) {
      throw new Error(
        `Stored credential signer private key is invalid in ${credentialSignerStorageServiceName}`,
      );
    }

    return storedPrivateKey;
  }

  const privateKey = generatePrivateKey();
  storage.set(credentialPrivateKeyStorageKey, privateKey);
  return privateKey;
}

function createSecureStorageManager(serviceName: string): StorageManager {
  if (process.platform === "darwin") {
    return new MacOSKeychainStorageManager(serviceName);
  }

  if (process.platform === "linux") {
    return new LinuxSecretServiceStorageManager(serviceName);
  }

  throw new Error(
    `Unsupported secure storage platform "${process.platform}". This MCP supports macOS Keychain and Linux Secret Service.`,
  );
}

function isHexPrivateKey(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

function getOmsClient(): ReturnType<typeof createOmsClient> {
  omsClient ??= createOmsClient();
  return omsClient;
}

function getOmsClientWithSession(): ReturnType<typeof createOmsClient> {
  const oms = getOmsClient();
  requireWalletAddress(oms);
  return oms;
}

function requireWalletAddress(oms: ReturnType<typeof createOmsClient>): string {
  const walletAddress = oms.wallet.session.walletAddress;
  if (!walletAddress) {
    throw new Error(
      "No active OMS wallet session. Call oms_start_email_auth, then oms_complete_email_auth first.",
    );
  }
  return walletAddress;
}

function networkFromArgs(args: Record<string, unknown>): Network {
  const networkName = optionalString(args.network, "network") ?? "amoy";
  const network = findNetworkByName(networkName);
  if (!network) {
    throw new Error(
      `Unknown network "${networkName}". Supported names include: ${Object.values(Networks)
        .map((value) => value.name)
        .join(", ")}`,
    );
  }
  return network;
}

function sanitizeWalletResult(result: unknown): unknown {
  if (!isRecord(result)) return result;

  return {
    walletAddress: result.walletAddress ?? null,
    wallet: result.wallet ?? null,
    wallets: result.wallets ?? null,
    credential: result.credential
      ? {
          id: asObject(result.credential, "credential").id ?? null,
          type: asObject(result.credential, "credential").type ?? null,
        }
      : null,
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Configure it in .env or the MCP server environment.`);
  }
  return value;
}

function hasEnv(name: string): boolean {
  return Boolean(process.env[name]);
}

function asOptionalObject(
  value: unknown,
  name: string,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  return asObject(value, name);
}

function asObject(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, name);
}

function requiredAddress(value: unknown, name: string): Address {
  const address = requiredString(value, name);
  if (!isAddress(address)) {
    throw new Error(`${name} must be a valid EVM address`);
  }
  return address;
}

function requiredPositiveBigInt(value: unknown, name: string): bigint {
  const rawValue = requiredString(value, name);
  if (!/^[0-9]+$/.test(rawValue)) {
    throw new Error(`${name} must be a positive integer string`);
  }

  const parsedValue = BigInt(rawValue);
  if (parsedValue <= 0n) {
    throw new Error(`${name} must be greater than zero`);
  }

  return parsedValue;
}

function optionalNumber(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean`);
  }
  return value;
}

function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!name || !domain) return "***";
  const visibleName = name.length <= 2 ? `${name[0] ?? ""}***` : `${name.slice(0, 2)}***`;
  return `${visibleName}@${domain}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function startServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint) && fileURLToPath(import.meta.url) === entrypoint;
}

if (isMainModule()) {
  await startServer();
}
