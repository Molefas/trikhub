/**
 * Python Trik Template Generator
 *
 * Generates all files needed for a Python trik project.
 */

import { TrikCategory } from '../types.js';

export interface PyTemplateConfig {
  name: string;
  displayName: string;
  description: string;
  authorName: string;
  authorGithub: string;
  category: TrikCategory;
  enableStorage: boolean;
  enableConfig: boolean;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

/**
 * Convert trik name to Python package name (dashes to underscores)
 */
function toPackageName(name: string): string {
  return name.replace(/-/g, '_');
}

/**
 * Generate all files for a Python trik project
 */
export function generatePythonProject(config: PyTemplateConfig): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const pkgName = toPackageName(config.name);

  files.push({ path: 'trikhub.json', content: generateTrikhubJson(config) });
  files.push({ path: 'pyproject.toml', content: generatePyproject(config, pkgName) });
  files.push({ path: 'test.py', content: generateTestPy(pkgName) });
  files.push({ path: 'README.md', content: generateReadme(config) });
  files.push({ path: '.gitignore', content: generateGitignore() });
  files.push({ path: `${pkgName}/__init__.py`, content: generateInitPy() });
  files.push({ path: `${pkgName}/manifest.json`, content: generateManifest(config) });
  files.push({ path: `${pkgName}/graph.py`, content: generateGraphPy(config) });

  return files;
}

function generateManifest(config: PyTemplateConfig): string {
  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    id: config.name,
    name: config.displayName,
    description: config.description,
    version: '0.1.0',
    actions: {
      hello: {
        description: 'Say hello to someone',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name to greet' },
          },
          required: ['name'],
        },
        responseMode: 'template',
        agentDataSchema: {
          type: 'object',
          properties: {
            template: { type: 'string', enum: ['success'] },
            greeting: { type: 'string', maxLength: 200, pattern: '^.{1,200}$' },
          },
          required: ['template', 'greeting'],
        },
        responseTemplates: {
          success: { text: '{{greeting}}' },
        },
      },
    },
    capabilities: {
      tools: [],
    },
    limits: {
      maxExecutionTimeMs: 5000,
    },
    entry: {
      module: './graph.py',
      export: 'graph',
      runtime: 'python',
    },
  };

  // Add storage capability if enabled
  if (config.enableStorage) {
    (manifest.capabilities as Record<string, unknown>).storage = {
      enabled: true,
      maxSizeBytes: 1048576,
      persistent: true,
    };
  }

  // Add config if enabled
  if (config.enableConfig) {
    manifest.config = {
      required: [
        { key: 'API_KEY', description: 'Your API key' },
      ],
      optional: [],
    };
  }

  return JSON.stringify(manifest, null, 2) + '\n';
}

function generateTrikhubJson(config: PyTemplateConfig): string {
  const trikhub = {
    displayName: config.displayName,
    shortDescription: config.description,
    categories: [config.category],
    keywords: [config.name],
    author: {
      name: config.authorName,
      github: config.authorGithub,
    },
    repository: `https://github.com/${config.authorGithub}/${config.name}`,
  };

  return JSON.stringify(trikhub, null, 2) + '\n';
}

function generatePyproject(config: PyTemplateConfig, pkgName: string): string {
  return `[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "${config.name}"
version = "0.1.0"
description = "${config.description}"
readme = "README.md"
requires-python = ">=3.10"
license = {text = "MIT"}
authors = [
    { name = "${config.authorName}" }
]
dependencies = []

[project.urls]
Repository = "https://github.com/${config.authorGithub}/${config.name}"

[tool.hatch.build.targets.wheel]
packages = ["${pkgName}"]

[tool.hatch.build.targets.sdist]
include = [
    "${pkgName}/**",
    "README.md",
]
`;
}

function generateGraphPy(config: PyTemplateConfig): string {
  const storageType = config.enableStorage ? ', storage: dict | None = None' : '';
  const configType = config.enableConfig ? ', config: dict | None = None' : '';

  return `"""
${config.displayName}

${config.description}
"""

from __future__ import annotations

from typing import Any


class ${toPascalCase(config.name)}Graph:
    """Main graph for the ${config.displayName} trik."""

    async def invoke(self, input_data: dict[str, Any]) -> dict[str, Any]:
        """
        Main entry point called by the TrikHub gateway.

        Args:
            input_data: Contains action, input${config.enableStorage ? ', storage' : ''}${config.enableConfig ? ', config' : ''}

        Returns:
            Response with responseMode and agentData/userContent
        """
        action = input_data.get("action")
        action_input = input_data.get("input", {})${config.enableStorage ? '\n        storage = input_data.get("storage")' : ''}${config.enableConfig ? '\n        config = input_data.get("config")' : ''}

        if action == "hello":
            name = action_input.get("name", "World")
            return {
                "responseMode": "template",
                "agentData": {
                    "template": "success",
                    "greeting": f"Hello, {name}!",
                },
            }

        return {
            "responseMode": "template",
            "agentData": {
                "template": "error",
                "message": f"Unknown action: {action}",
            },
        }


# Export the graph instance
graph = ${toPascalCase(config.name)}Graph()
`;
}

function generateInitPy(): string {
  return `"""${''} Package init """
`;
}

function generateTestPy(pkgName: string): string {
  return `"""
Local test script

Run with: python test.py
"""

import asyncio
from ${pkgName}.graph import graph


async def main():
    result = await graph.invoke({
        "action": "hello",
        "input": {"name": "World"},
    })
    print(result)


if __name__ == "__main__":
    asyncio.run(main())
`;
}

function generateReadme(config: PyTemplateConfig): string {
  return `# ${config.displayName}

${config.description}

## Development

\`\`\`bash
python test.py
\`\`\`

## Actions

### hello

Say hello to someone.

**Input:**
- \`name\` (string, required): Name to greet

## Publishing

\`\`\`bash
trik publish
\`\`\`
`;
}

function generateGitignore(): string {
  return `__pycache__/
*.py[cod]
*$py.class
*.so
.Python
build/
dist/
*.egg-info/
.eggs/
*.egg
.venv/
venv/
.DS_Store
`;
}

function toPascalCase(str: string): string {
  return str
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}
