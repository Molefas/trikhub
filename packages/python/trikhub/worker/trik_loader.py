"""
Dynamic loader for Python trik modules.

Reads manifest.json to find the entry module and export, then imports
the module and returns the TrikAgent.
"""

from __future__ import annotations

import importlib
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

from trikhub.manifest import TrikAgent


class TrikLoader:
    """Load and cache Python TrikAgent instances from trik directories."""

    def __init__(self) -> None:
        self._cache: dict[str, TrikAgent] = {}

    def load(self, trik_path: str) -> TrikAgent:
        cached = self._cache.get(trik_path)
        if cached is not None:
            return cached

        trik_dir = Path(trik_path).resolve()
        manifest_path = trik_dir / "manifest.json"

        if not manifest_path.exists():
            raise FileNotFoundError(f"Manifest not found at {manifest_path}")

        with open(manifest_path) as f:
            manifest = json.load(f)

        entry = manifest.get("entry", {})
        module_path = entry.get("module", "./graph.py")
        export_name = entry.get("export", "agent")

        # Resolve relative module path
        if module_path.startswith("./"):
            module_path = module_path[2:]
        module_file = trik_dir / module_path

        if not module_file.exists():
            raise FileNotFoundError(f"Module not found at {module_file}")

        agent = self._import_agent(trik_dir, module_file, export_name)
        self._cache[trik_path] = agent
        return agent

    def _import_agent(self, trik_dir: Path, module_file: Path, export_name: str) -> TrikAgent:
        """Import a Python module and extract the TrikAgent export."""
        parent_dir = str(trik_dir)

        # Check if the trik is a Python package (has __init__.py)
        init_file = trik_dir / "__init__.py"
        if init_file.exists():
            # Package import: add parent to sys.path and use package import
            grandparent = str(trik_dir.parent)
            if grandparent not in sys.path:
                sys.path.insert(0, grandparent)
            package_name = trik_dir.name
            rel_module = module_file.stem
            full_module_name = f"{package_name}.{rel_module}"
            mod = importlib.import_module(full_module_name)
        else:
            # Standalone module: load directly via spec
            if parent_dir not in sys.path:
                sys.path.insert(0, parent_dir)
            module_name = f"trikhub_trik_{module_file.stem}"
            spec = importlib.util.spec_from_file_location(module_name, str(module_file))
            if spec is None or spec.loader is None:
                raise ImportError(f"Cannot create module spec for {module_file}")
            mod = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = mod
            spec.loader.exec_module(mod)

        agent: Any = getattr(mod, export_name, None)
        if agent is None:
            raise ImportError(f"Module does not export '{export_name}'")

        # Validate the agent has at least one required method
        has_process = callable(getattr(agent, "process_message", None))
        has_execute = callable(getattr(agent, "execute_tool", None))
        if not has_process and not has_execute:
            raise TypeError(
                f"Export '{export_name}' is not a valid TrikAgent "
                "(missing process_message or execute_tool)"
            )

        return agent
