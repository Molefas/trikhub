/**
 * Container Manager - Docker container lifecycle management for containerized triks
 *
 * Manages Docker containers that run trik workers with filesystem and shell capabilities.
 * Each containerized trik gets its own container with:
 *   - /workspace mounted (read-write) for filesystem operations
 *   - /trik mounted (read-only) for trik source code
 *   - JSON-RPC 2.0 communication over stdin/stdout (same protocol as PythonWorker)
 *
 * The ContainerWorkerHandle implements the same interface as PythonWorker,
 * allowing the gateway to treat containerized triks identically to regular ones.
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { EventEmitter } from 'node:events';
import type { TrikStorageContext } from '@trikhub/manifest';
import {
  createHealthRequest,
  createShutdownRequest,
  createProcessMessageRequest,
  createExecuteToolRequest,
  createSuccessResponse,
  createErrorResponse,
  parseMessage,
  isResponse,
  serializeMessage,
  WorkerErrorCodes,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type HealthResult,
  type ProcessMessageInput,
  type ProcessMessageResult,
  type ExecuteToolInput,
  type ExecuteToolResult,
  type StorageMethod,
} from './worker-protocol.js';

// ============================================================================
// Types
// ============================================================================

export interface ContainerOptions {
  /** Runtime environment: 'node' or 'python' */
  runtime: 'node' | 'python';
  /** Host path to mount as /workspace (read-write) */
  workspacePath: string;
  /** Host path to trik source, mounted as /trik (read-only) */
  trikPath: string;
  /** Whether network access is enabled (default: true) */
  networkEnabled?: boolean;
  /** Memory limit in MB (default: 512) */
  memoryLimitMb?: number;
  /** CPU limit as fraction (e.g., 1.0 = 1 CPU, 0.5 = half CPU) */
  cpuLimit?: number;
  /** Ports to expose from container to host (e.g., [3000, 8080]) */
  exposePorts?: number[];
}

export interface ContainerManagerConfig {
  /** Base directory for workspace directories (default: ~/.trikhub/workspace) */
  workspaceBaseDir?: string;
  /** Timeout for container startup in ms (default: 30000) */
  startupTimeoutMs?: number;
  /** Timeout for invoke requests in ms (default: 120000) */
  invokeTimeoutMs?: number;
  /** Whether to enable debug logging */
  debug?: boolean;
}

/** Docker image tags for each runtime */
const WORKER_IMAGES = {
  node: 'trikhub/worker-node:22',
  python: 'trikhub/worker-python:3.12',
} as const;

type PendingRequest = {
  resolve: (response: JsonRpcResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

// ============================================================================
// ContainerWorkerHandle - wraps a Docker container as a WorkerHandle
// ============================================================================

/**
 * A worker handle that wraps a Docker container.
 * Implements the same interface as PythonWorker for gateway compatibility.
 */
export class ContainerWorkerHandle extends EventEmitter {
  private process: ChildProcess | null = null;
  private readline: Interface | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private isReady = false;
  private stderrBuffer: string[] = [];
  private currentStorageContext: TrikStorageContext | null = null;

  private containerId: string | null = null;
  private readonly containerName: string;

  constructor(
    private readonly trikId: string,
    private readonly options: ContainerOptions,
    private readonly config: Required<ContainerManagerConfig>,
  ) {
    super();
    // Use a deterministic container name for easy management
    this.containerName = `trikhub-${trikId.replace(/[^a-z0-9-]/gi, '-')}`;
  }

  /**
   * Start the container and wait for the worker to be ready.
   */
  async start(): Promise<void> {
    if (this.process) {
      throw new Error(`Container already started for trik ${this.trikId}`);
    }

    // Remove any stale container with the same name (e.g. from a previous crash)
    try {
      execSync(`docker rm -f ${this.containerName} 2>/dev/null`, { stdio: 'ignore' });
    } catch {
      // No stale container — expected
    }

    // Ensure workspace directory exists on host
    if (!existsSync(this.options.workspacePath)) {
      mkdirSync(this.options.workspacePath, { recursive: true });
    }

    const image = WORKER_IMAGES[this.options.runtime];

    // Build docker run arguments
    const args = ['run', '-i', '--rm'];

    // Container name for management
    args.push('--name', this.containerName);

    // Volume mounts
    args.push('-v', `${this.options.workspacePath}:/workspace`);
    args.push('-v', `${this.options.trikPath}:/trik:ro`);

    // Resource limits
    const memoryMb = this.options.memoryLimitMb ?? 512;
    args.push(`--memory=${memoryMb}m`);

    if (this.options.cpuLimit) {
      args.push(`--cpus=${this.options.cpuLimit}`);
    }

    // Network
    if (this.options.networkEnabled === false) {
      args.push('--network=none');
    }

    // Expose ports for dev servers, preview, etc.
    if (this.options.exposePorts) {
      for (const port of this.options.exposePorts) {
        if (port < 1024) {
          throw new Error(
            `Privileged port ${port} cannot be exposed. Only ports 1024-65535 are allowed.`
          );
        }
        args.push('-p', `${port}:${port}`);
      }
    }

    // TrikHub label for container identification
    args.push('--label', 'trikhub.trik-id=' + this.trikId);
    args.push('--label', 'trikhub.managed=true');

    // Image
    args.push(image);

    return new Promise((resolveStart, rejectStart) => {
      const startupTimeout = setTimeout(() => {
        const stderrOutput = this.stderrBuffer.join('\n');
        this.kill();
        const errorSuffix = stderrOutput ? `\nStderr: ${stderrOutput}` : '';
        rejectStart(new Error(
          `Container startup timed out after ${this.config.startupTimeoutMs}ms for trik ${this.trikId}${errorSuffix}`
        ));
      }, this.config.startupTimeoutMs);

      if (this.config.debug) {
        console.log(`[ContainerManager] docker ${args.join(' ')}`);
      }

      // Spawn docker run with stdin/stdout attached
      this.process = spawn('docker', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Collect stderr
      this.stderrBuffer = [];
      this.process.stderr?.on('data', (data: Buffer) => {
        const message = data.toString().trim();
        if (message) {
          this.stderrBuffer.push(message);
          if (this.config.debug) {
            console.error(`[Container:${this.trikId}:stderr] ${message}`);
          }
        }
        this.emit('stderr', message);
      });

      // Handle process errors (e.g., docker not found)
      this.process.on('error', (error) => {
        clearTimeout(startupTimeout);
        this.emit('error', error);
        const msg = error.message.includes('ENOENT')
          ? 'Docker is not installed or not in PATH. Install Docker to use containerized triks.'
          : `Failed to start container for trik ${this.trikId}: ${error.message}`;
        rejectStart(new Error(msg));
      });

      // Handle container exit
      this.process.on('exit', (code, signal) => {
        this.isReady = false;
        this.process = null;
        this.readline = null;
        this.containerId = null;

        const stderrOutput = this.stderrBuffer.join('\n');
        const errorSuffix = stderrOutput ? `\nStderr: ${stderrOutput}` : '';

        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests) {
          clearTimeout(pending.timeout);
          pending.reject(new Error(
            `Container exited (code: ${code}, signal: ${signal}) for trik ${this.trikId}${errorSuffix}`
          ));
          this.pendingRequests.delete(id);
        }

        this.emit('exit', code, signal);
      });

      // Set up line-based reading from container stdout
      this.readline = createInterface({
        input: this.process.stdout!,
        crlfDelay: Infinity,
      });

      this.readline.on('line', (line) => {
        this.handleLine(line);
      });

      // Send health check to verify worker inside container is ready
      this.sendRequest(createHealthRequest())
        .then((response) => {
          clearTimeout(startupTimeout);
          if (response.error) {
            rejectStart(new Error(`Container health check failed for trik ${this.trikId}: ${response.error.message}`));
            return;
          }
          const result = response.result as HealthResult;
          if (result.status !== 'ok') {
            rejectStart(new Error(`Container health check failed for trik ${this.trikId}`));
            return;
          }
          this.isReady = true;
          this.emit('ready', result);
          resolveStart();
        })
        .catch((error) => {
          clearTimeout(startupTimeout);
          rejectStart(error);
        });
    });
  }

  /**
   * Check worker health inside the container.
   */
  async health(): Promise<HealthResult> {
    if (!this.process) {
      throw new Error(`Container not running for trik ${this.trikId}`);
    }
    const response = await this.sendRequest(createHealthRequest());
    if (response.error) {
      throw new Error(`Health check failed: ${response.error.message}`);
    }
    return response.result as HealthResult;
  }

  /**
   * Gracefully shutdown the container.
   */
  async shutdown(gracePeriodMs = 5000): Promise<void> {
    if (!this.process) return;

    try {
      const request = createShutdownRequest(gracePeriodMs);
      await this.sendRequest(request, gracePeriodMs + 1000);
    } catch {
      // Ignore errors during shutdown
    }

    this.kill();
  }

  /**
   * Force kill the container.
   */
  kill(): void {
    if (this.process) {
      this.process.kill('SIGKILL');
      this.process = null;
      this.readline = null;
      this.isReady = false;
    }

    // Also stop the docker container by name (in case the process detached)
    try {
      execSync(`docker rm -f ${this.containerName} 2>/dev/null`, { stdio: 'ignore' });
    } catch {
      // Container may already be removed
    }

    this.stderrBuffer = [];
  }

  /** Check if the container worker is ready. */
  get ready(): boolean {
    return this.isReady;
  }

  /**
   * Set the storage context for subsequent calls.
   */
  setStorageContext(context: TrikStorageContext | null): void {
    this.currentStorageContext = context;
  }

  /**
   * Send a processMessage request to the worker inside the container.
   */
  async processMessage(input: ProcessMessageInput): Promise<ProcessMessageResult> {
    if (!this.process) {
      throw new Error(`Container not running for trik ${this.trikId}`);
    }

    // Override trikPath to the container-internal path
    const containerInput: ProcessMessageInput = {
      ...input,
      trikPath: '/trik',
    };

    const request = createProcessMessageRequest(containerInput);
    const response = await this.sendRequest(request);

    if (response.error) {
      throw new Error(`processMessage failed in container: ${response.error.message}`);
    }

    return response.result as ProcessMessageResult;
  }

  /**
   * Send an executeTool request to the worker inside the container.
   */
  async executeTool(input: ExecuteToolInput): Promise<ExecuteToolResult> {
    if (!this.process) {
      throw new Error(`Container not running for trik ${this.trikId}`);
    }

    // Override trikPath to the container-internal path
    const containerInput: ExecuteToolInput = {
      ...input,
      trikPath: '/trik',
    };

    const request = createExecuteToolRequest(containerInput);
    const response = await this.sendRequest(request);

    if (response.error) {
      throw new Error(`executeTool failed in container: ${response.error.message}`);
    }

    return response.result as ExecuteToolResult;
  }

  // ============================================================================
  // Private — JSON-RPC communication (mirrors PythonWorker exactly)
  // ============================================================================

  private handleLine(line: string): void {
    if (!line.trim()) return;

    if (this.config.debug) {
      console.log(`[Container:${this.trikId}:recv] ${line}`);
    }

    try {
      const message = parseMessage(line);

      if (isResponse(message)) {
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(message.id);
          pending.resolve(message);
        }
      } else {
        // Handle incoming requests from worker (e.g., storage proxy)
        this.handleWorkerRequest(message as JsonRpcRequest);
      }
    } catch (error) {
      if (this.config.debug) {
        console.error(`[Container:${this.trikId}] Failed to parse message: ${line}`);
      }
      this.emit('parse-error', error, line);
    }
  }

  private async handleWorkerRequest(request: JsonRpcRequest): Promise<void> {
    const method = request.method as StorageMethod;

    if (method.startsWith('storage.')) {
      await this.handleStorageRequest(request);
    } else {
      const response = createErrorResponse(
        request.id,
        WorkerErrorCodes.METHOD_NOT_FOUND,
        `Unknown method: ${method}`
      );
      this.sendLine(serializeMessage(response));
    }
  }

  private async handleStorageRequest(request: JsonRpcRequest): Promise<void> {
    if (!this.currentStorageContext) {
      const response = createErrorResponse(
        request.id,
        WorkerErrorCodes.STORAGE_ERROR,
        'Storage not available'
      );
      this.sendLine(serializeMessage(response));
      return;
    }

    const method = request.method as StorageMethod;
    const params = (request.params as Record<string, unknown>) ?? {};

    try {
      let result: Record<string, unknown>;

      switch (method) {
        case 'storage.get': {
          const value = await this.currentStorageContext.get((params.key as string) ?? '');
          result = { value };
          break;
        }
        case 'storage.set': {
          await this.currentStorageContext.set(
            (params.key as string) ?? '',
            params.value,
            params.ttl as number | undefined
          );
          result = { success: true };
          break;
        }
        case 'storage.delete': {
          const deleted = await this.currentStorageContext.delete((params.key as string) ?? '');
          result = { deleted };
          break;
        }
        case 'storage.list': {
          const keys = await this.currentStorageContext.list(params.prefix as string | undefined);
          result = { keys };
          break;
        }
        case 'storage.getMany': {
          const valuesMap = await this.currentStorageContext.getMany((params.keys as string[]) ?? []);
          const values: Record<string, unknown> = {};
          for (const [k, v] of valuesMap) {
            values[k] = v;
          }
          result = { values };
          break;
        }
        case 'storage.setMany': {
          await this.currentStorageContext.setMany((params.entries as Record<string, unknown>) ?? {});
          result = { success: true };
          break;
        }
        default: {
          const response = createErrorResponse(
            request.id,
            WorkerErrorCodes.METHOD_NOT_FOUND,
            `Unknown storage method: ${method}`
          );
          this.sendLine(serializeMessage(response));
          return;
        }
      }

      this.sendLine(serializeMessage(createSuccessResponse(request.id, result)));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.sendLine(serializeMessage(
        createErrorResponse(request.id, WorkerErrorCodes.STORAGE_ERROR, `Storage error: ${errorMessage}`)
      ));
    }
  }

  private sendRequest(
    request: JsonRpcRequest,
    timeoutMs = this.config.invokeTimeoutMs
  ): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error('Container stdin not available'));
        return;
      }

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error(`Request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(request.id, { resolve, reject, timeout });

      const line = serializeMessage(request);
      if (this.config.debug) {
        console.log(`[Container:${this.trikId}:send] ${line}`);
      }

      this.process.stdin.write(line + '\n', (error) => {
        if (error) {
          clearTimeout(timeout);
          this.pendingRequests.delete(request.id);
          reject(error);
        }
      });
    });
  }

  private sendLine(line: string): void {
    if (this.process?.stdin?.writable) {
      this.process.stdin.write(line + '\n');
    }
  }
}

// ============================================================================
// ContainerManager - manages container lifecycle for all containerized triks
// ============================================================================

/**
 * Manages Docker container lifecycle for containerized triks.
 *
 * Each containerized trik gets its own container, launched on first interaction
 * and stopped when the handoff ends or the session expires.
 */
export class DockerContainerManager {
  private containers = new Map<string, ContainerWorkerHandle>();
  private readonly config: Required<ContainerManagerConfig>;
  private readonly _exitHandler: () => void;

  constructor(config: ContainerManagerConfig = {}) {
    const defaultWorkspaceBase = join(homedir(), '.trikhub', 'workspace');
    this.config = {
      workspaceBaseDir: config.workspaceBaseDir ?? defaultWorkspaceBase,
      startupTimeoutMs: config.startupTimeoutMs ?? 30000,
      invokeTimeoutMs: config.invokeTimeoutMs ?? 120000,
      debug: config.debug ?? false,
    };

    // Register process exit handler to force-kill all containers.
    // This ensures containers don't leak when the process is killed (SIGINT/SIGTERM)
    // or exits without calling shutdown().
    this._exitHandler = () => {
      this.killAll();
    };
    process.on('exit', this._exitHandler);
  }

  /**
   * Launch a container for a trik and return a WorkerHandle.
   *
   * If a container is already running for this trik, returns the existing handle.
   */
  async launch(trikId: string, options: ContainerOptions): Promise<ContainerWorkerHandle> {
    // Return existing container if running
    const existing = this.containers.get(trikId);
    if (existing?.ready) {
      return existing;
    }

    // Check Docker is available
    await this.ensureDockerAvailable();

    // Check/pull image if not present
    const image = WORKER_IMAGES[options.runtime];
    await this.ensureImageAvailable(image);

    // Create workspace directory on host
    const workspacePath = options.workspacePath || join(this.config.workspaceBaseDir, trikId);
    if (!existsSync(workspacePath)) {
      mkdirSync(workspacePath, { recursive: true });
    }

    // Create and start container
    const handle = new ContainerWorkerHandle(
      trikId,
      { ...options, workspacePath },
      this.config,
    );

    this.containers.set(trikId, handle);

    try {
      await handle.start();
      return handle;
    } catch (error) {
      this.containers.delete(trikId);
      throw error;
    }
  }

  /**
   * Stop and remove a container for a trik.
   */
  async stop(trikId: string): Promise<void> {
    const handle = this.containers.get(trikId);
    if (!handle) return;

    await handle.shutdown();
    this.containers.delete(trikId);
  }

  /**
   * Check if a container is running for a trik.
   */
  isRunning(trikId: string): boolean {
    const handle = this.containers.get(trikId);
    return handle?.ready ?? false;
  }

  /**
   * Stop all managed containers gracefully.
   */
  async stopAll(): Promise<void> {
    process.removeListener('exit', this._exitHandler);
    const stopPromises = Array.from(this.containers.keys()).map((id) => this.stop(id));
    await Promise.allSettled(stopPromises);
    this.containers.clear();
  }

  /**
   * Synchronously force-kill all containers. Used as process exit handler
   * to ensure containers don't outlive the host process.
   */
  private killAll(): void {
    for (const handle of this.containers.values()) {
      handle.kill();
    }
    this.containers.clear();
  }

  /**
   * Get the workspace path for a trik.
   */
  getWorkspacePath(trikId: string): string {
    return join(this.config.workspaceBaseDir, trikId);
  }

  /**
   * Check that Docker is installed and the daemon is running.
   */
  private async ensureDockerAvailable(): Promise<void> {
    try {
      execSync('docker info', { stdio: 'ignore', timeout: 5000 });
    } catch {
      throw new Error(
        'Docker is not available. Please install Docker and ensure the Docker daemon is running to use triks with filesystem/shell capabilities.'
      );
    }
  }

  /**
   * Check if a Docker image is available locally, pull it if not.
   */
  private async ensureImageAvailable(image: string): Promise<void> {
    try {
      execSync(`docker image inspect ${image}`, { stdio: 'ignore', timeout: 5000 });
    } catch {
      // Image not found locally, try to pull
      if (this.config.debug) {
        console.log(`[ContainerManager] Pulling image ${image}...`);
      }
      try {
        execSync(`docker pull ${image}`, { stdio: 'ignore', timeout: 300000 }); // 5 min timeout for pull
      } catch {
        throw new Error(
          `Docker image ${image} not found. Build it locally with: ./docker/build-images.sh`
        );
      }
    }
  }
}
