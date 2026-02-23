/**
 * Worker Protocol for Cross-Language Trik Execution
 *
 * This module defines the JSON-RPC 2.0 protocol used for communication
 * between the gateway and language-specific workers (Python, Node.js).
 *
 * Communication happens over stdin/stdout with newline-delimited JSON.
 */

import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// JSON-RPC 2.0 Base Types
// ============================================================================

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ============================================================================
// Worker Request Types
// ============================================================================

export type WorkerMethod = 'invoke' | 'health' | 'shutdown';

// InvokeParams stub — v2 protocol (processMessage) defined in P3.

export interface HealthParams {
  /** Optional timeout in ms */
  timeout?: number;
}

export interface ShutdownParams {
  /** Grace period in ms before force kill */
  gracePeriodMs?: number;
}

// ============================================================================
// Worker Response Types
// ============================================================================

// InvokeResult stub — v2 protocol (ProcessMessageResult) defined in P3.

export interface HealthResult {
  status: 'ok' | 'error';
  runtime: 'python' | 'node';
  version?: string;
  uptime?: number;
}

// ============================================================================
// Storage Proxy Types (bidirectional during execution)
// ============================================================================

export type StorageMethod =
  | 'storage.get'
  | 'storage.set'
  | 'storage.delete'
  | 'storage.list'
  | 'storage.getMany'
  | 'storage.setMany';

export interface StorageGetParams {
  key: string;
}

export interface StorageSetParams {
  key: string;
  value: unknown;
  ttl?: number;
}

export interface StorageDeleteParams {
  key: string;
}

export interface StorageListParams {
  prefix?: string;
}

export interface StorageGetManyParams {
  keys: string[];
}

export interface StorageSetManyParams {
  entries: Record<string, unknown>;
}

// ============================================================================
// Error Codes
// ============================================================================

export const WorkerErrorCodes = {
  // JSON-RPC standard errors
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // Custom worker errors
  TRIK_NOT_FOUND: 1001,
  EXECUTION_TIMEOUT: 1003,
  WORKER_NOT_READY: 1005,
  STORAGE_ERROR: 1006,
} as const;

// ============================================================================
// Message Builders
// ============================================================================

export function createRequest(
  method: WorkerMethod,
  params?: unknown
): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id: uuidv4(),
    method,
    params,
  };
}

export function createHealthRequest(): JsonRpcRequest {
  return createRequest('health');
}

export function createShutdownRequest(
  gracePeriodMs?: number
): JsonRpcRequest {
  return createRequest('shutdown', { gracePeriodMs });
}

export function createStorageRequest(
  method: StorageMethod,
  params: unknown
): JsonRpcRequest {
  return createRequest(method as WorkerMethod, params);
}

export function createSuccessResponse(
  id: string,
  result: unknown
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

export function createErrorResponse(
  id: string,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, data },
  };
}

// ============================================================================
// Message Parsing
// ============================================================================

export function parseMessage(line: string): JsonRpcRequest | JsonRpcResponse {
  try {
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
  } catch (error) {
    throw new Error(
      `Failed to parse JSON-RPC message: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

export function isRequest(
  message: JsonRpcRequest | JsonRpcResponse
): message is JsonRpcRequest {
  return 'method' in message;
}

export function isResponse(
  message: JsonRpcRequest | JsonRpcResponse
): message is JsonRpcResponse {
  return 'result' in message || 'error' in message;
}

export function serializeMessage(
  message: JsonRpcRequest | JsonRpcResponse
): string {
  return JSON.stringify(message);
}
