#!/usr/bin/env node
/**
 * TrikHub MCP Server
 *
 * An MCP server that helps developers create, validate, and manage Triks
 * through AI-assisted authoring in IDEs like Claude Code and VS Code.
 *
 * Stub — v1 tools, resources, and prompts removed in P1. v2 implementation in P7.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// Create the MCP server
const server = new McpServer({
  name: 'trikhub',
  version: '0.1.0',
});

// Tools, resources, and prompts will be added in P7

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('TrikHub MCP server started');
}

main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
