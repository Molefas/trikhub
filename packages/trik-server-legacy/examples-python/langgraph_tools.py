"""
LangGraph Tool Adapter - Creates LangChain tools from Skill Gateway.
"""

from typing import Any, Callable, Optional
from langchain_core.tools import StructuredTool
from pydantic import create_model
from pydantic.fields import FieldInfo

from gateway_client import GatewayClient, ToolDefinition


# JSON Schema type → Python type mapping
TYPE_MAP = {"string": str, "integer": int, "number": float, "boolean": bool, "array": list, "object": dict}


def json_schema_to_pydantic(name: str, schema: dict) -> type:
    """Convert JSON Schema to Pydantic model (required by LangChain)."""
    props = schema.get("properties", {})
    required = set(schema.get("required", []))
    fields = {
        k: (TYPE_MAP.get(v.get("type", "string"), Any), FieldInfo(default=... if k in required else None))
        for k, v in props.items()
    }
    return create_model(name, **fields)


def create_gateway_tools(
    client: GatewayClient,
    on_passthrough: Optional[Callable[[str, dict], None]] = None,
) -> list[StructuredTool]:
    """Create LangChain tools from all gateway tools."""
    session_id: Optional[str] = None

    def make_invoker(tool_def: ToolDefinition):
        def invoke(**kwargs) -> str:
            nonlocal session_id
            result = client.execute(tool_def.name, kwargs, session_id=session_id)

            if result.session_id:
                session_id = result.session_id

            if not result.success:
                return f"Error: {result.error}"

            if result.response_mode == "passthrough" and result.user_content_ref:
                content = client.get_content(result.user_content_ref)
                if content and on_passthrough:
                    on_passthrough(content.get("content", ""), content)
                return "[Content delivered to user]"

            return result.response or str(result.agent_data)

        return invoke

    return [
        StructuredTool(
            name=t.name.replace(":", "__"),
            description=t.description,
            func=make_invoker(t),
            args_schema=json_schema_to_pydantic(t.name.replace(":", "_").replace("-", "_") + "_Input", t.input_schema),
        )
        for t in client.get_tools()
    ]
