import { randomUUID } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import {
  type TrikManifest,
  type TrikRuntime,
  type GatewayResult,
  type GatewaySuccessTemplate,
  type GatewaySuccessPassthrough,
  type ClarificationQuestion,
  type ClarificationAnswer,
  type ActionDefinition,
  type ResponseTemplate,
  type ResponseMode,
  type TrikSession,
  type PassthroughContent,
  type PassthroughDeliveryReceipt,
  type UserContentReference,
  type SessionHistoryEntry,
  type TrikConfigContext,
  type TrikStorageContext,
  validateManifest,
  SchemaValidator,
} from '@trikhub/manifest';
import { PythonWorker, type PythonWorkerConfig } from './python-worker.js';
import { type SessionStorage, InMemorySessionStorage } from './session-storage.js';
import { type ConfigStore, FileConfigStore } from './config-store.js';
import { type StorageProvider, JsonFileStorageProvider } from './storage-provider.js';

interface TrikInput {
  action: string;
  input: unknown;
  session?: {
    sessionId: string;
    history: SessionHistoryEntry[];
  };
  config?: TrikConfigContext;
  storage?: TrikStorageContext;
}

interface TrikOutput {
  responseMode: ResponseMode;
  agentData?: unknown;
  userContent?: PassthroughContent;
  endSession?: boolean;
  needsClarification?: boolean;
  clarificationQuestions?: ClarificationQuestion[];
}

interface TrikGraph {
  invoke(input: TrikInput): Promise<TrikOutput>;
}

export interface TrikGatewayConfig {
  allowedTriks?: string[];
  onClarificationNeeded?: (
    trikId: string,
    questions: ClarificationQuestion[]
  ) => Promise<ClarificationAnswer[]>;
  sessionStorage?: SessionStorage;
  /**
   * Directory containing installed triks (triks) for auto-discovery.
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
   * Defaults to JsonFileStorageProvider which stores data in ~/.trikhub/storage/
   */
  storageProvider?: StorageProvider;
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
}

export interface ExecuteTrikOptions {
  sessionId?: string;
}

export type GatewayResultWithSession<TAgent = unknown> = GatewayResult<TAgent> & {
  sessionId?: string;
};

interface LoadedTrik {
  manifest: TrikManifest;
  graph: TrikGraph | null; // null for Python triks (executed via worker)
  path: string;
  runtime: TrikRuntime;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: import('@trikhub/manifest').JSONSchema;
  responseMode: ResponseMode;
  isGatewayTool?: boolean;
}

export interface TrikInfo {
  id: string;
  name: string;
  description: string;
  tools: ToolDefinition[];
  sessionEnabled: boolean;
}

export interface GetToolDefinitionsOptions {
  includeReadContent?: boolean;
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

export class TrikGateway {
  private validator = new SchemaValidator();
  private config: TrikGatewayConfig;
  private sessionStorage: SessionStorage;
  private configStore: ConfigStore;
  private storageProvider: StorageProvider;
  private configLoaded = false;
  private pythonWorker: PythonWorker | null = null;

  // Loaded triks (by trik ID)
  private triks = new Map<string, LoadedTrik>();
  private contentReferences = new Map<string, UserContentReference>();
  private static CONTENT_REF_TTL_MS = 10 * 60 * 1000;

  constructor(config: TrikGatewayConfig = {}) {
    this.config = config;
    this.sessionStorage = config.sessionStorage ?? new InMemorySessionStorage();
    this.configStore = config.configStore ?? new FileConfigStore();
    this.storageProvider = config.storageProvider ?? new JsonFileStorageProvider();
  }

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

    const runtime: TrikRuntime = manifest.entry.runtime ?? 'node';

    if (runtime === 'python') {
      // Python triks are executed via the Python worker
      // We don't load the graph here, just register the manifest
      this.triks.set(manifest.id, { manifest, graph: null, path: trikPath, runtime });

      // Ensure Python worker is initialized
      await this.ensurePythonWorker();
    } else {
      // Node.js triks are loaded and executed in-process
      const modulePath = join(trikPath, manifest.entry.module);
      const moduleUrl = pathToFileURL(modulePath).href;
      const module = await import(moduleUrl);
      const graph = module[manifest.entry.export] as TrikGraph;

      if (!graph || typeof graph.invoke !== 'function') {
        throw new Error(
          `Invalid graph at ${modulePath}: export "${manifest.entry.export}" must have an invoke function`
        );
      }

      this.triks.set(manifest.id, { manifest, graph, path: trikPath, runtime });
    }

    return manifest;
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
   * Shutdown the Python worker if running.
   */
  async shutdown(): Promise<void> {
    if (this.pythonWorker) {
      await this.pythonWorker.shutdown();
      this.pythonWorker = null;
    }
  }

  /**
   * Load all triks from a directory.
   * Supports scoped directory structure: directory/@scope/trik-name/
   *
   * @param directory - Path to the directory containing triks.
   *                   Use '~' prefix for home directory (e.g., '~/.trikhub/triks')
   * @returns Array of successfully loaded manifests
   */
  async loadTriksFromDirectory(directory: string): Promise<TrikManifest[]> {
    // Resolve ~ to home directory
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

        // Check if this is a scoped directory (starts with @)
        if (entry.name.startsWith('@')) {
          // Scoped directory: @scope/trik-name structure
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
              // Trik failed to load, record error but continue
              errors.push({
                path: trikPath,
                error: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          }
        } else {
          // Non-scoped directory: direct trik-name structure
          const trikPath = entryPath;
          const manifestPath = join(trikPath, 'manifest.json');

          try {
            const manifestStat = await stat(manifestPath);
            if (manifestStat.isFile()) {
              const manifest = await this.loadTrik(trikPath);
              manifests.push(manifest);
            }
          } catch (error) {
            // Trik failed to load, record error but continue
            errors.push({
              path: trikPath,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }
      }
    } catch (error) {
      // Directory doesn't exist or isn't readable - not necessarily an error
      // (e.g., user hasn't installed any triks yet)
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(
          `Failed to read triks directory "${resolvedDir}": ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }
    }

    // Log errors for debugging (triks that failed to load)
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
   * This is a convenience method for loading the default TrikHub directory.
   */
  async loadInstalledTriks(): Promise<TrikManifest[]> {
    if (!this.config.triksDirectory) {
      return [];
    }
    return this.loadTriksFromDirectory(this.config.triksDirectory);
  }

  /**
   * Load triks from a config file (.trikhub/config.json).
   * Triks are resolved from node_modules based on the package names in config.
   *
   * Config file format:
   * ```json
   * {
   *   "triks": ["@molefas/article-search", "some-other-trik"]
   * }
   * ```
   *
   * @param options - Configuration options
   * @returns Array of successfully loaded manifests
   */
  async loadTriksFromConfig(options: LoadFromConfigOptions = {}): Promise<TrikManifest[]> {
    const configPath = options.configPath ?? join(process.cwd(), '.trikhub', 'config.json');
    const baseDir = options.baseDir ?? dirname(configPath);

    // Check if config file exists
    if (!existsSync(configPath)) {
      console.log(`[TrikGateway] No config file found at ${configPath}`);
      return [];
    }

    // Read and parse config
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

    // Create a require function relative to the base directory
    // This allows us to resolve packages from the project's node_modules
    const require = createRequire(join(baseDir, 'package.json'));

    for (const trikName of config.triks) {
      try {
        // Resolve the package path from node_modules
        // First, try to find the manifest.json in the package
        let trikPath: string;
        try {
          const manifestPath = require.resolve(`${trikName}/manifest.json`);
          trikPath = dirname(manifestPath);
        } catch {
          // Fall back to resolving the package main and getting its directory
          const packageMain = require.resolve(trikName);
          trikPath = dirname(packageMain);

          // Check if manifest.json exists in the package root
          const manifestPath = join(trikPath, 'manifest.json');
          if (!existsSync(manifestPath)) {
            // Try going up one level (for packages with dist/ structure)
            const parentManifest = join(dirname(trikPath), 'manifest.json');
            if (existsSync(parentManifest)) {
              trikPath = dirname(trikPath);
            } else {
              throw new Error(`Package "${trikName}" does not have a manifest.json`);
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

    // Log errors for debugging
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

  getManifest(trikId: string): TrikManifest | undefined {
    return this.triks.get(trikId)?.manifest;
  }

  getLoadedTriks(): string[] {
    return Array.from(this.triks.keys());
  }

  isLoaded(trikId: string): boolean {
    return this.triks.has(trikId);
  }

  getAvailableTriks(): TrikInfo[] {
    return Array.from(this.triks.values()).map(({ manifest }) => ({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      sessionEnabled: manifest.capabilities?.session?.enabled ?? false,
      tools: Object.entries(manifest.actions).map(([actionName, action]) =>
        this.actionToToolDefinition(manifest.id, actionName, action)
      ),
    }));
  }

  getToolDefinitions(_options: GetToolDefinitionsOptions = {}): ToolDefinition[] {
    const tools: ToolDefinition[] = [];

    for (const { manifest } of this.triks.values()) {
      for (const [actionName, action] of Object.entries(manifest.actions)) {
        const tool = this.actionToToolDefinition(manifest.id, actionName, action);
        tools.push(tool);
      }
    }

    return tools;
  }

  private actionToToolDefinition(
    trikId: string,
    actionName: string,
    action: ActionDefinition
  ): ToolDefinition {
    return {
      name: `${trikId}:${actionName}`,
      description: action.description || `Execute ${actionName} on ${trikId}`,
      inputSchema: action.inputSchema,
      responseMode: action.responseMode,
    };
  }

  async execute<TAgent = unknown>(
    trikId: string,
    actionName: string,
    input: unknown,
    options?: ExecuteTrikOptions
  ): Promise<GatewayResultWithSession<TAgent>> {
    const loaded = this.triks.get(trikId);
    if (!loaded) {
      return {
        success: false,
        code: 'TRIK_NOT_FOUND',
        error: `Trik "${trikId}" is not loaded. Call loadTrik() first.`,
      };
    }

    const { manifest, graph, path: trikPath, runtime } = loaded;

    const action = manifest.actions[actionName];
    if (!action) {
      return {
        success: false,
        code: 'INVALID_INPUT',
        error: `Action "${actionName}" not found. Available: ${Object.keys(manifest.actions).join(', ')}`,
      };
    }

    const inputValidation = this.validator.validate(
      `${trikId}:${actionName}:input`,
      action.inputSchema,
      input
    );
    if (!inputValidation.valid) {
      return {
        success: false,
        code: 'INVALID_INPUT',
        error: `Invalid input: ${inputValidation.errors?.join(', ')}`,
      };
    }

    let session: TrikSession | null = null;
    if (manifest.capabilities?.session?.enabled) {
      if (options?.sessionId) {
        session = await this.sessionStorage.get(options.sessionId);
      }
      if (!session) {
        session = await this.sessionStorage.create(trikId, manifest.capabilities.session);
      }
    }

    try {
      // Get config context for this trik
      const configContext = this.configStore.getForTrik(trikId);

      // Get storage context if storage is enabled
      const storageContext = manifest.capabilities?.storage?.enabled
        ? this.storageProvider.forTrik(trikId, manifest.capabilities.storage)
        : undefined;

      let result: TrikOutput;

      if (runtime === 'python') {
        // Execute via Python worker
        const worker = await this.ensurePythonWorker();
        const invokeResult = await worker.invoke(trikPath, actionName, input, {
          session: session
            ? {
                sessionId: session.sessionId,
                history: session.history,
              }
            : undefined,
          config: configContext,
          storage: storageContext,
        });

        // Convert InvokeResult to TrikOutput
        result = {
          responseMode: invokeResult.responseMode ?? action.responseMode,
          agentData: invokeResult.agentData,
          userContent: invokeResult.userContent,
          endSession: invokeResult.endSession,
          needsClarification: invokeResult.needsClarification,
          clarificationQuestions: invokeResult.clarificationQuestions,
        };
      } else {
        // Execute Node.js trik in-process
        if (!graph) {
          return {
            success: false,
            code: 'EXECUTION_ERROR',
            error: 'Graph not loaded for Node.js trik',
          };
        }

        const trikInput: TrikInput = {
          action: actionName,
          input,
          session: session
            ? {
                sessionId: session.sessionId,
                history: session.history,
              }
            : undefined,
          config: configContext,
          storage: storageContext,
        };

        result = await this.executeWithTimeout(
          graph,
          trikInput,
          manifest.limits.maxExecutionTimeMs
        );
      }

      if (result.needsClarification && result.clarificationQuestions?.length) {
        if (this.config.onClarificationNeeded) {
          await this.config.onClarificationNeeded(trikId, result.clarificationQuestions);
        }

        return {
          success: false,
          code: 'CLARIFICATION_NEEDED',
          sessionId: session?.sessionId ?? '',
          questions: result.clarificationQuestions,
        };
      }

      return this.processResult<TAgent>(trikId, actionName, action, session, result);
    } catch (error) {
      if (error instanceof Error && error.message === 'TIMEOUT') {
        return {
          success: false,
          code: 'TIMEOUT',
          error: `Execution timed out after ${manifest.limits.maxExecutionTimeMs}ms`,
        };
      }

      return {
        success: false,
        code: 'EXECUTION_ERROR',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async executeWithTimeout(
    graph: TrikGraph,
    input: TrikInput,
    timeoutMs: number
  ): Promise<TrikOutput> {
    return Promise.race([
      graph.invoke(input),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)),
    ]);
  }

  private async processResult<TAgent>(
    trikId: string,
    actionName: string,
    action: ActionDefinition,
    session: TrikSession | null,
    result: TrikOutput
  ): Promise<GatewayResultWithSession<TAgent>> {
    const effectiveMode: ResponseMode = result.responseMode || action.responseMode;

    if (session) {
      if (result.endSession) {
        await this.sessionStorage.delete(session.sessionId);
        session = null;
      } else {
        await this.sessionStorage.addHistory(session.sessionId, {
          action: actionName,
          input: {},
          agentData: result.agentData,
          userContent: result.userContent,
        });
      }
    }

    if (effectiveMode === 'passthrough') {
      if (result.userContent === undefined) {
        return { success: false, code: 'INVALID_OUTPUT', error: 'Passthrough mode requires userContent' };
      }

      if (action.userContentSchema) {
        const userValidation = this.validator.validate(
          `${trikId}:${actionName}:userContent`,
          action.userContentSchema,
          result.userContent
        );

        if (!userValidation.valid) {
          return {
            success: false,
            code: 'INVALID_OUTPUT',
            error: `Invalid userContent: ${userValidation.errors?.join(', ')}`,
          };
        }
      }

      const userContent = result.userContent;
      const contentRef = this.storePassthroughContent(trikId, actionName, userContent);

      const gatewayResult: GatewaySuccessPassthrough = {
        success: true,
        responseMode: 'passthrough',
        userContentRef: contentRef,
        contentType: userContent.contentType,
        metadata: userContent.metadata,
      };

      return this.addSessionId(gatewayResult, session);
    }

    if (result.agentData === undefined) {
      return { success: false, code: 'INVALID_OUTPUT', error: 'Template mode requires agentData' };
    }

    if (action.agentDataSchema) {
      const agentValidation = this.validator.validate(
        `${trikId}:${actionName}:agentData`,
        action.agentDataSchema,
        result.agentData
      );

      if (!agentValidation.valid) {
        return {
          success: false,
          code: 'INVALID_OUTPUT',
          error: `Invalid agentData: ${agentValidation.errors?.join(', ')}`,
        };
      }
    }

    // Get template text if available
    const agentData = result.agentData as Record<string, unknown>;
    const templateId = agentData.template as string | undefined;
    const templateText = templateId && action.responseTemplates?.[templateId]?.text;

    const gatewayResult: GatewaySuccessTemplate<TAgent> = {
      success: true,
      responseMode: 'template',
      agentData: result.agentData as TAgent,
      templateText,
    };

    return this.addSessionId(gatewayResult, session);
  }

  /**
   * Add sessionId to result if session exists
   */
  private addSessionId<T extends GatewayResult>(
    result: T,
    session: TrikSession | null
  ): T & { sessionId?: string } {
    if (session) {
      return { ...result, sessionId: session.sessionId };
    }
    return result;
  }

  // ============================================
  // Passthrough Content Management
  // ============================================

  /**
   * Store passthrough content and return a reference
   */
  private storePassthroughContent(
    trikId: string,
    actionName: string,
    content: PassthroughContent
  ): string {
    this.cleanupExpiredContentReferences();

    const ref = randomUUID();
    const now = Date.now();

    this.contentReferences.set(ref, {
      ref,
      trikId,
      actionName,
      content,
      createdAt: now,
      expiresAt: now + TrikGateway.CONTENT_REF_TTL_MS,
    });

    return ref;
  }

  /**
   * Clean up expired content references
   */
  private cleanupExpiredContentReferences(): void {
    const now = Date.now();
    for (const [ref, contentRef] of this.contentReferences) {
      if (contentRef.expiresAt < now) {
        this.contentReferences.delete(ref);
      }
    }
  }

  /**
   * Deliver passthrough content to the user.
   * One-time delivery - the reference is deleted after delivery.
   */
  deliverContent(ref: string): {
    content: PassthroughContent;
    receipt: PassthroughDeliveryReceipt;
  } | null {
    const contentRef = this.contentReferences.get(ref);

    if (!contentRef) {
      return null;
    }

    if (contentRef.expiresAt < Date.now()) {
      this.contentReferences.delete(ref);
      return null;
    }

    // One-time delivery
    this.contentReferences.delete(ref);

    return {
      content: contentRef.content,
      receipt: {
        delivered: true,
        contentType: contentRef.content.contentType,
        metadata: contentRef.content.metadata,
      },
    };
  }

  hasContentRef(ref: string): boolean {
    const contentRef = this.contentReferences.get(ref);
    if (!contentRef) return false;
    if (contentRef.expiresAt < Date.now()) {
      this.contentReferences.delete(ref);
      return false;
    }
    return true;
  }

  getContentRefInfo(ref: string): { contentType: string; metadata?: Record<string, unknown> } | null {
    const contentRef = this.contentReferences.get(ref);
    if (!contentRef || contentRef.expiresAt < Date.now()) {
      return null;
    }
    return {
      contentType: contentRef.content.contentType,
      metadata: contentRef.content.metadata,
    };
  }

  resolveTemplate(template: ResponseTemplate, agentData: Record<string, unknown>): string {
    let text = template.text;

    const placeholderRegex = /\{\{(\w+)\}\}/g;
    text = text.replace(placeholderRegex, (_, fieldName) => {
      const value = agentData[fieldName];
      return value !== undefined ? String(value) : `{{${fieldName}}}`;
    });

    return text;
  }

  getActionTemplates(trikId: string, actionName: string): Record<string, ResponseTemplate> | undefined {
    const manifest = this.triks.get(trikId)?.manifest;
    if (!manifest) return undefined;

    const action = manifest.actions[actionName];
    if (!action) return undefined;

    return action.responseTemplates;
  }
}
