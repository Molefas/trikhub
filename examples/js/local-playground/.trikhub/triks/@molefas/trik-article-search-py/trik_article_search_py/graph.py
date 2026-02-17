"""
Article Search Trik - Python Implementation

This trik demonstrates type-directed privilege separation with session support.
It provides three actions:
- search: Search for articles by topic (template response)
- details: Get full article content (passthrough response)
- list: List article summaries (passthrough response)
"""

from __future__ import annotations

import json
from typing import Any, Literal

from .data import ARTICLES, get_article_by_id, Article
from .llm import detect_provider, create_llm_client, LLMClient, LLMMessage


TopicCategory = Literal["AI", "technology", "science", "health", "business", "other"]


class ArticleSearchGraph:
    """Main graph for the Article Search trik."""

    async def invoke(self, input_data: dict[str, Any]) -> dict[str, Any]:
        """
        Main entry point called by the TrikHub gateway.

        Args:
            input_data: Contains action, input, session, and config

        Returns:
            Response with responseMode and agentData/userContent
        """
        action = input_data.get("action")
        action_input = input_data.get("input", {})
        session = input_data.get("session", {})
        config = input_data.get("config")
        history = session.get("history", [])

        if not config:
            print("[Trik] No config provided")
            return {"responseMode": "template", "agentData": {"template": "error"}}

        llm_config = detect_provider(config)
        print(
            f"[Trik] invoke called: action={action}, provider={llm_config.provider if llm_config else 'none'}"
        )

        if not llm_config:
            print(
                "[Trik] No API key found (checked ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY)"
            )
            return {"responseMode": "template", "agentData": {"template": "error"}}

        llm = create_llm_client(llm_config)

        if action == "search":
            return await self._handle_search(action_input.get("topic", ""), llm)
        elif action == "details":
            return await self._handle_details(
                action_input.get("articleId"),
                action_input.get("reference"),
                history,
                llm,
            )
        elif action == "list":
            return self._handle_list(action_input.get("articleIds"), history)
        else:
            return {"responseMode": "template", "agentData": {"template": "error"}}

    async def _handle_search(
        self, topic: str, llm: LLMClient
    ) -> dict[str, Any]:
        """Handle the search action."""
        if not topic or not isinstance(topic, str):
            return {"responseMode": "template", "agentData": {"template": "error"}}

        # Build article summaries for the LLM
        article_summaries = "\n".join(
            f'- {a.id}: "{a.title}" (topics: {", ".join(a.topics)})'
            for a in ARTICLES
        )

        try:
            prompt = f'''Given this search query: "{topic}"
Available articles:
{article_summaries}

Which articles are relevant to this query? Also categorize the query into one of these topics: AI, technology, science, health, business, other.

Reply in JSON format only, no other text:
{{"matchingIds": ["art-001", "art-002"], "topic": "AI"}}'''

            text = await llm.complete([LLMMessage(role="user", content=prompt)])
            result = json.loads(text)
            matching_ids: list[str] = result.get("matchingIds", [])
            normalized_topic: TopicCategory = result.get("topic", "other")

            if len(matching_ids) == 0:
                return {
                    "responseMode": "template",
                    "agentData": {
                        "template": "empty",
                        "count": 0,
                        "topic": normalized_topic,
                        "articleIds": [],
                    },
                }

            return {
                "responseMode": "template",
                "agentData": {
                    "template": "success",
                    "count": len(matching_ids),
                    "topic": normalized_topic,
                    "articleIds": matching_ids,
                },
            }

        except Exception as e:
            print(f"[Trik] LLM search failed: {e}")
            return {"responseMode": "template", "agentData": {"template": "error"}}

    async def _resolve_reference(
        self,
        reference: str,
        history: list[dict[str, Any]],
        llm: LLMClient,
    ) -> str | None:
        """Resolve a natural language reference to an article ID."""
        # Build history context
        if history:
            history_parts = []
            for i, entry in enumerate(history):
                content = f"[{i + 1}] Action: {entry.get('action')}"
                user_content = entry.get("userContent")
                if user_content and isinstance(user_content, dict):
                    if "content" in user_content:
                        content += f"\nContent: {user_content['content']}"
                agent_data = entry.get("agentData")
                if agent_data and isinstance(agent_data, dict):
                    if "articleIds" in agent_data:
                        content += f"\nArticle IDs: {', '.join(agent_data['articleIds'])}"
                history_parts.append(content)
            history_context = "\n\n".join(history_parts)
        else:
            history_context = "No previous conversation."

        article_summaries = "\n".join(
            f'- {a.id}: "{a.title}" (topics: {", ".join(a.topics)})'
            for a in ARTICLES
        )

        try:
            prompt = f'''Based on the conversation history and available articles, what article ID does "{reference}" refer to?
Available articles:
{article_summaries}

Conversation history:
{history_context}

Reply with ONLY the article ID (e.g., "art-001") or "null" if you cannot determine it.'''

            text = await llm.complete([LLMMessage(role="user", content=prompt)], max_tokens=50)
            text = text.strip().strip('"')
            return None if text == "null" or text == "" else text

        except Exception as e:
            print(f"[Trik] LLM reference resolution failed: {e}")
            return None

    async def _handle_details(
        self,
        article_id: str | None,
        reference: str | None,
        history: list[dict[str, Any]],
        llm: LLMClient,
    ) -> dict[str, Any]:
        """Handle the details action."""
        target_id = article_id

        if not target_id and reference:
            target_id = await self._resolve_reference(reference, history, llm)

        if not target_id:
            return {"responseMode": "template", "agentData": {"template": "not_found"}}

        article = get_article_by_id(target_id)
        if not article:
            return {"responseMode": "template", "agentData": {"template": "not_found"}}

        return {
            "responseMode": "passthrough",
            "userContent": {
                "contentType": "article",
                "content": f"# {article.title}\n\n{article.summary}\n\n{article.content}",
                "metadata": {"title": article.title, "articleId": article.id},
            },
        }

    def _handle_list(
        self,
        article_ids: list[str] | None,
        history: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Handle the list action."""
        target_ids = article_ids

        # If no IDs provided, find from session history
        if not target_ids or len(target_ids) == 0:
            for entry in reversed(history):
                if entry.get("action") == "search":
                    agent_data = entry.get("agentData")
                    if agent_data and isinstance(agent_data, dict):
                        ids = agent_data.get("articleIds")
                        if ids and len(ids) > 0:
                            target_ids = ids
                            break

        if not target_ids or len(target_ids) == 0:
            return {"responseMode": "template", "agentData": {"template": "no_articles"}}

        articles: list[Article] = []
        for id_ in target_ids:
            article = get_article_by_id(id_)
            if article:
                articles.append(article)

        if len(articles) == 0:
            return {"responseMode": "template", "agentData": {"template": "no_articles"}}

        # Format as markdown list
        formatted_list = "\n\n".join(
            f"{i + 1}. **{article.title}**\n   {article.summary}"
            for i, article in enumerate(articles)
        )

        return {
            "responseMode": "passthrough",
            "userContent": {
                "contentType": "article-list",
                "content": formatted_list,
                "metadata": {"count": len(articles)},
            },
        }


# Export the graph instance
graph = ArticleSearchGraph()
