#!/usr/bin/env node
/**
 * JavaScript Worker for TrikHub
 *
 * This module implements the worker process that executes JavaScript triks.
 * It communicates with the Python gateway via stdin/stdout using JSON-RPC 2.0.
 *
 * Usage:
 *    node -m @trikhub/worker-js
 *    OR via: trikhub-worker-js (bin command)
 */

import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { TrikManifest, SessionHistoryEntry } from '@trikhub/manifest';

// ============================================================================
// JSON-RPC 2.0 Types
// ============================================================================

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string;
  result?: unknown;
  error?: JsonRpcError;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ============================================================================
// Worker Error Codes
// ============================================================================

const WorkerErrorCodes = {
  // JSON-RPC standard errors
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // Custom worker errors
  TRIK_NOT_FOUND: 1001,
  ACTION_NOT_FOUND: 1002,
  EXECUTION_TIMEOUT: 1003,
  SCHEMA_VALIDATION_FAILED: 1004,
  WORKER_NOT_READY: 1005,
  STORAGE_ERROR: 1006,
} as const;

// ============================================================================
// Protocol Helpers
// ============================================================================

function createSuccessResponse(id: string, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function createErrorResponse(
  id: string,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, data } };
}

function parseMessage(line: string): JsonRpcRequest | JsonRpcResponse {
  const parsed = JSON.parse(line);

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Message must be an object');
  }

  if (parsed.jsonrpc !== '2.0') {
    throw new Error('Invalid JSON-RPC version');
  }

  if (typeof parsed.id !== 'string') {
    throw new Error('Message ID must be a string');
  }

  return parsed;
}

function isResponse(
  message: JsonRpcRequest | JsonRpcResponse
): message is JsonRpcResponse {
  return 'result' in message || 'error' in message;
}

function createStorageRequest(
  method: string,
  params: Record<string, unknown>
): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id: uuidv4(),
    method,
    params,
  };
}

// ============================================================================
// Storage Proxy
// ============================================================================

/**
 * Proxy for storage operations.
 * Storage calls are forwarded to the Python gateway via stdout,
 * and responses are received via stdin.
 */
class StorageProxy {
  private pendingRequests = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private writeToStdout: (line: string) => void;

  constructor(writeToStdout: (line: string) => void) {
    this.writeToStdout = writeToStdout;
  }

  async get(key: string): Promise<unknown> {
    const request = createStorageRequest('storage.get', { key });
    const response = await this.sendAndWait(request);
    return (response as Record<string, unknown>)?.value ?? null;
  }

  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    const params: Record<string, unknown> = { key, value };
    if (ttl !== undefined) {
      params.ttl = ttl;
    }
    const request = createStorageRequest('storage.set', params);
    await this.sendAndWait(request);
  }

  async delete(key: string): Promise<boolean> {
    const request = createStorageRequest('storage.delete', { key });
    const response = await this.sendAndWait(request);
    return (response as Record<string, unknown>)?.deleted === true;
  }

  async list(prefix?: string): Promise<string[]> {
    const params: Record<string, unknown> = {};
    if (prefix !== undefined) {
      params.prefix = prefix;
    }
    const request = createStorageRequest('storage.list', params);
    const response = await this.sendAndWait(request);
    return ((response as Record<string, unknown>)?.keys as string[]) ?? [];
  }

  async getMany(keys: string[]): Promise<Record<string, unknown>> {
    const request = createStorageRequest('storage.getMany', { keys });
    const response = await this.sendAndWait(request);
    return ((response as Record<string, unknown>)?.values as Record<string, unknown>) ?? {};
  }

  async setMany(entries: Record<string, unknown>): Promise<void> {
    const request = createStorageRequest('storage.setMany', { entries });
    await this.sendAndWait(request);
  }

  private async sendAndWait(request: JsonRpcRequest): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(request.id, { resolve, reject });
      this.writeToStdout(JSON.stringify(request));
    });
  }

  handleResponse(response: JsonRpcResponse): boolean {
    const pending = this.pendingRequests.get(response.id);
    if (pending) {
      this.pendingRequests.delete(response.id);
      if (response.error) {
        pending.reject(new Error(`Storage error: ${response.error.message}`));
      } else {
        pending.resolve(response.result);
      }
      return true;
    }
    return false;
  }
}

// ============================================================================
// Trik Loader
// ============================================================================

interface TrikGraph {
  invoke(input: unknown): Promise<unknown> | unknown;
}

/**
 * Loads and caches JavaScript trik modules.
 */
class TrikLoader {
  private cache = new Map<string, TrikGraph>();

  async load(trikPath: string, exportName = 'graph'): Promise<TrikGraph> {
    const cacheKey = `${trikPath}:${exportName}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Find the manifest
    const trikDir = resolve(trikPath);
    const manifestPath = join(trikDir, 'manifest.json');

    if (!existsSync(manifestPath)) {
      throw new Error(`Manifest not found at ${manifestPath}`);
    }

    const manifestContent = await readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestContent) as TrikManifest;

    // Get entry info from manifest
    const entry = manifest.entry;
    let modulePath = entry?.module ?? './graph.js';
    const actualExportName = entry?.export ?? exportName;

    // Resolve relative path
    if (modulePath.startsWith('./')) {
      modulePath = modulePath.slice(2);
    }
    const moduleFile = join(trikDir, modulePath);

    if (!existsSync(moduleFile)) {
      throw new Error(`Module not found at ${moduleFile}`);
    }

    // Import the module dynamically
    const moduleUrl = pathToFileURL(moduleFile).href;
    const module = await import(moduleUrl);

    // Get the exported graph
    const graph = module[actualExportName] as TrikGraph | undefined;
    if (!graph) {
      throw new Error(`Module does not export '${actualExportName}'`);
    }

    this.cache.set(cacheKey, graph);
    return graph;
  }
}

// ============================================================================
// JavaScript Worker
// ============================================================================

interface InvokeParams {
  trikPath: string;
  action: string;
  input?: unknown;
  session?: {
    sessionId: string;
    history: SessionHistoryEntry[];
  };
  config?: Record<string, string>;
}

/**
 * JavaScript worker process for executing triks.
 * Communicates with the Python gateway via stdin/stdout using JSON-RPC 2.0.
 */
class JavaScriptWorker {
  private trikLoader = new TrikLoader();
  private storageProxy: StorageProxy;
  private startTime = Date.now();
  private running = true;

  constructor() {
    this.storageProxy = new StorageProxy((line) => this.writeLine(line));
  }

  async run(): Promise<void> {
    const rl = createInterface({
      input: process.stdin,
      output: undefined,
      terminal: false,
    });

    for await (const line of rl) {
      if (!this.running) break;

      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      try {
        await this.handleMessage(trimmedLine);
      } catch (error) {
        const errorResponse = createErrorResponse(
          'unknown',
          WorkerErrorCodes.INTERNAL_ERROR,
          `Worker error: ${error instanceof Error ? error.message : String(error)}`
        );
        this.writeResponse(errorResponse);
      }
    }
  }

  private async handleMessage(line: string): Promise<void> {
    let message: JsonRpcRequest | JsonRpcResponse;

    try {
      message = parseMessage(line);
    } catch (error) {
      const errorResponse = createErrorResponse(
        'unknown',
        WorkerErrorCodes.PARSE_ERROR,
        error instanceof Error ? error.message : 'Parse error'
      );
      this.writeResponse(errorResponse);
      return;
    }

    // Check if it's a response to a storage proxy request
    if (isResponse(message)) {
      this.storageProxy.handleResponse(message);
      return;
    }

    // Handle the request
    const response = await this.handleRequest(message as JsonRpcRequest);
    this.writeResponse(response);
  }

  private async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const method = request.method;

    switch (method) {
      case 'health':
        return this.handleHealth(request);
      case 'shutdown':
        return this.handleShutdown(request);
      case 'invoke':
        return await this.handleInvoke(request);
      default:
        return createErrorResponse(
          request.id,
          WorkerErrorCodes.METHOD_NOT_FOUND,
          `Unknown method: ${method}`
        );
    }
  }

  private handleHealth(request: JsonRpcRequest): JsonRpcResponse {
    const result = {
      status: 'ok',
      runtime: 'node',
      version: process.version,
      uptime: (Date.now() - this.startTime) / 1000,
    };
    return createSuccessResponse(request.id, result);
  }

  private handleShutdown(request: JsonRpcRequest): JsonRpcResponse {
    this.running = false;
    return createSuccessResponse(request.id, { acknowledged: true });
  }

  private async handleInvoke(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = (request.params ?? {}) as unknown as InvokeParams;

    const trikPath = params.trikPath;
    if (!trikPath) {
      return createErrorResponse(
        request.id,
        WorkerErrorCodes.INVALID_PARAMS,
        'Missing trikPath parameter'
      );
    }

    const action = params.action;
    if (!action) {
      return createErrorResponse(
        request.id,
        WorkerErrorCodes.INVALID_PARAMS,
        'Missing action parameter'
      );
    }

    try {
      // Load the trik
      const graph = await this.trikLoader.load(trikPath);

      // Build the input for the trik
      const trikInput: Record<string, unknown> = {
        action,
        input: params.input,
      };

      if (params.session) {
        trikInput.session = params.session;
      }

      if (params.config) {
        // Create a config context object similar to TrikConfigContext
        trikInput.config = {
          get: (key: string) => params.config?.[key],
          has: (key: string) => key in (params.config ?? {}),
          keys: () => Object.keys(params.config ?? {}),
        };
      }

      // Add storage proxy
      trikInput.storage = this.storageProxy;

      // Execute the trik
      const result = await Promise.resolve(graph.invoke(trikInput));

      return createSuccessResponse(request.id, result);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return createErrorResponse(
          request.id,
          WorkerErrorCodes.TRIK_NOT_FOUND,
          error.message
        );
      }

      return createErrorResponse(
        request.id,
        WorkerErrorCodes.INTERNAL_ERROR,
        `Execution error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private writeResponse(response: JsonRpcResponse): void {
    this.writeLine(JSON.stringify(response));
  }

  private writeLine(line: string): void {
    process.stdout.write(line + '\n');
  }
}

// ============================================================================
// Entry Point
// ============================================================================

async function runWorker(): Promise<void> {
  const worker = new JavaScriptWorker();
  await worker.run();
}

runWorker().catch((error) => {
  console.error('Worker failed:', error);
  process.exit(1);
});
