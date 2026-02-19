"""Python Trik Template Generator.

Generates all files needed for a Python trik project.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any


@dataclass
class PyTemplateConfig:
    """Configuration for Python template generation."""

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


def _to_package_name(name: str) -> str:
    """Convert trik name to Python package name (dashes to underscores)."""
    return name.replace("-", "_")


def _to_pascal_case(name: str) -> str:
    """Convert kebab-case to PascalCase."""
    return "".join(part.capitalize() for part in name.split("-"))


def generate_python_project(config: PyTemplateConfig) -> list[GeneratedFile]:
    """Generate all files for a Python trik project."""
    files: list[GeneratedFile] = []
    pkg_name = _to_package_name(config.name)

    files.append(GeneratedFile("trikhub.json", _generate_trikhub_json(config)))
    files.append(GeneratedFile("pyproject.toml", _generate_pyproject(config, pkg_name)))
    files.append(GeneratedFile("test.py", _generate_test_py(pkg_name)))
    files.append(GeneratedFile("README.md", _generate_readme(config)))
    files.append(GeneratedFile(".gitignore", _generate_gitignore()))
    files.append(GeneratedFile(f"{pkg_name}/__init__.py", _generate_init_py()))
    files.append(GeneratedFile(f"{pkg_name}/manifest.json", _generate_manifest(config)))
    files.append(GeneratedFile(f"{pkg_name}/graph.py", _generate_graph_py(config)))

    return files


def _generate_manifest(config: PyTemplateConfig) -> str:
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
            "module": "./graph.py",
            "export": "graph",
            "runtime": "python",
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


def _generate_trikhub_json(config: PyTemplateConfig) -> str:
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


def _generate_pyproject(config: PyTemplateConfig, pkg_name: str) -> str:
    return f'''[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "{config.name}"
version = "0.1.0"
description = "{config.description}"
readme = "README.md"
requires-python = ">=3.10"
license = {{text = "MIT"}}
authors = [
    {{ name = "{config.author_name}" }}
]
dependencies = []

[project.urls]
Repository = "https://github.com/{config.author_github}/{config.name}"

[tool.hatch.build.targets.wheel]
packages = ["{pkg_name}"]

[tool.hatch.build.targets.sdist]
include = [
    "{pkg_name}/**",
    "README.md",
]
'''


def _generate_graph_py(config: PyTemplateConfig) -> str:
    class_name = _to_pascal_case(config.name)

    storage_line = '        storage = input_data.get("storage")' if config.enable_storage else ""
    config_line = '        config = input_data.get("config")' if config.enable_config else ""

    extra_args = ""
    if config.enable_storage:
        extra_args += ", storage"
    if config.enable_config:
        extra_args += ", config"

    return f'''"""
{config.display_name}

{config.description}
"""

from __future__ import annotations

from typing import Any


class {class_name}Graph:
    """Main graph for the {config.display_name} trik."""

    async def invoke(self, input_data: dict[str, Any]) -> dict[str, Any]:
        """
        Main entry point called by the TrikHub gateway.

        Args:
            input_data: Contains action, input{extra_args}

        Returns:
            Response with responseMode and agentData/userContent
        """
        action = input_data.get("action")
        action_input = input_data.get("input", {{}})
{storage_line}
{config_line}

        if action == "hello":
            name = action_input.get("name", "World")
            return {{
                "responseMode": "template",
                "agentData": {{
                    "template": "success",
                    "greeting": f"Hello, {{name}}!",
                }},
            }}

        return {{
            "responseMode": "template",
            "agentData": {{
                "template": "error",
                "message": f"Unknown action: {{action}}",
            }},
        }}


# Export the graph instance
graph = {class_name}Graph()
'''


def _generate_init_py() -> str:
    return '"""Package init."""\n'


def _generate_test_py(pkg_name: str) -> str:
    return f'''"""
Local test script

Run with: python test.py
"""

import asyncio
from {pkg_name}.graph import graph


async def main():
    result = await graph.invoke({{
        "action": "hello",
        "input": {{"name": "World"}},
    }})
    print(result)


if __name__ == "__main__":
    asyncio.run(main())
'''


def _generate_readme(config: PyTemplateConfig) -> str:
    return f"""# {config.display_name}

{config.description}

## Development

```bash
python test.py
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
    return """__pycache__/
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
"""
