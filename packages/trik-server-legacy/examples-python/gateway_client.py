"""
Skill Gateway Client

A Python client for interacting with the Skill Gateway HTTP API.
"""

from dataclasses import dataclass
from typing import Any, Optional
import requests


@dataclass
class ToolDefinition:
    name: str
    description: str
    input_schema: dict
    response_mode: str


@dataclass
class ExecuteResult:
    success: bool
    response_mode: Optional[str] = None
    session_id: Optional[str] = None
    # Template mode - resolved response ready for the agent
    response: Optional[str] = None
    agent_data: Optional[dict] = None
    template_text: Optional[str] = None
    # Passthrough mode
    user_content_ref: Optional[str] = None
    content_type: Optional[str] = None
    # Error
    code: Optional[str] = None
    error: Optional[str] = None


class GatewayClient:
    """Client for the Skill Gateway HTTP API."""

    def __init__(self, base_url: str, auth_token: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        if auth_token:
            self.session.headers["Authorization"] = f"Bearer {auth_token}"

    def health(self) -> dict:
        """Check gateway health."""
        resp = self.session.get(f"{self.base_url}/api/v1/health")
        resp.raise_for_status()
        return resp.json()

    def get_tools(self) -> list[ToolDefinition]:
        """Get all available tools from loaded skills."""
        resp = self.session.get(f"{self.base_url}/api/v1/tools")
        resp.raise_for_status()
        data = resp.json()
        return [
            ToolDefinition(
                name=t["name"],
                description=t["description"],
                input_schema=t["inputSchema"],
                response_mode=t["responseMode"],
            )
            for t in data["tools"]
        ]

    def execute(
        self,
        tool: str,
        input_data: dict,
        session_id: Optional[str] = None,
    ) -> ExecuteResult:
        """Execute a skill action."""
        payload = {"tool": tool, "input": input_data}
        if session_id:
            payload["sessionId"] = session_id

        resp = self.session.post(
            f"{self.base_url}/api/v1/execute",
            json=payload,
        )
        data = resp.json()

        return ExecuteResult(
            success=data.get("success", False),
            response_mode=data.get("responseMode"),
            session_id=data.get("sessionId"),
            response=data.get("response"),
            agent_data=data.get("agentData"),
            template_text=data.get("templateText"),
            user_content_ref=data.get("userContentRef"),
            content_type=data.get("contentType"),
            code=data.get("code"),
            error=data.get("error"),
        )

    def get_content(self, ref: str) -> Optional[dict]:
        """Fetch passthrough content by reference."""
        resp = self.session.get(f"{self.base_url}/api/v1/content/{ref}")
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        data = resp.json()
        if data.get("success"):
            return data["content"]
        return None


# Example usage
if __name__ == "__main__":
    client = GatewayClient("http://localhost:3000")

    # Check health
    print("Health:", client.health())

    # Get tools
    tools = client.get_tools()
    print(f"\nAvailable tools ({len(tools)}):")
    for tool in tools:
        print(f"  - {tool.name}: {tool.description}")

    # Execute a tool (if article-search is loaded)
    if any(t.name == "article-search:search" for t in tools):
        result = client.execute("article-search:search", {"query": "AI"})
        print(f"\nExecute result: {result}")
