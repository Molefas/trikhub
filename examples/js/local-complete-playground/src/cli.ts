import "dotenv/config";
import * as readline from "readline";
import { homedir } from "os";
import { join } from "path";
import { existsSync, readdirSync, statSync, rmSync, readFileSync } from "fs";
import { HumanMessage, BaseMessage } from "@langchain/core/messages";
import { initializeAgentWithTriks, getLastPassthroughContent } from "./agent.js";
import type { TrikGateway } from "@trikhub/gateway";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

// ============================================================================
// Storage Utilities
// ============================================================================

function getStorageDir(): string {
  return join(homedir(), ".trikhub", "storage");
}

function getTrikStoragePath(trikId: string): string {
  const normalizedId = trikId.replace(/^@/, "");
  return join(getStorageDir(), `@${normalizedId}`);
}

function getDirectorySize(dirPath: string): number {
  if (!existsSync(dirPath)) {
    return 0;
  }

  let size = 0;
  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      size += getDirectorySize(entryPath);
    } else if (entry.isFile()) {
      size += statSync(entryPath).size;
    }
  }
  return size;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
}

// ============================================================================
// Config Utilities
// ============================================================================

function getLocalSecretsPath(): string {
  return join(process.cwd(), ".trikhub", "secrets.json");
}

function getGlobalSecretsPath(): string {
  return join(homedir(), ".trikhub", "secrets.json");
}

interface SecretsFile {
  [trikId: string]: Record<string, string>;
}

function loadSecrets(path: string): SecretsFile {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function getSecretsForTrik(trikId: string): Record<string, string> {
  const global = loadSecrets(getGlobalSecretsPath())[trikId] ?? {};
  const local = loadSecrets(getLocalSecretsPath())[trikId] ?? {};
  return { ...global, ...local };
}

// ============================================================================
// CLI Commands
// ============================================================================

function showStorageCommand(loadedTriks: string[]): void {
  console.log("\n\x1b[1mStorage Usage:\x1b[0m\n");

  if (loadedTriks.length === 0) {
    console.log("  No triks loaded.\n");
    return;
  }

  let totalSize = 0;
  const maxSize = 100 * 1024 * 1024; // 100MB

  for (const trikId of loadedTriks) {
    const storagePath = getTrikStoragePath(trikId);
    const size = getDirectorySize(storagePath);
    totalSize += size;
    const percentage = (size / maxSize) * 100;

    const barWidth = 20;
    const filledWidth = Math.round((percentage / 100) * barWidth);
    const emptyWidth = barWidth - filledWidth;
    const bar = "\x1b[32m" + "█".repeat(filledWidth) + "\x1b[90m" + "░".repeat(emptyWidth) + "\x1b[0m";

    console.log(`  \x1b[36m${trikId}\x1b[0m`);
    console.log(`    [${bar}] ${formatBytes(size)} (${percentage.toFixed(1)}%)`);
    console.log(`    \x1b[90mPath: ${storagePath}\x1b[0m`);
  }

  console.log();
  console.log(`\x1b[90mTotal storage: ${formatBytes(totalSize)}\x1b[0m`);
  console.log();
}

interface ManifestConfig {
  required?: Array<{ key: string; description: string }>;
  optional?: Array<{ key: string; description: string; default?: string }>;
}

function showConfigCommand(loadedTriks: string[], gateway: TrikGateway | null): void {
  console.log("\n\x1b[1mConfiguration Status:\x1b[0m\n");

  if (loadedTriks.length === 0) {
    console.log("  No triks loaded.\n");
    return;
  }

  for (const trikId of loadedTriks) {
    console.log(`  \x1b[36m${trikId}\x1b[0m`);

    // Get configured values
    const configuredSecrets = getSecretsForTrik(trikId);
    const configuredKeys = Object.keys(configuredSecrets);

    // Try to get manifest config requirements
    let manifestConfig: ManifestConfig | null = null;
    if (gateway) {
      const manifest = gateway.getManifest(trikId);
      if (manifest?.config) {
        manifestConfig = manifest.config;
      }
    }

    if (manifestConfig) {
      // Show required config
      if (manifestConfig.required && manifestConfig.required.length > 0) {
        for (const req of manifestConfig.required) {
          const isSet = configuredKeys.includes(req.key);
          const status = isSet
            ? "\x1b[32m✓ configured\x1b[0m"
            : "\x1b[31m✗ MISSING (required)\x1b[0m";
          console.log(`    ${req.key}: ${status}`);
        }
      }

      // Show optional config
      if (manifestConfig.optional && manifestConfig.optional.length > 0) {
        for (const opt of manifestConfig.optional) {
          const isSet = configuredKeys.includes(opt.key);
          const status = isSet
            ? "\x1b[32m✓ configured\x1b[0m"
            : "\x1b[90m✗ not set (optional)\x1b[0m";
          console.log(`    ${opt.key}: ${status}`);
        }
      }
    } else {
      // No manifest config, just show what's configured
      if (configuredKeys.length === 0) {
        console.log("    \x1b[90mNo configuration\x1b[0m");
      } else {
        for (const key of configuredKeys) {
          console.log(`    ${key}: \x1b[32m✓ configured\x1b[0m`);
        }
      }
    }
  }

  console.log();
  console.log("\x1b[90mSecrets files:\x1b[0m");
  const localPath = getLocalSecretsPath();
  const globalPath = getGlobalSecretsPath();
  if (existsSync(localPath)) {
    console.log(`\x1b[90m  Local: ${localPath}\x1b[0m`);
  }
  if (existsSync(globalPath)) {
    console.log(`\x1b[90m  Global: ${globalPath}\x1b[0m`);
  }
  console.log();
}

async function clearStorageCommand(trikId: string): Promise<void> {
  const normalizedTrik = trikId.startsWith("@") ? trikId : `@${trikId}`;
  const storagePath = getTrikStoragePath(normalizedTrik);

  if (!existsSync(storagePath)) {
    console.log(`\n\x1b[33mNo storage found for ${normalizedTrik}\x1b[0m\n`);
    return;
  }

  const size = getDirectorySize(storagePath);

  const answer = await prompt(
    `\nDelete ${formatBytes(size)} of storage for ${normalizedTrik}? (y/N): `
  );

  if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
    console.log("\x1b[90mCancelled\x1b[0m\n");
    return;
  }

  try {
    rmSync(storagePath, { recursive: true, force: true });
    console.log(`\x1b[32m✓ Cleared storage for ${normalizedTrik}\x1b[0m\n`);
  } catch (error) {
    console.log(
      `\x1b[31mFailed to clear storage: ${error instanceof Error ? error.message : "Unknown error"}\x1b[0m\n`
    );
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("LangGraph Agent CLI with TrikHub Support");
  console.log("Loading triks...\n");

  // Initialize agent with triks
  const { graph, loadedTriks, tools, gateway } = await initializeAgentWithTriks();

  // Show config status for loaded triks
  if (loadedTriks.length > 0 && gateway) {
    for (const trikId of loadedTriks) {
      const configuredSecrets = getSecretsForTrik(trikId);
      const configuredKeys = Object.keys(configuredSecrets);
      const status = configuredKeys.length > 0
        ? configuredKeys.map((k) => `${k} \x1b[32m✓\x1b[0m`).join(", ")
        : "\x1b[33mno config\x1b[0m";
      console.log(`[Config] ${trikId}: ${status}`);
    }
    console.log();
  }

  console.log(`Built-in tools: request_refund, find_order, get_project_details`);
  if (loadedTriks.length > 0) {
    console.log(`Loaded triks: ${loadedTriks.join(", ")}`);
  } else {
    console.log("No triks installed. Use `trik install @scope/name` to add triks.");
  }
  console.log(`\nTotal tools available: ${tools.length}`);
  console.log('Type "/tools" to list tools, "/storage" for storage info, "/config" for config status.');
  console.log('Type "exit" or "quit" to end.\n');

  const messages: BaseMessage[] = [];
  const threadId = `cli-${Date.now()}`;

  while (true) {
    const userInput = await prompt("You: ");

    if (!userInput.trim()) {
      continue;
    }

    if (
      userInput.toLowerCase() === "exit" ||
      userInput.toLowerCase() === "quit"
    ) {
      console.log("\nGoodbye!");
      break;
    }

    // Handle special commands
    if (userInput.toLowerCase() === "/tools") {
      console.log("\nAvailable tools:");
      for (const tool of tools) {
        console.log(`  - ${tool.name}: ${tool.description}`);
      }
      console.log();
      continue;
    }

    if (userInput.toLowerCase() === "/storage") {
      showStorageCommand(loadedTriks);
      continue;
    }

    if (userInput.toLowerCase() === "/config") {
      showConfigCommand(loadedTriks, gateway);
      continue;
    }

    if (userInput.toLowerCase().startsWith("/clear ")) {
      const trikId = userInput.slice(7).trim();
      if (trikId) {
        await clearStorageCommand(trikId);
      } else {
        console.log('\nUsage: /clear @scope/trik-name\n');
      }
      continue;
    }

    if (userInput.startsWith("/")) {
      console.log(`\nUnknown command: ${userInput}`);
      console.log("Available commands: /tools, /storage, /config, /clear @scope/name\n");
      continue;
    }

    messages.push(new HumanMessage(userInput));

    try {
      const result = await graph.invoke(
        { messages },
        { configurable: { thread_id: threadId } }
      );

      // Check for passthrough content (direct output from trik)
      const passthroughContent = getLastPassthroughContent();
      if (passthroughContent) {
        console.log(`\n--- Direct Content (${passthroughContent.contentType}) ---`);
        console.log(passthroughContent.content);
        console.log("--- End ---\n");
      }

      // Always show assistant message
      const assistantMessage = result.messages[result.messages.length - 1];
      console.log(`\nAssistant: ${assistantMessage.content}\n`);

      // Update messages with the full conversation history from the graph
      messages.length = 0;
      messages.push(...result.messages);
    } catch (error) {
      console.error("\nError:", error);
      console.log("Please try again.\n");
    }
  }

  rl.close();
}

main().catch((error) => {
  console.error(error);
  rl.close();
});
