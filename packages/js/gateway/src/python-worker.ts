/**
 * Python Worker - Subprocess manager for executing Python triks
 *
 * This module spawns and manages a Python worker process that executes
 * Python triks via JSON-RPC 2.0 protocol over stdin/stdout.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { EventEmitter } from 'node:events';
import type { TrikConfigContext, TrikStorageContext, SessionHistoryEntry } from '@trikhub/manifest';
import {
  createInvokeRequest,
  createHealthRequest,
  createShutdownRequest,
  createSuccessResponse,
  createErrorResponse,
  parseMessage,
  isResponse,
  serializeMessage,
  WorkerErrorCodes,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type InvokeParams,
  type InvokeResult,
  type HealthResult,
  type StorageMethod,
} from './worker-protocol.js';

export interface PythonWorkerConfig {
  /** Path to Python executable (defaults to 'python3') */
  pythonPath?: string;
  /** Timeout for worker startup in ms (default: 10000) */
  startupTimeoutMs?: number;
  /** Timeout for invoke requests in ms (default: 60000) */
  invokeTimeoutMs?: number;
  /** Whether to enable debug logging */
  debug?: boolean;
}

export interface ExecutePythonTrikOptions {
  /** Session context if session is enabled */
  session?: {
    sessionId: string;
    history: SessionHistoryEntry[];
  };
  /** Configuration context for API keys */
  config?: TrikConfigContext;
  /** Storage context for persistent data */
  storage?: TrikStorageContext;
}

type PendingRequest = {
  resolve: (response: JsonRpcResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export class PythonWorker extends EventEmitter {
  private process: ChildProcess | null = null;
  private readline: Interface | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private config: Required<PythonWorkerConfig>;
  private isReady = false;
  private startupPromise: Promise<void> | null = null;

  constructor(config: PythonWorkerConfig = {}) {
    super();
    this.config = {
      pythonPath: config.pythonPath ?? 'python3',
      startupTimeoutMs: config.startupTimeoutMs ?? 10000,
      invokeTimeoutMs: config.invokeTimeoutMs ?? 60000,
      debug: config.debug ?? false,
    };
  }

  /**
   * Start the Python worker process.
   */
  async start(): Promise<void> {
    if (this.process) {
      throw new Error('Worker already started');
    }

    if (this.startupPromise) {
      return this.startupPromise;
    }

    this.startupPromise = this.doStart();
    return this.startupPromise;
  }

  private async doStart(): Promise<void> {
    return new Promise((resolve, reject) => {
      const startupTimeout = setTimeout(() => {
        this.kill();
        reject(new Error(`Worker startup timed out after ${this.config.startupTimeoutMs}ms`));
      }, this.config.startupTimeoutMs);

      // Spawn the Python worker process
      // Uses trikhub-worker command which is installed via pip
      this.process = spawn(this.config.pythonPath, ['-m', 'trikhub.worker.main'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1', // Disable Python buffering for real-time output
        },
      });

      // Handle stderr (for debugging)
      this.process.stderr?.on('data', (data: Buffer) => {
        const message = data.toString().trim();
        if (this.config.debug) {
          console.error(`[PythonWorker:stderr] ${message}`);
        }
        this.emit('stderr', message);
      });

      // Handle process errors
      this.process.on('error', (error) => {
        clearTimeout(startupTimeout);
        this.emit('error', error);
        reject(new Error(`Failed to start Python worker: ${error.message}`));
      });

      // Handle process exit
      this.process.on('exit', (code, signal) => {
        this.isReady = false;
        this.process = null;
        this.readline = null;

        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests) {
          clearTimeout(pending.timeout);
          pending.reject(new Error(`Worker process exited (code: ${code}, signal: ${signal})`));
          this.pendingRequests.delete(id);
        }

        this.emit('exit', code, signal);
      });

      // Set up line-based reading from stdout
      this.readline = createInterface({
        input: this.process.stdout!,
        crlfDelay: Infinity,
      });

      this.readline.on('line', (line) => {
        this.handleLine(line);
      });

      // Send health check to verify worker is ready
      this.sendRequest(createHealthRequest())
        .then((response) => {
          clearTimeout(startupTimeout);
          if (response.error) {
            reject(new Error(`Worker health check failed: ${response.error.message}`));
            return;
          }
          const result = response.result as HealthResult;
          if (result.status !== 'ok') {
            reject(new Error('Worker health check failed'));
            return;
          }
          this.isReady = true;
          this.emit('ready', result);
          resolve();
        })
        .catch((error) => {
          clearTimeout(startupTimeout);
          reject(error);
        });
    });
  }

  /**
   * Execute a Python trik.
   */
  async invoke(
    trikPath: string,
    action: string,
    input: unknown,
    options: ExecutePythonTrikOptions = {}
  ): Promise<InvokeResult> {
    if (!this.isReady) {
      await this.start();
    }

    const params: InvokeParams = {
      trikPath,
      action,
      input,
      session: options.session,
      config: options.config ? this.configContextToRecord(options.config) : undefined,
    };

    const request = createInvokeRequest(params);
    const response = await this.sendRequest(request, this.config.invokeTimeoutMs);

    if (response.error) {
      throw new Error(`Invoke failed: ${response.error.message} (code: ${response.error.code})`);
    }

    return response.result as InvokeResult;
  }

  /**
   * Check worker health.
   */
  async health(): Promise<HealthResult> {
    if (!this.process) {
      throw new Error('Worker not started');
    }

    const request = createHealthRequest();
    const response = await this.sendRequest(request);

    if (response.error) {
      throw new Error(`Health check failed: ${response.error.message}`);
    }

    return response.result as HealthResult;
  }

  /**
   * Gracefully shutdown the worker.
   */
  async shutdown(gracePeriodMs = 5000): Promise<void> {
    if (!this.process) {
      return;
    }

    try {
      const request = createShutdownRequest(gracePeriodMs);
      await this.sendRequest(request, gracePeriodMs + 1000);
    } catch {
      // Ignore errors during shutdown
    }

    this.kill();
  }

  /**
   * Force kill the worker process.
   */
  kill(): void {
    if (this.process) {
      this.process.kill('SIGKILL');
      this.process = null;
      this.readline = null;
      this.isReady = false;
    }
  }

  /**
   * Check if the worker is running and ready.
   */
  get ready(): boolean {
    return this.isReady;
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;

    if (this.config.debug) {
      console.log(`[PythonWorker:recv] ${line}`);
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
        console.error(`[PythonWorker] Failed to parse message: ${line}`);
      }
      this.emit('parse-error', error, line);
    }
  }

  private async handleWorkerRequest(request: JsonRpcRequest): Promise<void> {
    // Handle storage proxy requests from the worker
    const method = request.method as StorageMethod;

    if (method.startsWith('storage.')) {
      // For now, emit an event for storage requests
      // The gateway will handle these by proxying to its storage provider
      this.emit('storage-request', request);

      // TODO: Implement actual storage proxy
      // For now, send an error response
      const response = createErrorResponse(
        request.id,
        WorkerErrorCodes.STORAGE_ERROR,
        'Storage proxy not yet implemented'
      );
      this.sendLine(serializeMessage(response));
    }
  }

  private sendRequest(
    request: JsonRpcRequest,
    timeoutMs = this.config.invokeTimeoutMs
  ): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error('Worker stdin not available'));
        return;
      }

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error(`Request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(request.id, { resolve, reject, timeout });

      const line = serializeMessage(request);
      if (this.config.debug) {
        console.log(`[PythonWorker:send] ${line}`);
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

  private configContextToRecord(config: TrikConfigContext): Record<string, string> {
    const result: Record<string, string> = {};
    for (const key of config.keys()) {
      const value = config.get(key);
      if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }
}

// Singleton worker manager for efficiency
let sharedWorker: PythonWorker | null = null;

/**
 * Get or create a shared Python worker instance.
 */
export function getSharedPythonWorker(config?: PythonWorkerConfig): PythonWorker {
  if (!sharedWorker) {
    sharedWorker = new PythonWorker(config);
  }
  return sharedWorker;
}

/**
 * Shutdown the shared Python worker.
 */
export async function shutdownSharedPythonWorker(): Promise<void> {
  if (sharedWorker) {
    await sharedWorker.shutdown();
    sharedWorker = null;
  }
}
