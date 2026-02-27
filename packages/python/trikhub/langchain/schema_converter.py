"""
JSON Schema → Pydantic model converter.

Converts JSON Schema objects (from manifest inputSchema/outputSchema)
into Pydantic models for use with LangChain StructuredTool.

Mirrors packages/js/gateway/src/langchain/schema-converter.ts
"""

from __future__ import annotations

from typing import Any

from pydantic import Field, create_model


def json_schema_to_pydantic(
    schema: dict[str, Any], model_name: str = "DynamicModel"
) -> type:
    """
    Convert a JSON Schema definition to a Pydantic model class.

    Supports: string (maxLength, enum), number, integer, boolean,
    object with properties + required, and description passthrough.

    Raises ValueError on unsupported constructs ($ref, oneOf, anyOf, allOf, arrays).
    """
    # Enum at top level
    if "enum" in schema:
        values = schema["enum"]
        if not values:
            raise ValueError("json_schema_to_pydantic: empty enum is not supported")
        # Return a model with a single 'value' field constrained to enum values
        # For top-level enums, we create a Literal type
        from typing import Literal

        literal_type = Literal[tuple(str(v) for v in values)]  # type: ignore[valid-type]
        field_kwargs: dict[str, Any] = {}
        if schema.get("description"):
            field_kwargs["description"] = schema["description"]
        return create_model(
            model_name,
            value=(literal_type, Field(**field_kwargs)),
        )

    schema_type = schema.get("type")

    if schema_type == "object":
        return _build_object_model(schema, model_name)

    # For non-object types, wrap in a single-field model
    field_type, field_info = _build_field(schema)
    return create_model(model_name, value=(field_type, field_info))


def json_schema_to_field(schema: dict[str, Any]) -> tuple[type, Any]:
    """
    Convert a JSON Schema property into a (type, Field) tuple
    suitable for use in Pydantic create_model().
    """
    return _build_field(schema)


def _build_object_model(
    schema: dict[str, Any], model_name: str = "DynamicModel"
) -> type:
    """Build a Pydantic model from an object-type JSON Schema."""
    properties = schema.get("properties")
    if not properties:
        # Object with no properties — use a plain dict
        field_kwargs: dict[str, Any] = {}
        if schema.get("description"):
            field_kwargs["description"] = schema["description"]
        return create_model(
            model_name,
            __root__=(dict[str, Any], Field(default_factory=dict, **field_kwargs)),
        )

    required_set = set(schema.get("required", []))
    fields: dict[str, Any] = {}

    for key, prop_schema in properties.items():
        field_type, field_info = _build_field(prop_schema)
        if key not in required_set:
            # Optional field with None default
            field_type = field_type | None  # type: ignore[assignment]
            field_info = Field(default=None, description=field_info.description)
        fields[key] = (field_type, field_info)

    model = create_model(model_name, **fields)
    if schema.get("description"):
        model.__doc__ = schema["description"]
    return model


def _build_field(schema: dict[str, Any]) -> tuple[type, Any]:
    """Convert a single JSON Schema property to a (type, Field) tuple."""
    # Enum
    if "enum" in schema:
        values = schema["enum"]
        if not values:
            raise ValueError("json_schema_to_pydantic: empty enum is not supported")
        from typing import Literal

        literal_type = Literal[tuple(str(v) for v in values)]  # type: ignore[valid-type]
        kwargs: dict[str, Any] = {}
        if schema.get("description"):
            kwargs["description"] = schema["description"]
        return literal_type, Field(**kwargs)  # type: ignore[return-value]

    schema_type = schema.get("type")

    if schema_type == "string":
        return _build_string_field(schema)
    if schema_type in ("number", "integer"):
        return _build_number_field(schema)
    if schema_type == "boolean":
        kwargs = {}
        if schema.get("description"):
            kwargs["description"] = schema["description"]
        return bool, Field(**kwargs)
    if schema_type == "object":
        # Nested object — build a sub-model
        sub_model = _build_object_model(schema, "NestedModel")
        kwargs = {}
        if schema.get("description"):
            kwargs["description"] = schema["description"]
        return sub_model, Field(**kwargs)

    # Unsupported constructs
    if "$ref" in schema:
        raise ValueError("json_schema_to_pydantic: $ref is not supported")
    if schema_type == "array":
        raise ValueError("json_schema_to_pydantic: array type is not supported")
    if isinstance(schema_type, list):
        raise ValueError("json_schema_to_pydantic: union types are not supported")

    raise ValueError(
        f'json_schema_to_pydantic: unsupported schema type "{schema_type}"'
    )


def _build_string_field(schema: dict[str, Any]) -> tuple[type, Any]:
    """Build a string field from JSON Schema."""
    kwargs: dict[str, Any] = {}

    if schema.get("maxLength") is not None:
        kwargs["max_length"] = schema["maxLength"]
    if schema.get("minLength") is not None:
        kwargs["min_length"] = schema["minLength"]
    if schema.get("pattern"):
        kwargs["pattern"] = schema["pattern"]

    desc = schema.get("description", "")
    if schema.get("format"):
        format_hint = f"(format: {schema['format']})"
        desc = f"{desc} {format_hint}" if desc else format_hint
    if desc:
        kwargs["description"] = desc

    return str, Field(**kwargs)


def _build_number_field(schema: dict[str, Any]) -> tuple[type, Any]:
    """Build a number/integer field from JSON Schema."""
    is_integer = schema.get("type") == "integer"
    field_type: type = int if is_integer else float
    kwargs: dict[str, Any] = {}

    if schema.get("minimum") is not None:
        kwargs["ge"] = schema["minimum"]
    if schema.get("maximum") is not None:
        kwargs["le"] = schema["maximum"]
    if schema.get("description"):
        kwargs["description"] = schema["description"]

    return field_type, Field(**kwargs)
