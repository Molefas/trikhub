/**
 * Tests for the Worker Protocol
 *
 * These tests verify the JSON-RPC 2.0 protocol used for cross-language
 * trik execution between the gateway and language-specific workers.
 */

import { describe, it, expect } from 'vitest';
import {
  createRequest,
  createInvokeRequest,
  createHealthRequest,
  createShutdownRequest,
  createStorageRequest,
  createSuccessResponse,
  createErrorResponse,
  parseMessage,
  isRequest,
  isResponse,
  serializeMessage,
  WorkerErrorCodes,
  type InvokeParams,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from '../../packages/js/gateway/src/worker-protocol.js';

describe('Worker Protocol', () => {
  describe('Message Creation', () => {
    it('should create a valid JSON-RPC request', () => {
      const request = createRequest('health');

      expect(request.jsonrpc).toBe('2.0');
      expect(request.method).toBe('health');
      expect(typeof request.id).toBe('string');
      expect(request.id.length).toBeGreaterThan(0);
    });

    it('should create an invoke request with params', () => {
      const params: InvokeParams = {
        trikPath: '/path/to/trik',
        action: 'search',
        input: { topic: 'AI' },
        config: { API_KEY: 'test-key' },
      };

      const request = createInvokeRequest(params);

      expect(request.method).toBe('invoke');
      expect(request.params).toEqual(params);
    });

    it('should create a health request', () => {
      const request = createHealthRequest();

      expect(request.method).toBe('health');
      expect(request.params).toBeUndefined();
    });

    it('should create a shutdown request with grace period', () => {
      const request = createShutdownRequest(5000);

      expect(request.method).toBe('shutdown');
      expect(request.params).toEqual({ gracePeriodMs: 5000 });
    });

    it('should create storage requests', () => {
      const getRequest = createStorageRequest('storage.get', { key: 'mykey' });
      expect(getRequest.method).toBe('storage.get');
      expect(getRequest.params).toEqual({ key: 'mykey' });

      const setRequest = createStorageRequest('storage.set', {
        key: 'mykey',
        value: 'myvalue',
      });
      expect(setRequest.method).toBe('storage.set');
      expect(setRequest.params).toEqual({ key: 'mykey', value: 'myvalue' });
    });
  });

  describe('Response Creation', () => {
    it('should create a success response', () => {
      const response = createSuccessResponse('test-id', { count: 5 });

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('test-id');
      expect(response.result).toEqual({ count: 5 });
      expect(response.error).toBeUndefined();
    });

    it('should create an error response', () => {
      const response = createErrorResponse(
        'test-id',
        WorkerErrorCodes.TRIK_NOT_FOUND,
        'Trik not found',
        { path: '/missing/trik' }
      );

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('test-id');
      expect(response.result).toBeUndefined();
      expect(response.error).toEqual({
        code: 1001,
        message: 'Trik not found',
        data: { path: '/missing/trik' },
      });
    });
  });

  describe('Message Parsing', () => {
    it('should parse a valid request', () => {
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 'test-id',
        method: 'invoke',
        params: { trikPath: '/path' },
      };
      const json = JSON.stringify(request);

      const parsed = parseMessage(json);

      expect(parsed).toEqual(request);
    });

    it('should parse a valid response', () => {
      const response: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { success: true },
      };
      const json = JSON.stringify(response);

      const parsed = parseMessage(json);

      expect(parsed).toEqual(response);
    });

    it('should throw on invalid JSON', () => {
      expect(() => parseMessage('not json')).toThrow('Failed to parse JSON-RPC message');
    });

    it('should throw on invalid JSON-RPC version', () => {
      const invalid = JSON.stringify({ jsonrpc: '1.0', id: 'test', method: 'test' });
      expect(() => parseMessage(invalid)).toThrow('Invalid JSON-RPC version');
    });

    it('should throw on missing id', () => {
      const invalid = JSON.stringify({ jsonrpc: '2.0', method: 'test' });
      expect(() => parseMessage(invalid)).toThrow('Message ID must be a string');
    });
  });

  describe('Message Type Guards', () => {
    it('should identify requests', () => {
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 'test-id',
        method: 'invoke',
      };

      expect(isRequest(request)).toBe(true);
      expect(isResponse(request)).toBe(false);
    });

    it('should identify success responses', () => {
      const response: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: { data: 'test' },
      };

      expect(isResponse(response)).toBe(true);
      expect(isRequest(response)).toBe(false);
    });

    it('should identify error responses', () => {
      const response: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        error: { code: -32600, message: 'Invalid request' },
      };

      expect(isResponse(response)).toBe(true);
      expect(isRequest(response)).toBe(false);
    });
  });

  describe('Message Serialization', () => {
    it('should serialize a request to JSON', () => {
      const request = createHealthRequest();
      const serialized = serializeMessage(request);

      expect(typeof serialized).toBe('string');
      expect(JSON.parse(serialized)).toEqual(request);
    });

    it('should serialize a response to JSON', () => {
      const response = createSuccessResponse('test-id', { count: 10 });
      const serialized = serializeMessage(response);

      expect(typeof serialized).toBe('string');
      expect(JSON.parse(serialized)).toEqual(response);
    });
  });

  describe('Error Codes', () => {
    it('should have standard JSON-RPC error codes', () => {
      expect(WorkerErrorCodes.PARSE_ERROR).toBe(-32700);
      expect(WorkerErrorCodes.INVALID_REQUEST).toBe(-32600);
      expect(WorkerErrorCodes.METHOD_NOT_FOUND).toBe(-32601);
      expect(WorkerErrorCodes.INVALID_PARAMS).toBe(-32602);
      expect(WorkerErrorCodes.INTERNAL_ERROR).toBe(-32603);
    });

    it('should have custom worker error codes', () => {
      expect(WorkerErrorCodes.TRIK_NOT_FOUND).toBe(1001);
      expect(WorkerErrorCodes.ACTION_NOT_FOUND).toBe(1002);
      expect(WorkerErrorCodes.EXECUTION_TIMEOUT).toBe(1003);
      expect(WorkerErrorCodes.SCHEMA_VALIDATION_FAILED).toBe(1004);
      expect(WorkerErrorCodes.WORKER_NOT_READY).toBe(1005);
      expect(WorkerErrorCodes.STORAGE_ERROR).toBe(1006);
    });
  });

  describe('InvokeParams', () => {
    it('should accept minimal params', () => {
      const params: InvokeParams = {
        trikPath: '/path/to/trik',
        action: 'search',
        input: { query: 'test' },
      };

      const request = createInvokeRequest(params);
      expect(request.params).toEqual(params);
    });

    it('should accept params with session', () => {
      const params: InvokeParams = {
        trikPath: '/path/to/trik',
        action: 'details',
        input: { id: '123' },
        session: {
          sessionId: 'session-1',
          history: [
            {
              timestamp: Date.now(),
              action: 'search',
              input: { query: 'test' },
              agentData: { count: 5 },
            },
          ],
        },
      };

      const request = createInvokeRequest(params);
      expect(request.params).toEqual(params);
    });

    it('should accept params with config', () => {
      const params: InvokeParams = {
        trikPath: '/path/to/trik',
        action: 'generate',
        input: { prompt: 'Hello' },
        config: {
          API_KEY: 'sk-test-key',
          MODEL: 'gpt-4',
        },
      };

      const request = createInvokeRequest(params);
      expect(request.params).toEqual(params);
    });
  });
});
