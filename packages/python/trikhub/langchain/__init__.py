"""
LangChain integration for TrikHub.

This module provides utilities for converting TrikHub tools to LangChain tools,
making it easy to integrate triks with LangChain-based agents.
"""

from __future__ import annotations

from .adapter import (
    LangChainAdapterOptions,
    LangChainTriksResult,
    LoadLangChainTriksOptions,
    create_langchain_tools,
    load_langchain_triks,
    parse_tool_name,
)
from .schema_converter import json_schema_to_pydantic

__all__ = [
    "LangChainAdapterOptions",
    "LangChainTriksResult",
    "LoadLangChainTriksOptions",
    "create_langchain_tools",
    "load_langchain_triks",
    "parse_tool_name",
    "json_schema_to_pydantic",
]
