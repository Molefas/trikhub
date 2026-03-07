import "dotenv/config";
import * as readline from "readline";
import { initializeAgent } from "./agent.js";

const SPINNER_FRAMES = ['◐', '◓', '◑', '◒'];

class StatusSpinner {
  private interval: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;

  show(message: string): void {
    this.clear();
    this.frameIndex = 0;
    process.stdout.write(`\x1b[2m${SPINNER_FRAMES[0]} ${message}\x1b[0m`);
    this.interval = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
      process.stdout.write(`\r\x1b[2K\x1b[2m${SPINNER_FRAMES[this.frameIndex]} ${message}\x1b[0m`);
    }, 120);
  }

  clear(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write('\r\x1b[2K');
  }

  showBrief(message: string): void {
    this.clear();
    process.stdout.write(`\x1b[2m${message}\x1b[0m\n`);
  }
}

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

  const { app, gateway, loadedTriks, provider } = await initializeAgent();

  console.log(`LLM: ${provider.provider} (${provider.model})`);
  console.log(`Built-in tools: get_weather, calculate, search_web`);
  if (loadedTriks.length > 0) {
    console.log(`Loaded triks: ${loadedTriks.join(', ')}`);
  }
  console.log('Type "/back" to return from a trik handoff, "exit" to quit.\n');

  const spinner = new StatusSpinner();

  gateway.on('handoff:start', ({ trikName }) => {
    spinner.showBrief(`⟶ Handing off to ${trikName}...`);
  });

  gateway.on('handoff:container_start', ({ trikName }) => {
    spinner.show(`Starting container for ${trikName}...`);
  });

  gateway.on('handoff:thinking', ({ trikName }) => {
    spinner.show(`${trikName} is thinking...`);
  });

  gateway.on('handoff:message', ({ direction }) => {
    if (direction === 'from_trik') {
      spinner.clear();
    }
  });

  gateway.on('handoff:transfer_back', () => {
    spinner.clear();
    console.log(`\x1b[2m⟵ Returned to main agent\x1b[0m`);
  });

  gateway.on('handoff:error', ({ trikName, error }) => {
    spinner.clear();
    console.log(`\x1b[31m✗ ${trikName} error: ${error}\x1b[0m`);
  });

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
      if (result.source === 'system') {
        console.log(`\n\x1b[2m${result.message}\x1b[0m\n`);
      } else if (result.source !== 'main') {
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
