/**
 * Hello JS Trik - A simple JavaScript trik demonstrating cross-language execution.
 *
 * This trik runs via the Node.js worker subprocess when executed from the Python gateway.
 */

class HelloGraph {
  /**
   * Main invoke method - called by the TrikHub gateway.
   *
   * @param {Object} input - The input from the gateway
   * @param {string} input.action - The action to execute
   * @param {Object} input.input - The action input
   * @returns {Object} The result
   */
  async invoke(input) {
    const { action, input: actionInput } = input;

    switch (action) {
      case "greet":
        return this.greet(actionInput);
      case "calculate":
        return this.calculate(actionInput);
      default:
        return {
          responseMode: "template",
          agentData: {
            template: "error",
            message: `Unknown action: ${action}`,
          },
        };
    }
  }

  /**
   * Generate a greeting message.
   */
  greet(input) {
    const { name } = input;

    if (!name || typeof name !== "string") {
      return {
        responseMode: "template",
        agentData: {
          template: "error",
          message: "Name is required and must be a string",
        },
      };
    }

    const greeting = `Hello, ${name}! Welcome to TrikHub from JavaScript!`;
    const timestamp = new Date().toISOString();

    return {
      responseMode: "template",
      agentData: {
        template: "success",
        message: greeting,
        timestamp: timestamp,
      },
    };
  }

  /**
   * Perform a simple calculation.
   */
  calculate(input) {
    const { operation, a, b } = input;

    if (typeof a !== "number" || typeof b !== "number") {
      return {
        responseMode: "template",
        agentData: {
          template: "error",
          message: "Both 'a' and 'b' must be numbers",
        },
      };
    }

    let result;
    let opName;

    switch (operation) {
      case "add":
        result = a + b;
        opName = `${a} + ${b}`;
        break;
      case "subtract":
        result = a - b;
        opName = `${a} - ${b}`;
        break;
      case "multiply":
        result = a * b;
        opName = `${a} × ${b}`;
        break;
      case "divide":
        if (b === 0) {
          return {
            responseMode: "template",
            agentData: {
              template: "error",
              message: "Cannot divide by zero",
            },
          };
        }
        result = a / b;
        opName = `${a} ÷ ${b}`;
        break;
      default:
        return {
          responseMode: "template",
          agentData: {
            template: "error",
            message: `Unknown operation: ${operation}`,
          },
        };
    }

    return {
      responseMode: "template",
      agentData: {
        template: "result",
        result: result,
        operation: opName,
      },
    };
  }
}

// Export the graph instance
const graph = new HelloGraph();
module.exports = { graph };
