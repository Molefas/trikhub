"""
TrikHub LangChain/LangGraph Adapter

Wraps LangGraph agents with TrikHub handoff routing.
Mirrors packages/js/gateway/src/langchain/adapter.ts.
"""

from trikhub.langchain.adapter import (
    EnhancedAgent,
    EnhancedResponse,
    EnhanceOptions,
    InvokableAgent,
    enhance,
    get_exposed_tools_for_agent,
    get_handoff_tools_for_agent,
)
from trikhub.langchain.schema_converter import (
    json_schema_to_field,
    json_schema_to_pydantic,
)

__all__ = [
    # Main API
    "enhance",
    "EnhancedAgent",
    "EnhancedResponse",
    "EnhanceOptions",
    "InvokableAgent",
    # Tool helpers
    "get_handoff_tools_for_agent",
    "get_exposed_tools_for_agent",
    # Schema conversion
    "json_schema_to_pydantic",
    "json_schema_to_field",
]
