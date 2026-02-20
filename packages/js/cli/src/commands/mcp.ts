/**
 * trik mcp command
 *
 * Starts the TrikHub MCP server for AI-assisted trik development.
 */

import chalk from 'chalk';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

interface McpOptions {
  stdio?: boolean;
}

export async function mcpCommand(options: McpOptions): Promise<void> {
  // Find the MCP package entry point
  const require = createRequire(import.meta.url);
  let mcpPath: string;

  try {
    // Try to resolve @trikhub/mcp
    mcpPath = require.resolve('@trikhub/mcp');
  } catch {
    // Fallback to relative path in monorepo
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    mcpPath = path.resolve(__dirname, '../../../mcp/dist/index.js');
  }

  if (options.stdio) {
    // Start in stdio mode (for MCP clients like Claude Code)
    console.error(chalk.cyan('Starting TrikHub MCP server in stdio mode...'));

    const child = spawn('node', [mcpPath], {
      stdio: 'inherit',
    });

    child.on('error', (error) => {
      console.error(chalk.red(`Failed to start MCP server: ${error.message}`));
      process.exit(1);
    });

    child.on('exit', (code) => {
      process.exit(code ?? 0);
    });
  } else {
    // Print configuration instructions
    console.log();
    console.log(chalk.bold.cyan('TrikHub MCP Server'));
    console.log();
    console.log(chalk.dim('An MCP server that helps you create, validate, and manage Triks'));
    console.log(chalk.dim('using AI assistants in your IDE.'));
    console.log();

    console.log(chalk.bold('Setup for Claude Code'));
    console.log();
    console.log('Add this to your Claude Code MCP settings:');
    console.log();
    console.log(chalk.green(`{
  "mcpServers": {
    "trikhub": {
      "command": "npx",
      "args": ["-y", "@trikhub/mcp"]
    }
  }
}`));
    console.log();

    console.log(chalk.bold('Setup for VS Code (with MCP extension)'));
    console.log();
    console.log('Add to your settings.json:');
    console.log();
    console.log(chalk.green(`{
  "mcp.servers": {
    "trikhub": {
      "command": "npx",
      "args": ["-y", "@trikhub/mcp"]
    }
  }
}`));
    console.log();

    console.log(chalk.bold('Or run directly'));
    console.log();
    console.log(`  ${chalk.cyan('trik mcp --stdio')}  - Start MCP server in stdio mode`);
    console.log(`  ${chalk.cyan('npx @trikhub/mcp')} - Run standalone`);
    console.log();

    console.log(chalk.bold('Available Tools'));
    console.log();
    console.log('  • analyze_trik_requirements - Understand what to build');
    console.log('  • design_action - Design action schemas');
    console.log('  • design_schema - Create JSON schemas');
    console.log('  • scaffold_trik - Generate complete project');
    console.log('  • validate_manifest - Check manifest for errors');
    console.log('  • diagnose_error - Explain and fix errors');
    console.log();

    console.log(chalk.bold('Available Prompts'));
    console.log();
    console.log('  • create-trik - Guided trik creation');
    console.log('  • debug-manifest - Debug manifest issues');
    console.log('  • add-api-integration - Add API action');
    console.log();

    console.log(chalk.dim('Learn more: https://trikhub.com/docs/mcp-server'));
    console.log();
  }
}
