import "dotenv/config";
import * as readline from "readline";
import { initializeAgent } from "./agent.js";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function main() {
  console.log("LangGraph Agent CLI with TrikHub Handoff Support");
  console.log("Loading...\n");

  const { app, loadedTriks, provider } = await initializeAgent();

  console.log(`LLM: ${provider.provider} (${provider.model})`);
  console.log(`Built-in tools: get_weather, calculate, search_web`);
  if (loadedTriks.length > 0) {
    console.log(`Triks (handoff): ${loadedTriks.join(', ')}`);
  }
  console.log('Type "/back" to return from a trik handoff, "exit" to quit.\n');

  const sessionId = `cli-${Date.now()}`;

  while (true) {
    const userInput = await prompt("You: ");

    if (!userInput.trim()) {
      continue;
    }

    if (
      userInput.toLowerCase() === "exit" ||
      userInput.toLowerCase() === "quit"
    ) {
      console.log("\nGoodbye!");
      break;
    }

    try {
      const result = await app.processMessage(userInput, sessionId);

      // Show source indicator when in a trik handoff
      if (result.source !== 'main') {
        console.log(`\n[${result.source}] ${result.message}\n`);
      } else {
        console.log(`\nAssistant: ${result.message}\n`);
      }
    } catch (error) {
      console.error("\nError:", error);
      console.log("Please try again.\n");
    }
  }

  rl.close();
}

main().catch((error) => {
  console.error(error);
  rl.close();
});
