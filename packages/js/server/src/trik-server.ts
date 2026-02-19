import type { FastifyInstance } from 'fastify';
import type { TrikGateway } from '@trikhub/gateway';
import { FileConfigStore } from '@trikhub/gateway';
import { createServer } from './server.js';
import { SkillLoader, type LoadResult } from './services/skill-loader.js';

/**
 * Server lifecycle states
 */
export type ServerState = 'created' | 'initialized' | 'running' | 'stopped';

/**
 * Options for creating a TrikServer instance
 */
export interface TrikServerOptions {
  /** Server port (default: 3000) */
  port?: number;

  /** Server host (default: 0.0.0.0) */
  host?: string;

  /** Path to .trikhub/config.json for loading npm-installed triks */
  configPath?: string;

  /** Base directory for resolving node_modules. Defaults to dirname of configPath. */
  baseDir?: string;

  /** Directory containing local trik files */
  skillsDirectory?: string;

  /** Path to secrets.json (derived from configPath if not set) */
  secretsPath?: string;

  /** Bearer token for API authentication */
  authToken?: string;

  /** Log level */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';

  /** Lint triks before loading (default: true) */
  lintOnLoad?: boolean;

  /** Treat lint warnings as errors (default: false) */
  lintWarningsAsErrors?: boolean;

  /** Allowlist of trik IDs (optional) */
  allowedSkills?: string[];
}

/**
 * Events emitted by TrikServer
 */
export interface TrikServerEvents {
  initialized: () => void;
  started: (url: string) => void;
  stopped: () => void;
  error: (error: Error) => void;
  trikLoaded: (trikId: string) => void;
  trikFailed: (trikId: string, error: string) => void;
}

/**
 * TrikServer - HTTP server for TrikHub skill execution
 *
 * Provides a clean lifecycle API:
 * - create → initialize → start → stop
 *
 * @example
 * ```typescript
 * import { TrikServer } from '@trikhub/server';
 *
 * const server = new TrikServer({
 *   configPath: '.trikhub/config.json',
 *   port: 3000,
 * });
 *
 * // Initialize and start
 * await server.run();
 *
 * // Or step by step:
 * await server.initialize();
 * await server.start();
 *
 * // Graceful shutdown
 * await server.stop();
 * ```
 */
export class TrikServer {
  private readonly options: Required<
    Pick<TrikServerOptions, 'port' | 'host' | 'logLevel' | 'lintOnLoad' | 'lintWarningsAsErrors'>
  > &
    TrikServerOptions;

  private skillLoader: SkillLoader | null = null;
  private gateway: TrikGateway | null = null;
  private fastify: FastifyInstance | null = null;
  private _state: ServerState = 'created';
  private loadResult: LoadResult | null = null;

  constructor(options: TrikServerOptions = {}) {
    this.options = {
      port: 3000,
      host: '0.0.0.0',
      logLevel: 'info',
      lintOnLoad: true,
      lintWarningsAsErrors: false,
      ...options,
    };
  }

  /**
   * Current server state
   */
  get state(): ServerState {
    return this._state;
  }

  /**
   * Server URL (only available after start)
   */
  get url(): string | null {
    if (this._state !== 'running') return null;
    return `http://${this.options.host}:${this.options.port}`;
  }

  /**
   * The underlying TrikGateway (only available after initialize)
   */
  getGateway(): TrikGateway | null {
    return this.gateway;
  }

  /**
   * The underlying Fastify instance (only available after initialize)
   */
  getFastify(): FastifyInstance | null {
    return this.fastify;
  }

  /**
   * Results from trik loading (only available after initialize)
   */
  getLoadResult(): LoadResult | null {
    return this.loadResult;
  }

  /**
   * Initialize the server: load secrets, discover and load triks, create HTTP server.
   *
   * @throws Error if already initialized
   */
  async initialize(): Promise<void> {
    if (this._state !== 'created') {
      throw new Error(`Cannot initialize: server is in '${this._state}' state (expected 'created')`);
    }

    // Create skill loader (which creates gateway and config store)
    this.skillLoader = new SkillLoader({
      skillsDirectory: this.options.skillsDirectory,
      configPath: this.options.configPath,
      baseDir: this.options.baseDir,
      secretsPath: this.options.secretsPath,
      lintBeforeLoad: this.options.lintOnLoad,
      lintWarningsAsErrors: this.options.lintWarningsAsErrors,
      allowedSkills: this.options.allowedSkills,
    });

    this.gateway = this.skillLoader.getGateway();

    // Load secrets (this is the step that was being forgotten!)
    const configStore = this.gateway.getConfigStore();
    await configStore.load();

    const configuredTriks = configStore.getConfiguredTriks();
    if (configuredTriks.length > 0) {
      console.log('[TrikServer] Secrets loaded for:', configuredTriks.join(', '));
    }

    // Create Fastify server
    this.fastify = await createServer(
      {
        port: this.options.port,
        host: this.options.host,
        skillsDirectory: this.options.skillsDirectory,
        configPath: this.options.configPath,
        allowedSkills: this.options.allowedSkills,
        lintOnLoad: this.options.lintOnLoad,
        lintWarningsAsErrors: this.options.lintWarningsAsErrors,
        authToken: this.options.authToken,
        logLevel: this.options.logLevel,
      },
      this.gateway
    );

    // Discover and load triks
    this.loadResult = await this.skillLoader.discoverAndLoad();

    this.fastify.log.info(
      {
        loaded: this.loadResult.loaded,
        failed: this.loadResult.failed,
      },
      'Triks discovery complete'
    );

    for (const skill of this.loadResult.skills) {
      if (skill.status === 'loaded') {
        this.fastify.log.info({ trikId: skill.skillId }, 'Trik loaded');
      } else {
        this.fastify.log.warn(
          { trikId: skill.skillId, path: skill.path, error: skill.error },
          'Trik failed to load'
        );
      }
    }

    this._state = 'initialized';
  }

  /**
   * Start listening for HTTP requests.
   *
   * @throws Error if not initialized
   */
  async start(): Promise<void> {
    if (this._state !== 'initialized') {
      throw new Error(`Cannot start: server is in '${this._state}' state (expected 'initialized')`);
    }

    if (!this.fastify) {
      throw new Error('Fastify instance not available');
    }

    await this.fastify.listen({ port: this.options.port, host: this.options.host });
    this.fastify.log.info({ url: this.url }, 'Server listening');

    this._state = 'running';
  }

  /**
   * Convenience method: initialize + start in one call.
   */
  async run(): Promise<void> {
    await this.initialize();
    await this.start();
  }

  /**
   * Gracefully stop the server.
   */
  async stop(): Promise<void> {
    if (this._state === 'stopped') {
      return; // Already stopped
    }

    if (this.fastify) {
      this.fastify.log.info('Stopping server...');
      await this.fastify.close();
      this.fastify.log.info('Server stopped');
    }

    // Shutdown Python worker if running
    if (this.gateway) {
      await this.gateway.shutdown();
    }

    this._state = 'stopped';
  }

  /**
   * Register signal handlers for graceful shutdown.
   * Call this when running as a standalone process.
   */
  registerSignalHandlers(): void {
    const shutdown = async (signal: string) => {
      if (this.fastify) {
        this.fastify.log.info({ signal }, 'Received shutdown signal');
      }
      await this.stop();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }
}
