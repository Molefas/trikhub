"""
Convert JSON Schema to Pydantic models for LangChain tool schemas.

This module provides utilities to dynamically create Pydantic models
from JSON Schema definitions, which are used by LangChain tools.
"""

from __future__ import annotations

from typing import Any, get_origin

from pydantic import BaseModel, Field, create_model


def json_schema_to_pydantic(
    schema: dict[str, Any],
    model_name: str = "DynamicModel",
) -> type[BaseModel]:
    """
    Convert a JSON Schema to a Pydantic model.

    Args:
        schema: JSON Schema dictionary (must be an object schema)
        model_name: Name for the generated Pydantic model

    Returns:
        A dynamically created Pydantic model class
    """
    if schema.get("type") != "object":
        # For non-object schemas, wrap in a simple model
        return create_model(model_name, value=(_get_python_type(schema), ...))

    properties = schema.get("properties", {})
    required = set(schema.get("required", []))

    field_definitions: dict[str, Any] = {}

    for prop_name, prop_schema in properties.items():
        python_type = _get_python_type(prop_schema)
        description = prop_schema.get("description", "")

        if prop_name in required:
            # Required field
            field_definitions[prop_name] = (
                python_type,
                Field(description=description) if description else ...,
            )
        else:
            # Optional field (also nullable for OpenAI compatibility)
            field_definitions[prop_name] = (
                python_type | None,
                Field(default=None, description=description) if description else None,
            )

    return create_model(model_name, **field_definitions)


def _get_python_type(schema: dict[str, Any]) -> type:
    """
    Convert a JSON Schema type to a Python type.

    Args:
        schema: JSON Schema dictionary

    Returns:
        Corresponding Python type
    """
    schema_type = schema.get("type")

    # Handle enum
    if "enum" in schema:
        from typing import Literal

        enum_values = tuple(schema["enum"])
        return Literal[enum_values]  # type: ignore

    # Handle basic types
    if schema_type == "string":
        return str
    elif schema_type == "number":
        return float
    elif schema_type == "integer":
        return int
    elif schema_type == "boolean":
        return bool
    elif schema_type == "null":
        return type(None)
    elif schema_type == "array":
        items_schema = schema.get("items", {})
        item_type = _get_python_type(items_schema)
        return list[item_type]  # type: ignore
    elif schema_type == "object":
        # Nested objects become dict
        return dict[str, Any]
    else:
        # Unknown type
        return Any  # type: ignore


def pydantic_to_json_schema(model: type[BaseModel]) -> dict[str, Any]:
    """
    Convert a Pydantic model to JSON Schema.

    This is useful for debugging and verification.

    Args:
        model: A Pydantic model class

    Returns:
        JSON Schema dictionary
    """
    return model.model_json_schema()
