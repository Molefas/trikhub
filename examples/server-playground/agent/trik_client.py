"""
HTTP client for trik-server with LangChain tool integration.

This client wraps the trik-server REST API and converts tools to LangChain format.
"""

import requests
from typing import Any, Callable, Optional
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field, create_model


class TrikClient:
    """HTTP client for the Trik Gateway server."""

    def __init__(
        self,
        base_url: str = "http://localhost:3002",
        auth_token: Optional[str] = None,
        on_passthrough: Optional[Callable[[str, dict], None]] = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.on_passthrough = on_passthrough
        self._session_id: Optional[str] = None

        if auth_token:
            self.session.headers["Authorization"] = f"Bearer {auth_token}"

    def health(self) -> dict:
        """Check server health."""
        response = self.session.get(f"{self.base_url}/api/v1/health")
        response.raise_for_status()
        return response.json()

    def get_tools(self) -> dict:
        """Get list of available tools from the server."""
        response = self.session.get(f"{self.base_url}/api/v1/tools")
        response.raise_for_status()
        return response.json()

    def execute(
        self,
        tool: str,
        input_data: dict,
        session_id: Optional[str] = None,
    ) -> dict:
        """
        Execute a tool on the server.

        Args:
            tool: Tool name in format "trikId:actionName"
            input_data: Input matching the tool's inputSchema
            session_id: Optional session ID for multi-turn interactions

        Returns:
            Execution result with responseMode, agentData/userContentRef, etc.
        """
        payload = {"tool": tool, "input": input_data}

        # Use provided session_id or fall back to instance session
        sid = session_id or self._session_id
        if sid:
            payload["sessionId"] = sid

        response = self.session.post(
            f"{self.base_url}/api/v1/execute",
            json=payload,
        )

        # Return error response instead of raising - let caller handle gracefully
        result = response.json()

        if not response.ok:
            print(f"[DEBUG] Request failed: {response.status_code}, input: {input_data}")
            # Return the error response so execute_tool can handle it
            return result

        # Store session ID for future calls
        if result.get("sessionId"):
            self._session_id = result["sessionId"]

        return result

    def get_content(self, ref: str) -> dict:
        """
        Fetch passthrough content by reference.

        Args:
            ref: Content reference ID from execute response

        Returns:
            Content object with the actual content to display
        """
        response = self.session.get(f"{self.base_url}/api/v1/content/{ref}")
        response.raise_for_status()
        return response.json()

    def execute_tool(self, tool_name: str, **kwargs) -> str:
        """
        Execute a tool and handle the response appropriately.

        For template mode: returns the rendered response text
        For passthrough mode: fetches content, calls callback, returns metadata

        Args:
            tool_name: Full tool name (e.g., "article-search-3:search")
            **kwargs: Tool input parameters

        Returns:
            String result for the agent
        """
        # Filter out None values - server doesn't expect them
        filtered_input = {k: v for k, v in kwargs.items() if v is not None}
        result = self.execute(tool_name, filtered_input)

        if not result.get("success"):
            error = result.get("error", "Unknown error")
            return f"Error: {error}"

        response_mode = result.get("responseMode")

        if response_mode == "template":
            # Template mode: agent sees the rendered response
            return result.get("response", "Action completed.")

        elif response_mode == "passthrough":
            # Passthrough mode: fetch content and deliver to user
            content_ref = result.get("userContentRef")
            if content_ref:
                content_result = self.get_content(content_ref)
                if content_result.get("success"):
                    content_data = content_result["content"]
                    content_text = content_data.get("content", "")
                    metadata = content_data.get("metadata", {})

                    # Call passthrough callback if provided
                    if self.on_passthrough:
                        self.on_passthrough(content_text, metadata)

                    # Return metadata summary for agent (not the full content)
                    content_type = result.get("contentType", "content")
                    return f"[{content_type} delivered to user]"

            return "Content delivered to user."

        return result.get("response", "Action completed.")

    def create_langchain_tools(self) -> list[StructuredTool]:
        """
        Fetch tools from trik-server and convert them to LangChain tools.

        Returns:
            List of LangChain StructuredTool objects
        """
        tools_response = self.get_tools()
        tools = []

        for tool_def in tools_response.get("tools", []):
            tool_name = tool_def["name"]
            description = tool_def.get("description", "")
            input_schema = tool_def.get("inputSchema", {})

            # Build args schema from inputSchema
            args_schema = self._build_args_schema(input_schema)

            # Create a closure to capture the tool name
            def make_tool_func(name: str):
                def tool_func(**kwargs) -> str:
                    return self.execute_tool(name, **kwargs)
                return tool_func

            tool = StructuredTool.from_function(
                func=make_tool_func(tool_name),
                name=tool_name.replace(":", "_"),  # LangChain doesn't like colons
                description=description,
                args_schema=args_schema,
            )
            tools.append(tool)

        return tools

    def _build_args_schema(self, input_schema: dict) -> Optional[type]:
        """
        Build a Pydantic model from JSON schema for tool args.
        """
        if not input_schema or input_schema.get("type") != "object":
            return None

        properties = input_schema.get("properties", {})
        required = set(input_schema.get("required", []))

        if not properties:
            return None

        # Map JSON schema types to Python types
        type_map = {
            "string": str,
            "integer": int,
            "number": float,
            "boolean": bool,
            "array": list,
            "object": dict,
        }

        fields = {}
        for prop_name, prop_schema in properties.items():
            json_type = prop_schema.get("type", "string")
            python_type = type_map.get(json_type, str)
            description = prop_schema.get("description", "")

            if prop_name in required:
                fields[prop_name] = (python_type, Field(description=description))
            else:
                fields[prop_name] = (Optional[python_type], Field(default=None, description=description))

        # Create a dynamic Pydantic model
        return create_model("ToolArgs", **fields)


# Convenience function to load tools from server
def load_trik_tools(
    server_url: str = "http://localhost:3002",
    on_passthrough: Optional[Callable[[str, dict], None]] = None,
) -> tuple[list[StructuredTool], TrikClient]:
    """
    Load tools from trik-server.

    Args:
        server_url: URL of the trik-server
        on_passthrough: Callback for passthrough content

    Returns:
        Tuple of (tools list, client instance)
    """
    client = TrikClient(server_url, on_passthrough=on_passthrough)

    # Check server is available
    health = client.health()
    print(f"Connected to trik-server (v{health.get('version', 'unknown')})")
    print(f"Loaded triks: {health.get('triks', {}).get('loaded', 0)}")

    tools = client.create_langchain_tools()
    return tools, client
