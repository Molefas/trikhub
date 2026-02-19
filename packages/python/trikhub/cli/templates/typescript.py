"""TypeScript Trik Template Generator.

Generates all files needed for a TypeScript trik project.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any


@dataclass
class TsTemplateConfig:
    """Configuration for TypeScript template generation."""

    name: str
    display_name: str
    description: str
    author_name: str
    author_github: str
    category: str
    enable_storage: bool
    enable_config: bool


@dataclass
class GeneratedFile:
    """A generated file with path and content."""

    path: str
    content: str


def generate_typescript_project(config: TsTemplateConfig) -> list[GeneratedFile]:
    """Generate all files for a TypeScript trik project."""
    files: list[GeneratedFile] = []

    files.append(GeneratedFile("manifest.json", _generate_manifest(config)))
    files.append(GeneratedFile("trikhub.json", _generate_trikhub_json(config)))
    files.append(GeneratedFile("package.json", _generate_package_json(config)))
    files.append(GeneratedFile("tsconfig.json", _generate_tsconfig()))
    files.append(GeneratedFile("src/index.ts", _generate_index_ts(config)))
    files.append(GeneratedFile("test.ts", _generate_test_ts()))
    files.append(GeneratedFile("README.md", _generate_readme(config)))
    files.append(GeneratedFile(".gitignore", _generate_gitignore()))

    return files


def _generate_manifest(config: TsTemplateConfig) -> str:
    manifest: dict[str, Any] = {
        "schemaVersion": 1,
        "id": config.name,
        "name": config.display_name,
        "description": config.description,
        "version": "0.1.0",
        "actions": {
            "hello": {
                "description": "Say hello to someone",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "Name to greet"},
                    },
                    "required": ["name"],
                },
                "responseMode": "template",
                "agentDataSchema": {
                    "type": "object",
                    "properties": {
                        "template": {"type": "string", "enum": ["success"]},
                        "greeting": {"type": "string"},
                    },
                    "required": ["template", "greeting"],
                },
                "responseTemplates": {
                    "success": {"text": "{{greeting}}"},
                },
            },
        },
        "capabilities": {
            "tools": [],
        },
        "limits": {
            "maxExecutionTimeMs": 5000,
        },
        "entry": {
            "module": "./dist/index.js",
            "export": "default",
        },
    }

    if config.enable_storage:
        manifest["capabilities"]["storage"] = {
            "enabled": True,
            "maxSizeBytes": 1048576,
            "persistent": True,
        }

    if config.enable_config:
        manifest["config"] = {
            "required": [
                {"key": "API_KEY", "description": "Your API key"},
            ],
            "optional": [],
        }

    return json.dumps(manifest, indent=2) + "\n"


def _generate_trikhub_json(config: TsTemplateConfig) -> str:
    trikhub = {
        "displayName": config.display_name,
        "shortDescription": config.description,
        "categories": [config.category],
        "keywords": [config.name],
        "author": {
            "name": config.author_name,
            "github": config.author_github,
        },
        "repository": f"https://github.com/{config.author_github}/{config.name}",
    }

    return json.dumps(trikhub, indent=2) + "\n"


def _generate_package_json(config: TsTemplateConfig) -> str:
    pkg = {
        "name": f"@{config.author_github.lower()}/{config.name}",
        "version": "0.1.0",
        "description": config.description,
        "type": "module",
        "main": "dist/index.js",
        "scripts": {
            "build": "tsc",
            "clean": "rm -rf dist",
            "test": "npm run build && tsx test.ts",
        },
        "dependencies": {
            "@trikhub/manifest": "^0.7.0",
        },
        "devDependencies": {
            "@types/node": "^20.0.0",
            "tsx": "^4.0.0",
            "typescript": "^5.6.0",
        },
        "engines": {
            "node": ">=20",
        },
    }

    return json.dumps(pkg, indent=2) + "\n"


def _generate_tsconfig() -> str:
    tsconfig = {
        "compilerOptions": {
            "target": "ES2022",
            "module": "NodeNext",
            "moduleResolution": "NodeNext",
            "outDir": "./dist",
            "rootDir": "./src",
            "strict": True,
            "esModuleInterop": True,
            "skipLibCheck": True,
            "declaration": True,
        },
        "include": ["src/**/*"],
        "exclude": ["node_modules", "dist"],
    }

    return json.dumps(tsconfig, indent=2) + "\n"


def _to_pascal_case(name: str) -> str:
    """Convert kebab-case to PascalCase."""
    return "".join(part.capitalize() for part in name.split("-"))


def _generate_index_ts(config: TsTemplateConfig) -> str:
    class_name = _to_pascal_case(config.name)

    storage_import = ""
    config_type = ""
    invoke_params = ["action: string", "input: Record<string, unknown>"]

    if config.enable_storage:
        storage_import = """
interface Storage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
"""
        invoke_params.append("storage?: Storage")

    if config.enable_config:
        config_type = """
interface Config {
  API_KEY: string;
}
"""
        invoke_params.append("config?: Config")

    params_str = "; ".join(invoke_params)

    return f'''/**
 * {config.display_name}
 *
 * {config.description}
 */

type InvokeInput = {{
  {params_str};
}};

type InvokeResult = {{
  responseMode: 'template' | 'passthrough';
  agentData?: Record<string, unknown>;
  userContent?: Record<string, unknown>;
}};
{storage_import}{config_type}
class {class_name}Graph {{
  async invoke(input: InvokeInput): Promise<InvokeResult> {{
    const {{ action, input: actionInput }} = input;

    if (action === 'hello') {{
      const name = (actionInput.name as string) || 'World';
      return {{
        responseMode: 'template',
        agentData: {{
          template: 'success',
          greeting: `Hello, ${{name}}!`,
        }},
      }};
    }}

    return {{
      responseMode: 'template',
      agentData: {{
        template: 'error',
        message: `Unknown action: ${{action}}`,
      }},
    }};
  }}
}}

export default new {class_name}Graph();
'''


def _generate_test_ts() -> str:
    return '''/**
 * Local test script
 *
 * Run with: npm test
 */

import graph from './src/index.js';

async function main() {
  const result = await graph.invoke({
    action: 'hello',
    input: { name: 'World' },
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
'''


def _generate_readme(config: TsTemplateConfig) -> str:
    return f"""# {config.display_name}

{config.description}

## Development

```bash
npm install
npm run build
npm test
```

## Actions

### hello

Say hello to someone.

**Input:**
- `name` (string, required): Name to greet

## Publishing

```bash
trik publish
```
"""


def _generate_gitignore() -> str:
    return """node_modules/
dist/
*.log
.DS_Store
"""
