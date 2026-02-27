"""Tests for JSON Schema → Pydantic model converter."""

import pytest
from pydantic import ValidationError

from trikhub.langchain.schema_converter import (
    json_schema_to_field,
    json_schema_to_pydantic,
)


# ============================================================================
# String fields
# ============================================================================


class TestStringSchema:
    def test_basic_string(self):
        model = json_schema_to_pydantic(
            {"type": "string", "description": "A name"}, "NameModel"
        )
        instance = model(value="hello")
        assert instance.value == "hello"

    def test_string_with_max_length(self):
        model = json_schema_to_pydantic(
            {"type": "string", "maxLength": 5}, "ShortModel"
        )
        instance = model(value="hi")
        assert instance.value == "hi"
        with pytest.raises(ValidationError):
            model(value="toolongstring")

    def test_string_with_format_adds_hint(self):
        _, field_info = json_schema_to_field(
            {"type": "string", "format": "uri", "description": "A URL"}
        )
        assert "format: uri" in (field_info.description or "")
        assert "A URL" in (field_info.description or "")

    def test_string_with_pattern(self):
        model = json_schema_to_pydantic(
            {"type": "string", "pattern": r"^[a-z]+$"}, "PatternModel"
        )
        instance = model(value="abc")
        assert instance.value == "abc"
        with pytest.raises(ValidationError):
            model(value="ABC123")


# ============================================================================
# Number fields
# ============================================================================


class TestNumberSchema:
    def test_integer(self):
        model = json_schema_to_pydantic({"type": "integer"}, "IntModel")
        instance = model(value=42)
        assert instance.value == 42

    def test_number_with_bounds(self):
        model = json_schema_to_pydantic(
            {"type": "number", "minimum": 0, "maximum": 100}, "BoundedModel"
        )
        instance = model(value=50.5)
        assert instance.value == 50.5
        with pytest.raises(ValidationError):
            model(value=101)
        with pytest.raises(ValidationError):
            model(value=-1)

    def test_integer_type(self):
        field_type, _ = json_schema_to_field({"type": "integer"})
        assert field_type is int

    def test_number_type(self):
        field_type, _ = json_schema_to_field({"type": "number"})
        assert field_type is float


# ============================================================================
# Boolean fields
# ============================================================================


class TestBooleanSchema:
    def test_boolean(self):
        model = json_schema_to_pydantic({"type": "boolean"}, "BoolModel")
        instance = model(value=True)
        assert instance.value is True


# ============================================================================
# Enum fields
# ============================================================================


class TestEnumSchema:
    def test_enum_values(self):
        model = json_schema_to_pydantic(
            {"enum": ["a", "b", "c"], "description": "Pick one"}, "EnumModel"
        )
        instance = model(value="a")
        assert instance.value == "a"

    def test_empty_enum_raises(self):
        with pytest.raises(ValueError, match="empty enum"):
            json_schema_to_pydantic({"enum": []}, "EmptyEnum")

    def test_enum_field(self):
        _, field_info = json_schema_to_field(
            {"enum": ["x", "y"], "description": "Choice"}
        )
        assert field_info.description == "Choice"


# ============================================================================
# Object schemas
# ============================================================================


class TestObjectSchema:
    def test_simple_object(self):
        model = json_schema_to_pydantic(
            {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "User name"},
                    "age": {"type": "integer"},
                },
                "required": ["name"],
            },
            "UserModel",
        )
        instance = model(name="Alice", age=30)
        assert instance.name == "Alice"
        assert instance.age == 30

    def test_optional_fields_default_none(self):
        model = json_schema_to_pydantic(
            {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "bio": {"type": "string"},
                },
                "required": ["name"],
            },
            "OptModel",
        )
        instance = model(name="Bob")
        assert instance.name == "Bob"
        assert instance.bio is None

    def test_required_fields_validated(self):
        model = json_schema_to_pydantic(
            {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                },
                "required": ["query"],
            },
            "RequiredModel",
        )
        with pytest.raises(ValidationError):
            model()  # missing required 'query'


# ============================================================================
# Unsupported types
# ============================================================================


class TestUnsupported:
    def test_ref_raises(self):
        with pytest.raises(ValueError, match="\\$ref"):
            json_schema_to_pydantic({"$ref": "#/foo"}, "RefModel")

    def test_array_raises(self):
        with pytest.raises(ValueError, match="array"):
            json_schema_to_pydantic({"type": "array"}, "ArrayModel")

    def test_unknown_type_raises(self):
        with pytest.raises(ValueError, match="unsupported"):
            json_schema_to_pydantic({"type": "null"}, "NullModel")
