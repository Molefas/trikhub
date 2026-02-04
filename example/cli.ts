#!/usr/bin/env node
/**
 * LangGraph Agent Demo - Full LLM Implementation
 *
 * This demo shows a real LangGraph workflow with:
 * - Decision node (LLM with tools) - only sees agentData
 * - Render node (LLM without tools) - formats userContent
 * - Conditional routing between nodes
 *
 * Run with: pnpm demo
 * Run with debug: pnpm demo:debug or DEBUG=true pnpm demo
 */

import * as readline from 'node:readline';
import { LangGraphAgent } from './agent.js';

const DEBUG = process.env.DEBUG === 'true';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  LangGraph Agent Demo - Type-Directed Privilege Separation');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log();
  console.log('This demo shows a REAL LangGraph agent with:');
  console.log('• Decision Node: Claude with tools, only sees agentData');
  console.log('• Render Node: Claude without tools, formats userContent');
  console.log('• Conditional routing between nodes');
  console.log();
  console.log('Try: "Search for AI articles" or "Find articles about technology"');
  console.log('One article contains a prompt injection attempt.');
  console.log('The agent is NOT affected because it never sees the content.');
  console.log();
  if (DEBUG) {
    console.log('[DEBUG MODE ENABLED - showing LangGraph internal flow]');
    console.log();
  }
  console.log('Type "quit" or "exit" to stop.');
  console.log('───────────────────────────────────────────────────────────────');

  // Initialize agent
  const agent = new LangGraphAgent({ debug: DEBUG });

  console.log('\nInitializing agent (loading skill + building LangGraph)...');

  try {
    await agent.initialize();
    console.log('Agent ready!\n');
  } catch (error) {
    console.error('Failed to initialize agent:', error);
    process.exit(1);
  }

  // Interactive loop
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = () => {
    rl.question('\nYou: ', async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        askQuestion();
        return;
      }

      if (trimmed.toLowerCase() === 'quit' || trimmed.toLowerCase() === 'exit') {
        console.log('\nGoodbye!');
        rl.close();
        return;
      }

      try {
        console.log('\n[Processing with LangGraph...]');
        const response = await agent.chat(trimmed);
        console.log();
        console.log('───────────────────────────────────────────────────────────────');
        console.log('Assistant:', response);
        console.log('───────────────────────────────────────────────────────────────');
      } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
      }

      askQuestion();
    });
  };

  askQuestion();
}

main().catch(console.error);
