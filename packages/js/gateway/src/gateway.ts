import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import {
  type TrikManifest,
  type TrikRuntime,
  type TrikAgent,
  type TrikContext,
  type TrikConfigContext,
  type TrikResponse,
  type TrikCapabilities,
  type ToolCallRecord,
  type ToolDeclaration,
  type JSONSchema,
  type ToolExecutionResult,
  validateManifest,
  validateData,
} from '@trikhub/manifest';
import { PythonWorker, type PythonWorkerConfig } from './python-worker.js';
import {
  DockerContainerManager,
  ContainerWorkerHandle,
  type ContainerOptions,
  type ContainerManagerConfig,
} from './container-manager.js';
import { type ConfigStore, FileConfigStore } from './config-store.js';
import { type StorageProvider, SqliteStorageProvider } from './storage-provider.js';
import { type SessionStorage, InMemorySessionStorage } from './session-storage.js';

// ============================================================================
// Types
// ============================================================================

interface LoadedTrik {
  manifest: TrikManifest;
  agent: TrikAgent;
  path: string;
  runtime: TrikRuntime;
  /** Whether this trik requires containerized execution (has filesystem/shell capabilities) */
  containerized: boolean;
}

export interface TrikGatewayConfig {
  allowedTriks?: string[];
  /**
   * Directory containing installed triks for auto-discovery.
   * Supports scoped directory structure: triksDirectory/@scope/trik-name/
   * Use '~' for home directory (e.g., '~/.trikhub/triks')
   */
  triksDirectory?: string;
  /**
   * Configuration store for trik secrets (API keys, tokens, etc.).
   * Defaults to FileConfigStore which reads from ~/.trikhub/secrets.json
   * and .trikhub/secrets.json (local overrides global).
   */
  configStore?: ConfigStore;
  /**
   * Storage provider for persistent trik data.
   * Defaults to SqliteStorageProvider which stores data in ~/.trikhub/storage/
   */
  storageProvider?: StorageProvider;
  /**
   * Session storage for handoff sessions.
   * Defaults to InMemorySessionStorage.
   */
  sessionStorage?: SessionStorage;
  /**
   * Whether to validate that all required config values are present when loading triks.
   * Defaults to true. Set to false to skip validation (e.g., for listing triks).
   */
  validateConfig?: boolean;
  /**
   * Configuration for Python worker (used for Python triks).
   * If not provided, defaults will be used when a Python trik is loaded.
   */
  pythonWorkerConfig?: PythonWorkerConfig;
  /**
   * Maximum turns per handoff session before auto-transfer-back.
   * Defaults to 20.
   */
  maxTurnsPerHandoff?: number;
  /**
   * Configuration for Docker container manager (used for containerized triks
   * with filesystem/shell capabilities).
   */
  containerManagerConfig?: ContainerManagerConfig;
}

/**
 * Configuration file structure for .trikhub/config.json
 */
export interface TrikHubConfig {
  /** List of installed trik package names */
  triks: string[];
}

export interface LoadFromConfigOptions {
  /** Path to the config file. Defaults to .trikhub/config.json in cwd */
  configPath?: string;
  /** Base directory for resolving node_modules. Defaults to dirname of configPath */
  baseDir?: string;
}

// ============================================================================
// Route Result Types
// ============================================================================

/**
 * Result of routing a message through the gateway.
 */
export type RouteResult = RouteToMain | RouteToTrik | RouteTransferBack | RouteForceBack;

/** No active handoff — caller should send to main agent with these handoff tools */
export interface RouteToMain {
  target: 'main';
  handoffTools: HandoffToolDefinition[];
}

/** Active handoff — the gateway routed the message to the trik and got a response */
export interface RouteToTrik {
  target: 'trik';
  trikId: string;
  response: TrikResponse;
  sessionId: string;
}

/** Trik signaled transfer-back — message shown to user, summary injected into history */
export interface RouteTransferBack {
  target: 'transfer_back';
  trikId: string;
  message: string;   // trik's response → shown to user
  summary: string;   // session log → injected into main history
  sessionId: string;
}

/** User forced /back — message shown to user, summary injected into history */
export interface RouteForceBack {
  target: 'force_back';
  trikId: string;
  message: string;   // empty string (adapter generates system message)
  summary: string;   // session log → injected into main history
  sessionId: string;
}

/**
 * A handoff tool definition — one per loaded conversational trik.
 * The main agent calls these to initiate a handoff.
 */
export interface HandoffToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
}

/**
 * An exposed tool definition — one per tool in a tool-mode trik.
 * These appear as native tools on the main agent (no handoff).
 */
export interface ExposedToolDefinition {
  trikId: string;
  toolName: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  outputTemplate: string;
}

// ============================================================================
// Active Handoff State
// ============================================================================

interface ActiveHandoff {
  trikId: string;
  sessionId: string;
  turnCount: number;
}

// ============================================================================
// Gateway
// ============================================================================

export class TrikGateway {
  private config: TrikGatewayConfig;
  private configStore: ConfigStore;
  private storageProvider: StorageProvider;
  private sessionStorage: SessionStorage;
  private configLoaded = false;
  private pythonWorker: PythonWorker | null = null;
  private containerManager: DockerContainerManager | null = null;
  private maxTurnsPerHandoff: number;

  // Loaded triks (by trik ID)
  private triks = new Map<string, LoadedTrik>();

  // Active handoff state (null = no active handoff)
  private activeHandoff: ActiveHandoff | null = null;

  constructor(config: TrikGatewayConfig = {}) {
    this.config = config;
    this.configStore = config.configStore ?? new FileConfigStore();
    this.storageProvider = config.storageProvider ?? new SqliteStorageProvider();
    this.sessionStorage = config.sessionStorage ?? new InMemorySessionStorage();
    this.maxTurnsPerHandoff = config.maxTurnsPerHandoff ?? 20;
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Initialize the gateway by loading configuration.
   * Should be called before loading any triks.
   */
  async initialize(): Promise<void> {
    if (!this.configLoaded) {
      await this.configStore.load();
      this.configLoaded = true;
    }
  }

  /**
   * Get the config store (for CLI integration)
   */
  getConfigStore(): ConfigStore {
    return this.configStore;
  }

  /**
   * Get the storage provider (for CLI integration)
   */
  getStorageProvider(): StorageProvider {
    return this.storageProvider;
  }

  /**
   * Get the session storage
   */
  getSessionStorage(): SessionStorage {
    return this.sessionStorage;
  }

  // ==========================================================================
  // Message Routing (the heart of the handoff model)
  // ==========================================================================

  /**
   * Route a user message through the gateway.
   *
   * - If no active handoff: returns RouteToMain with handoff tools
   * - If active handoff + "/back": forces transfer-back
   * - If active handoff: routes to trik, handles transfer-back and max turns
   */
  async routeMessage(message: string, sessionId: string): Promise<RouteResult> {
    // /back escape — deterministic, always works
    if (message.trim() === '/back' && this.activeHandoff) {
      return this.forceTransferBack();
    }

    // Active handoff — route to trik
    if (this.activeHandoff) {
      return this.routeToTrik(message, sessionId);
    }

    // No handoff — return to main agent with handoff tools
    return { target: 'main', handoffTools: this.getHandoffTools() };
  }

  /**
   * Start a handoff to a trik. Called when the main agent invokes a talk_to_X tool.
   *
   * @param trikId - The trik to hand off to
   * @param context - Context message from the main agent
   * @param sessionId - Session ID for the conversation
   */
  async startHandoff(trikId: string, context: string, sessionId: string): Promise<RouteToTrik | RouteTransferBack> {
    const loaded = this.triks.get(trikId);
    if (!loaded) {
      throw new Error(`Trik "${trikId}" is not loaded`);
    }

    // Create a handoff session
    const handoffSession = this.sessionStorage.createSession(trikId);

    // Set active handoff state
    this.activeHandoff = {
      trikId,
      sessionId: handoffSession.sessionId,
      turnCount: 0,
    };

    // Log handoff start
    this.sessionStorage.appendLog(handoffSession.sessionId, {
      timestamp: Date.now(),
      type: 'handoff_start',
      summary: `Handoff to ${loaded.manifest.name}`,
    });

    // Route the initial context message to the trik
    return this.routeToTrik(context, sessionId);
  }

  /**
   * Get the current active handoff state, if any.
   */
  getActiveHandoff(): { trikId: string; sessionId: string; turnCount: number } | null {
    if (!this.activeHandoff) return null;
    return { ...this.activeHandoff };
  }

  // ==========================================================================
  // Handoff Tool Generation
  // ==========================================================================

  /**
   * Generate handoff tool definitions — one per loaded conversational trik.
   * These get added to the main agent's tool set by the LangChain adapter.
   */
  getHandoffTools(): HandoffToolDefinition[] {
    const tools: HandoffToolDefinition[] = [];

    for (const [trikId, loaded] of this.triks) {
      if (loaded.manifest.agent.mode !== 'conversational') continue;

      tools.push({
        name: `talk_to_${trikId}`,
        description: loaded.manifest.agent.handoffDescription!,
        inputSchema: {
          type: 'object',
          properties: {
            context: {
              type: 'string',
              description: 'Context about what the user needs from this agent',
            },
          },
          required: ['context'],
        },
      });
    }

    return tools;
  }

  /**
   * Get exposed tool definitions from tool-mode triks.
   * These appear as native tools on the main agent.
   */
  getExposedTools(): ExposedToolDefinition[] {
    const tools: ExposedToolDefinition[] = [];

    for (const [trikId, loaded] of this.triks) {
      if (loaded.manifest.agent.mode !== 'tool') continue;
      if (!loaded.manifest.tools) continue;

      for (const [toolName, toolDecl] of Object.entries(loaded.manifest.tools)) {
        if (!toolDecl.inputSchema || !toolDecl.outputSchema || !toolDecl.outputTemplate) continue;

        tools.push({
          trikId,
          toolName,
          description: toolDecl.description,
          inputSchema: toolDecl.inputSchema,
          outputSchema: toolDecl.outputSchema,
          outputTemplate: toolDecl.outputTemplate,
        });
      }
    }

    return tools;
  }

  /**
   * Execute an exposed tool from a tool-mode trik.
   * Validates input and output against manifest schemas.
   */
  async executeExposedTool(
    trikId: string,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    const loaded = this.triks.get(trikId);
    if (!loaded) {
      throw new Error(`Trik "${trikId}" is not loaded`);
    }

    if (loaded.manifest.agent.mode !== 'tool') {
      throw new Error(`Trik "${trikId}" is not a tool-mode trik`);
    }

    const toolDecl = loaded.manifest.tools?.[toolName];
    if (!toolDecl || !toolDecl.inputSchema || !toolDecl.outputSchema || !toolDecl.outputTemplate) {
      throw new Error(`Tool "${toolName}" not found in trik "${trikId}"`);
    }

    // Validate input against inputSchema
    const inputValidation = validateData(toolDecl.inputSchema, input);
    if (!inputValidation.valid) {
      throw new Error(
        `Invalid input for ${trikId}.${toolName}: ${inputValidation.errors?.join(', ')}`,
      );
    }

    // Execute the tool
    if (!loaded.agent.executeTool) {
      throw new Error(`Trik "${trikId}" does not implement executeTool()`);
    }

    const context = this.buildTrikContext(`tool:${trikId}:${toolName}`, loaded);
    const result: ToolExecutionResult = await loaded.agent.executeTool(toolName, input, context);

    // Validate output against outputSchema
    const outputValidation = validateData(toolDecl.outputSchema, result.output);
    if (!outputValidation.valid) {
      // Never return raw output on validation failure — sanitized error only
      throw new Error(
        `Tool "${toolName}" returned invalid output: ${outputValidation.errors?.join(', ')}`,
      );
    }

    // Strip to declared outputSchema properties only
    const declaredProps = Object.keys(
      (toolDecl.outputSchema as Record<string, unknown>).properties ?? {}
    );
    const stripped: Record<string, unknown> = {};
    for (const key of declaredProps) {
      if (key in result.output) stripped[key] = result.output[key];
    }

    // Fill outputTemplate
    return toolDecl.outputTemplate.replace(/\{\{(\w+)\}\}/g, (_match, field: string) => {
      const value = stripped[field];
      if (value === undefined || value === null) return `{{${field}}}`;
      return String(value);
    });
  }

  // ==========================================================================
  // Internal Routing
  // ==========================================================================

  /**
   * Route a message to the active trik agent.
   */
  private async routeToTrik(message: string, sessionId: string): Promise<RouteToTrik | RouteTransferBack> {
    const handoff = this.activeHandoff!;
    const loaded = this.triks.get(handoff.trikId)!;

    // Build trik context
    const trikContext = this.buildTrikContext(handoff.sessionId, loaded);

    // Increment turn count
    handoff.turnCount++;

    // Check max turns safety net
    if (handoff.turnCount > this.maxTurnsPerHandoff) {
      return this.autoTransferBack(
        `Maximum turns (${this.maxTurnsPerHandoff}) exceeded. Automatically transferring back.`
      );
    }

    // Call the trik agent
    let response: TrikResponse;
    try {
      response = await loaded.agent.processMessage!(message, trikContext);
    } catch (error) {
      // Trik threw an error — transfer back with sanitized error
      const rawMsg = error instanceof Error ? error.message : 'Unknown error';
      const sanitized = this.sanitizeErrorMessage(rawMsg);
      // User-facing: include sanitized error for debugging
      const userMessage = `Trik "${loaded.manifest.name}" encountered an error: ${sanitized}`;
      // Agent-facing log: generic message, no trik-controlled text
      const agentLog = `Trik "${loaded.manifest.name}" encountered an error and transferred back`;
      return this.autoTransferBack(userMessage, agentLog);
    }

    // Process tool calls into log entries
    if (response.toolCalls) {
      this.processToolCalls(handoff.sessionId, loaded.manifest, response.toolCalls);
    }

    // Check if trik wants to transfer back
    if (response.transferBack) {
      // Log handoff end
      this.sessionStorage.appendLog(handoff.sessionId, {
        timestamp: Date.now(),
        type: 'handoff_end',
        summary: `Transferred back from ${loaded.manifest.name}`,
      });

      const summary = this.buildSessionSummary(handoff.sessionId, loaded.manifest);
      const handoffSessionId = handoff.sessionId;
      const trikId = handoff.trikId;

      // Stop container if containerized
      await this.stopContainerIfNeeded(trikId);

      // Clear active handoff
      this.activeHandoff = null;

      return {
        target: 'transfer_back',
        trikId,
        message: response.message,
        summary,
        sessionId: handoffSessionId,
      };
    }

    // Trik responded normally — stay in handoff
    return {
      target: 'trik',
      trikId: handoff.trikId,
      response,
      sessionId: handoff.sessionId,
    };
  }

  /**
   * Force transfer-back via /back command.
   */
  private async forceTransferBack(): Promise<RouteForceBack> {
    const handoff = this.activeHandoff!;
    const loaded = this.triks.get(handoff.trikId)!;

    // Log handoff end
    this.sessionStorage.appendLog(handoff.sessionId, {
      timestamp: Date.now(),
      type: 'handoff_end',
      summary: `Force transfer-back via /back`,
    });

    const summary = this.buildSessionSummary(handoff.sessionId, loaded.manifest);
    const result: RouteForceBack = {
      target: 'force_back',
      trikId: handoff.trikId,
      message: '',
      summary,
      sessionId: handoff.sessionId,
    };

    // Stop container if containerized
    await this.stopContainerIfNeeded(handoff.trikId);

    // Clear active handoff
    this.activeHandoff = null;

    return result;
  }

  /**
   * Sanitize an error message for safe display.
   * Strips control characters (keeps newlines/tabs) and truncates.
   */
  private sanitizeErrorMessage(msg: string, maxLength = 200): string {
    // Strip control characters except newline (\n) and tab (\t)
    const cleaned = msg.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    if (cleaned.length <= maxLength) return cleaned;
    return cleaned.slice(0, maxLength) + '...';
  }

  /**
   * Auto transfer-back due to max turns or error.
   */
  private async autoTransferBack(reason: string, logSummary?: string): Promise<RouteTransferBack> {
    const handoff = this.activeHandoff!;
    const loaded = this.triks.get(handoff.trikId)!;

    // Log handoff end — use logSummary for the agent-facing log if provided
    this.sessionStorage.appendLog(handoff.sessionId, {
      timestamp: Date.now(),
      type: 'handoff_end',
      summary: logSummary ?? reason,
    });

    const summary = this.buildSessionSummary(handoff.sessionId, loaded.manifest);
    const result: RouteTransferBack = {
      target: 'transfer_back',
      trikId: handoff.trikId,
      message: reason,
      summary,
      sessionId: handoff.sessionId,
    };

    // Stop container if containerized
    await this.stopContainerIfNeeded(handoff.trikId);

    // Clear active handoff
    this.activeHandoff = null;

    return result;
  }

  // ==========================================================================
  // Conversation Log
  // ==========================================================================

  /**
   * Process tool calls from a trik response into log entries.
   * Matches tool calls against manifest logTemplate/logSchema definitions.
   */
  private processToolCalls(
    sessionId: string,
    manifest: TrikManifest,
    toolCalls: ToolCallRecord[]
  ): void {
    for (const call of toolCalls) {
      const toolDecl = manifest.tools?.[call.tool];
      const summary = this.buildToolLogSummary(call, toolDecl);

      this.sessionStorage.appendLog(sessionId, {
        timestamp: Date.now(),
        type: 'tool_execution',
        summary,
      });
    }
  }

  /**
   * Validate a single log value against its logSchema field definition.
   * Returns the validated string representation, or null if non-conforming.
   *
   * TDPS enforcement: log values flow into the main agent's context via session
   * summaries, so every value must be validated against declared constraints.
   */
  private validateLogValue(value: unknown, fieldSchema: JSONSchema): string | null {
    if (value === undefined || value === null) return null;

    const type = fieldSchema.type;

    // Enum — check membership (works for any type)
    if (fieldSchema.enum) {
      return fieldSchema.enum.includes(value) ? String(value) : null;
    }

    // Integer
    if (type === 'integer') {
      return typeof value === 'number' && Number.isInteger(value) ? String(value) : null;
    }

    // Number
    if (type === 'number') {
      return typeof value === 'number' ? String(value) : null;
    }

    // Boolean
    if (type === 'boolean') {
      return typeof value === 'boolean' ? String(value) : null;
    }

    // String with constraints
    if (type === 'string') {
      if (typeof value !== 'string') return null;

      // Pattern — reject if no match
      if (fieldSchema.pattern) {
        const re = new RegExp(fieldSchema.pattern);
        if (!re.test(value)) return null;
      }

      // maxLength — truncate
      if (fieldSchema.maxLength && value.length > fieldSchema.maxLength) {
        return value.slice(0, fieldSchema.maxLength);
      }

      // format — allow through (format is a constraint marker, validated at manifest level)
      if (fieldSchema.format || fieldSchema.pattern || fieldSchema.maxLength) {
        return value;
      }

      // Unconstrained string — reject
      return null;
    }

    // Unknown type / no constraints — reject
    return null;
  }

  /**
   * Build a log summary string for a single tool call.
   * Uses logTemplate if available, otherwise falls back to generic format.
   *
   * TDPS enforcement: validates each placeholder value against logSchema before
   * filling. Non-conforming values are replaced with the literal placeholder.
   */
  private buildToolLogSummary(call: ToolCallRecord, toolDecl?: ToolDeclaration): string {
    if (!toolDecl?.logTemplate) {
      return `Called ${call.tool}`;
    }

    const template = toolDecl.logTemplate;
    const logSchema = toolDecl.logSchema;

    // Fill placeholders with validated output data
    return template.replace(/\{\{(\w+)\}\}/g, (_match, field: string) => {
      // No logSchema or field not in logSchema — safe fallback
      if (!logSchema || !logSchema[field]) {
        return `{{${field}}}`;
      }

      const value = call.output[field];
      const validated = this.validateLogValue(value, logSchema[field]);
      return validated !== null ? validated : `{{${field}}}`;
    });
  }

  /**
   * Build a summary of a handoff session from its log entries.
   */
  private buildSessionSummary(sessionId: string, manifest: TrikManifest): string {
    const session = this.sessionStorage.getSession(sessionId);
    if (!session || session.log.length === 0) {
      return `Handoff to ${manifest.name} (no activity logged)`;
    }

    const toolEntries = session.log.filter((e) => e.type === 'tool_execution');
    if (toolEntries.length === 0) {
      return `Handoff to ${manifest.name} (conversation only, no tools used)`;
    }

    const lines = toolEntries.map((e) => `- ${e.summary}`);
    return lines.join('\n');
  }

  // ==========================================================================
  // Context Building
  // ==========================================================================

  /**
   * Build the TrikContext passed to a trik agent on each message.
   */
  private buildTrikContext(sessionId: string, loaded: LoadedTrik): TrikContext {
    const configContext = this.configStore.getForTrik(loaded.manifest.id);
    const storageContext = this.storageProvider.forTrik(
      loaded.manifest.id,
      loaded.manifest.capabilities?.storage
    );

    const ctx: TrikContext = {
      sessionId,
      config: configContext,
      storage: storageContext,
    };

    // Include capabilities if the trik declares filesystem/shell
    if (loaded.manifest.capabilities) {
      const caps = loaded.manifest.capabilities;
      if (caps.filesystem?.enabled || caps.shell?.enabled) {
        ctx.capabilities = caps;
      }
    }

    return ctx;
  }

  /**
   * Check whether a manifest requires containerized execution.
   */
  private static needsContainerization(manifest: TrikManifest): boolean {
    const caps = manifest.capabilities;
    return !!(caps?.filesystem?.enabled || caps?.shell?.enabled);
  }

  // ==========================================================================
  // Trik Loading
  // ==========================================================================

  async loadTrik(trikPath: string): Promise<TrikManifest> {
    const manifestPath = join(trikPath, 'manifest.json');
    const manifestContent = await readFile(manifestPath, 'utf-8');
    const manifestData = JSON.parse(manifestContent);

    const validation = validateManifest(manifestData);
    if (!validation.valid) {
      throw new Error(`Invalid manifest at ${manifestPath}: ${validation.errors?.join(', ')}`);
    }

    const manifest = manifestData as TrikManifest;

    if (this.config.allowedTriks && !this.config.allowedTriks.includes(manifest.id)) {
      throw new Error(`Trik "${manifest.id}" is not in the allowlist`);
    }

    // Validate required config
    if (this.config.validateConfig !== false) {
      const missingKeys = this.configStore.validateConfig(manifest);
      if (missingKeys.length > 0) {
        console.warn(
          `[TrikGateway] Warning: trik "${manifest.id}" is missing required config: ${missingKeys.join(', ')}\n` +
          `  Add to .trikhub/secrets.json: { "${manifest.id}": { ${missingKeys.map(k => `"${k}": "..."`).join(', ')} } }`
        );
      }
    }

    const runtime: TrikRuntime = manifest.entry.runtime ?? 'node';
    const containerized = TrikGateway.needsContainerization(manifest);

    const isToolMode = manifest.agent.mode === 'tool';

    if (containerized) {
      // Containerized triks — always run inside Docker regardless of runtime
      const agent = this.createContainerAgentProxy(manifest, trikPath, runtime);
      this.triks.set(manifest.id, { manifest, agent, path: trikPath, runtime, containerized });
    } else if (runtime === 'python') {
      // Python triks use the worker protocol — create a proxy TrikAgent
      await this.ensurePythonWorker();
      const agent = this.createPythonAgentProxy(manifest, trikPath);
      this.triks.set(manifest.id, { manifest, agent, path: trikPath, runtime, containerized });
    } else {
      // Node triks — dynamic import and extract TrikAgent
      const modulePath = join(trikPath, manifest.entry.module);
      const moduleUrl = pathToFileURL(modulePath).href;
      const mod = await import(moduleUrl);

      const exportName = manifest.entry.export;
      const agent = mod[exportName] ?? mod.default;

      if (isToolMode) {
        // Tool-mode triks must implement executeTool()
        if (!agent || typeof agent.executeTool !== 'function') {
          throw new Error(
            `Trik "${manifest.id}" module does not export a valid tool-mode TrikAgent ` +
            `(expected export "${exportName}" with an executeTool method)`
          );
        }

        // Check for duplicate tool names across loaded tool-mode triks
        if (manifest.tools) {
          for (const toolName of Object.keys(manifest.tools)) {
            for (const [existingId, existingTrik] of this.triks) {
              if (existingTrik.manifest.agent.mode !== 'tool') continue;
              if (existingTrik.manifest.tools?.[toolName]) {
                throw new Error(
                  `Duplicate tool name "${toolName}": declared in both "${existingId}" and "${manifest.id}"`
                );
              }
            }
          }
        }
      } else {
        // Conversational triks must implement processMessage()
        if (!agent || typeof agent.processMessage !== 'function') {
          throw new Error(
            `Trik "${manifest.id}" module does not export a valid TrikAgent ` +
            `(expected export "${exportName}" with a processMessage method)`
          );
        }
      }

      this.triks.set(manifest.id, { manifest, agent: agent as TrikAgent, path: trikPath, runtime, containerized });
    }

    return manifest;
  }

  /**
   * Create a proxy TrikAgent for Python triks that delegates to the worker protocol.
   */
  private createPythonAgentProxy(manifest: TrikManifest, trikPath: string): TrikAgent {
    const agent: TrikAgent = {};

    if (manifest.agent.mode === 'conversational') {
      agent.processMessage = async (message: string, context: TrikContext): Promise<TrikResponse> => {
        const worker = await this.ensurePythonWorker();

        // Set storage context so the worker can proxy storage calls
        worker.setStorageContext(context.storage);
        try {
          const result = await worker.processMessage({
            trikPath,
            message,
            sessionId: context.sessionId,
            config: this.configToRecord(context.config),
            storageNamespace: manifest.id,
          });

          return {
            message: result.message,
            transferBack: result.transferBack,
            toolCalls: result.toolCalls,
          };
        } finally {
          worker.setStorageContext(null);
        }
      };
    }

    if (manifest.agent.mode === 'tool') {
      agent.executeTool = async (
        toolName: string,
        input: Record<string, unknown>,
        context: TrikContext
      ): Promise<ToolExecutionResult> => {
        const worker = await this.ensurePythonWorker();

        worker.setStorageContext(context.storage);
        try {
          const result = await worker.executeTool({
            trikPath,
            toolName,
            input,
            sessionId: context.sessionId,
            config: this.configToRecord(context.config),
            storageNamespace: manifest.id,
          });

          return { output: result.output };
        } finally {
          worker.setStorageContext(null);
        }
      };
    }

    return agent;
  }

  /**
   * Create a proxy TrikAgent for containerized triks that delegates to Docker containers.
   * The container is launched lazily on first interaction via the ContainerManager.
   */
  private createContainerAgentProxy(
    manifest: TrikManifest,
    trikPath: string,
    runtime: TrikRuntime
  ): TrikAgent {
    const agent: TrikAgent = {};

    if (manifest.agent.mode === 'conversational') {
      agent.processMessage = async (message: string, context: TrikContext): Promise<TrikResponse> => {
        const manager = this.ensureContainerManager();
        const workspacePath = manager.getWorkspacePath(manifest.id);
        const handle = await manager.launch(manifest.id, {
          runtime,
          workspacePath,
          trikPath: resolve(trikPath),
        });

        handle.setStorageContext(context.storage);
        try {
          const result = await handle.processMessage({
            trikPath,
            message,
            sessionId: context.sessionId,
            config: this.configToRecord(context.config),
            storageNamespace: manifest.id,
          });

          return {
            message: result.message,
            transferBack: result.transferBack,
            toolCalls: result.toolCalls,
          };
        } finally {
          handle.setStorageContext(null);
        }
      };
    }

    if (manifest.agent.mode === 'tool') {
      agent.executeTool = async (
        toolName: string,
        input: Record<string, unknown>,
        context: TrikContext
      ): Promise<ToolExecutionResult> => {
        const manager = this.ensureContainerManager();
        const workspacePath = manager.getWorkspacePath(manifest.id);
        const handle = await manager.launch(manifest.id, {
          runtime,
          workspacePath,
          trikPath: resolve(trikPath),
        });

        handle.setStorageContext(context.storage);
        try {
          const result = await handle.executeTool({
            trikPath,
            toolName,
            input,
            sessionId: context.sessionId,
            config: this.configToRecord(context.config),
            storageNamespace: manifest.id,
          });

          return { output: result.output };
        } finally {
          handle.setStorageContext(null);
        }
      };
    }

    return agent;
  }

  /**
   * Stop a trik's container if it is containerized and running.
   */
  private async stopContainerIfNeeded(trikId: string): Promise<void> {
    const loaded = this.triks.get(trikId);
    if (loaded?.containerized && this.containerManager) {
      await this.containerManager.stop(trikId);
    }
  }

  /**
   * Ensure container manager is initialized.
   */
  private ensureContainerManager(): DockerContainerManager {
    if (!this.containerManager) {
      this.containerManager = new DockerContainerManager(this.config.containerManagerConfig);
    }
    return this.containerManager;
  }

  /**
   * Convert TrikConfigContext to a plain Record for the worker protocol.
   */
  private configToRecord(config: TrikConfigContext): Record<string, string> {
    const record: Record<string, string> = {};
    for (const key of config.keys()) {
      const value = config.get(key);
      if (value !== undefined) {
        record[key] = value;
      }
    }
    return record;
  }

  /**
   * Ensure Python worker is started.
   */
  private async ensurePythonWorker(): Promise<PythonWorker> {
    if (!this.pythonWorker) {
      this.pythonWorker = new PythonWorker(this.config.pythonWorkerConfig);
    }
    if (!this.pythonWorker.ready) {
      await this.pythonWorker.start();
    }
    return this.pythonWorker;
  }

  /**
   * Shutdown all workers and containers.
   */
  async shutdown(): Promise<void> {
    if (this.pythonWorker) {
      await this.pythonWorker.shutdown();
      this.pythonWorker = null;
    }
    if (this.containerManager) {
      await this.containerManager.stopAll();
      this.containerManager = null;
    }
  }

  /**
   * Load all triks from a directory.
   * Supports scoped directory structure: directory/@scope/trik-name/
   */
  async loadTriksFromDirectory(directory: string): Promise<TrikManifest[]> {
    const resolvedDir = directory.startsWith('~')
      ? join(homedir(), directory.slice(1))
      : resolve(directory);

    const manifests: TrikManifest[] = [];
    const errors: Array<{ path: string; error: string }> = [];

    try {
      const entries = await readdir(resolvedDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const entryPath = join(resolvedDir, entry.name);

        if (entry.name.startsWith('@')) {
          const scopedEntries = await readdir(entryPath, { withFileTypes: true });

          for (const scopedEntry of scopedEntries) {
            if (!scopedEntry.isDirectory()) continue;

            const trikPath = join(entryPath, scopedEntry.name);
            const manifestPath = join(trikPath, 'manifest.json');

            try {
              const manifestStat = await stat(manifestPath);
              if (manifestStat.isFile()) {
                const manifest = await this.loadTrik(trikPath);
                manifests.push(manifest);
              }
            } catch (error) {
              errors.push({
                path: trikPath,
                error: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          }
        } else {
          const trikPath = entryPath;
          const manifestPath = join(trikPath, 'manifest.json');

          try {
            const manifestStat = await stat(manifestPath);
            if (manifestStat.isFile()) {
              const manifest = await this.loadTrik(trikPath);
              manifests.push(manifest);
            }
          } catch (error) {
            errors.push({
              path: trikPath,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(
          `Failed to read triks directory "${resolvedDir}": ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }
    }

    if (errors.length > 0) {
      console.warn(`[TrikGateway] Failed to load ${errors.length} trik(s):`);
      for (const { path, error } of errors) {
        console.warn(`  - ${path}: ${error}`);
      }
    }

    return manifests;
  }

  /**
   * Load triks from the configured triksDirectory (if set).
   */
  async loadInstalledTriks(): Promise<TrikManifest[]> {
    if (!this.config.triksDirectory) {
      return [];
    }
    return this.loadTriksFromDirectory(this.config.triksDirectory);
  }

  /**
   * Load triks from a config file (.trikhub/config.json).
   */
  async loadTriksFromConfig(options: LoadFromConfigOptions = {}): Promise<TrikManifest[]> {
    const configPath = options.configPath ?? join(process.cwd(), '.trikhub', 'config.json');
    const baseDir = options.baseDir ?? dirname(configPath);

    if (!existsSync(configPath)) {
      console.log(`[TrikGateway] No config file found at ${configPath}`);
      return [];
    }

    let config: TrikHubConfig;
    try {
      const configContent = await readFile(configPath, 'utf-8');
      config = JSON.parse(configContent);
    } catch (error) {
      throw new Error(
        `Failed to read config file "${configPath}": ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }

    if (!Array.isArray(config.triks)) {
      console.log('[TrikGateway] Config file has no triks array');
      return [];
    }

    const manifests: TrikManifest[] = [];
    const errors: Array<{ trik: string; error: string }> = [];

    const require = createRequire(join(baseDir, 'package.json'));
    const triksDir = join(dirname(configPath), 'triks');

    for (const trikName of config.triks) {
      try {
        let trikPath: string;
        let foundInNodeModules = false;

        try {
          const manifestPath = require.resolve(`${trikName}/manifest.json`);
          trikPath = dirname(manifestPath);
          foundInNodeModules = true;
        } catch {
          try {
            const packageMain = require.resolve(trikName);
            trikPath = dirname(packageMain);

            const manifestPath = join(trikPath, 'manifest.json');
            if (!existsSync(manifestPath)) {
              const parentManifest = join(dirname(trikPath), 'manifest.json');
              if (existsSync(parentManifest)) {
                trikPath = dirname(trikPath);
              } else {
                throw new Error(`Package "${trikName}" does not have a manifest.json`);
              }
            }
            foundInNodeModules = true;
          } catch {
            foundInNodeModules = false;
            trikPath = '';
          }
        }

        if (!foundInNodeModules) {
          const crossLangPath = join(triksDir, ...trikName.split('/'));

          const directManifest = join(crossLangPath, 'manifest.json');
          if (existsSync(directManifest)) {
            trikPath = crossLangPath;
          } else {
            const entries = existsSync(crossLangPath)
              ? await readdir(crossLangPath, { withFileTypes: true })
              : [];

            let foundInSubdir = false;
            for (const entry of entries) {
              if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_')) {
                const subManifest = join(crossLangPath, entry.name, 'manifest.json');
                if (existsSync(subManifest)) {
                  trikPath = join(crossLangPath, entry.name);
                  foundInSubdir = true;
                  break;
                }
              }
            }

            if (!foundInSubdir) {
              throw new Error(
                `Package "${trikName}" not found in node_modules or .trikhub/triks/`
              );
            }
          }
        }

        const manifest = await this.loadTrik(trikPath);
        manifests.push(manifest);
      } catch (error) {
        errors.push({
          trik: trikName,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    if (errors.length > 0) {
      console.warn(`[TrikGateway] Failed to load ${errors.length} trik(s) from config:`);
      for (const { trik, error } of errors) {
        console.warn(`  - ${trik}: ${error}`);
      }
    }

    if (manifests.length > 0) {
      console.log(`[TrikGateway] Loaded ${manifests.length} trik(s) from config`);
    }

    return manifests;
  }

  // ==========================================================================
  // Trik Queries
  // ==========================================================================

  getManifest(trikId: string): TrikManifest | undefined {
    return this.triks.get(trikId)?.manifest;
  }

  getLoadedTriks(): string[] {
    return Array.from(this.triks.keys());
  }

  isLoaded(trikId: string): boolean {
    return this.triks.has(trikId);
  }

  /**
   * Unload a trik from memory.
   */
  unloadTrik(trikId: string): boolean {
    return this.triks.delete(trikId);
  }
}
