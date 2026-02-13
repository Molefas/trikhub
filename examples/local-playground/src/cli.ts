import "dotenv/config";
import * as readline from "readline";
import { HumanMessage, BaseMessage } from "@langchain/core/messages";
import { initializeAgentWithTriks, getLastPassthroughContent } from "./agent.js";

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
  console.log("LangGraph Agent CLI with TrikHub Support");
  console.log("Loading...\n");

  // Initialize agent with triks
  const { graph, loadedTriks, tools, provider } = await initializeAgentWithTriks();

  console.log(`LLM: ${provider.provider} (${provider.model})`);
  console.log(`Built-in tools: get_weather, calculate, search_web`);
  if (loadedTriks.length > 0) {
    console.log(`Triks: ${loadedTriks.join(', ')}`);
  }
  console.log(`Total tools: ${tools.length}`);
  console.log('Type "/tools" to list all, "exit" to quit.\n');

  const messages: BaseMessage[] = [];
  const threadId = `cli-${Date.now()}`;

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

    // Handle special commands
    if (userInput.toLowerCase() === "/tools") {
      console.log("\nAvailable tools:");
      for (const tool of tools) {
        console.log(`  - ${tool.name}: ${tool.description}`);
      }
      console.log();
      continue;
    }

    messages.push(new HumanMessage(userInput));

    try {
      const result = await graph.invoke(
        { messages },
        { configurable: { thread_id: threadId } }
      );

      // Check for passthrough content (direct output from trik)
      const passthroughContent = getLastPassthroughContent();
      if (passthroughContent) {
        console.log(`\n--- Direct Content (${passthroughContent.contentType}) ---`);
        console.log(passthroughContent.content);
        console.log("--- End ---\n");
      }

      // Always show assistant message
      const assistantMessage = result.messages[result.messages.length - 1];
      console.log(`\nAssistant: ${assistantMessage.content}\n`);

      // Update messages with the full conversation history from the graph
      messages.length = 0;
      messages.push(...result.messages);
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
