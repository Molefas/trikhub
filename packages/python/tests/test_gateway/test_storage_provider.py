"""Tests for InMemoryStorageProvider and SqliteStorageProvider."""

import tempfile

import pytest

from trikhub.gateway.storage_provider import InMemoryStorageProvider, SqliteStorageProvider


@pytest.mark.asyncio
async def test_get_set():
    provider = InMemoryStorageProvider()
    ctx = provider.for_trik("trik-1")

    await ctx.set("key1", "value1")
    assert await ctx.get("key1") == "value1"


@pytest.mark.asyncio
async def test_get_missing():
    provider = InMemoryStorageProvider()
    ctx = provider.for_trik("trik-1")
    assert await ctx.get("missing") is None


@pytest.mark.asyncio
async def test_delete():
    provider = InMemoryStorageProvider()
    ctx = provider.for_trik("trik-1")

    await ctx.set("key1", "value1")
    assert await ctx.delete("key1") is True
    assert await ctx.get("key1") is None
    assert await ctx.delete("key1") is False


@pytest.mark.asyncio
async def test_list():
    provider = InMemoryStorageProvider()
    ctx = provider.for_trik("trik-1")

    await ctx.set("prefix:a", 1)
    await ctx.set("prefix:b", 2)
    await ctx.set("other", 3)

    all_keys = await ctx.list()
    assert sorted(all_keys) == ["other", "prefix:a", "prefix:b"]

    prefix_keys = await ctx.list("prefix:")
    assert sorted(prefix_keys) == ["prefix:a", "prefix:b"]


@pytest.mark.asyncio
async def test_get_many():
    provider = InMemoryStorageProvider()
    ctx = provider.for_trik("trik-1")

    await ctx.set("a", 1)
    await ctx.set("b", 2)
    await ctx.set("c", 3)

    result = await ctx.get_many(["a", "c", "missing"])
    assert result == {"a": 1, "c": 3}


@pytest.mark.asyncio
async def test_set_many():
    provider = InMemoryStorageProvider()
    ctx = provider.for_trik("trik-1")

    await ctx.set_many({"x": 10, "y": 20})
    assert await ctx.get("x") == 10
    assert await ctx.get("y") == 20


@pytest.mark.asyncio
async def test_trik_isolation():
    provider = InMemoryStorageProvider()
    ctx1 = provider.for_trik("trik-1")
    ctx2 = provider.for_trik("trik-2")

    await ctx1.set("key", "val1")
    await ctx2.set("key", "val2")

    assert await ctx1.get("key") == "val1"
    assert await ctx2.get("key") == "val2"


@pytest.mark.asyncio
async def test_provider_get_usage():
    provider = InMemoryStorageProvider()
    ctx = provider.for_trik("trik-1")
    await ctx.set("key", "value")

    usage = await provider.get_usage("trik-1")
    assert usage > 0


@pytest.mark.asyncio
async def test_provider_clear():
    provider = InMemoryStorageProvider()
    ctx = provider.for_trik("trik-1")
    await ctx.set("key", "value")

    await provider.clear("trik-1")
    triks = await provider.list_triks()
    assert "trik-1" not in triks


@pytest.mark.asyncio
async def test_provider_list_triks():
    provider = InMemoryStorageProvider()
    provider.for_trik("trik-1")
    provider.for_trik("trik-2")

    triks = await provider.list_triks()
    assert sorted(triks) == ["trik-1", "trik-2"]


@pytest.mark.asyncio
async def test_complex_values():
    provider = InMemoryStorageProvider()
    ctx = provider.for_trik("trik-1")

    await ctx.set("data", {"nested": [1, 2, 3], "flag": True})
    result = await ctx.get("data")
    assert result == {"nested": [1, 2, 3], "flag": True}


# ============================================================================
# SqliteStorageProvider Tests
# ============================================================================


class TestSqliteStorageProvider:
    @pytest.mark.asyncio
    async def test_get_set(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            provider = SqliteStorageProvider(base_dir=tmpdir)
            ctx = provider.for_trik("trik-1")

            await ctx.set("key1", "value1")
            assert await ctx.get("key1") == "value1"
            provider.close()

    @pytest.mark.asyncio
    async def test_get_missing(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            provider = SqliteStorageProvider(base_dir=tmpdir)
            ctx = provider.for_trik("trik-1")
            assert await ctx.get("missing") is None
            provider.close()

    @pytest.mark.asyncio
    async def test_delete(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            provider = SqliteStorageProvider(base_dir=tmpdir)
            ctx = provider.for_trik("trik-1")

            await ctx.set("key1", "value1")
            assert await ctx.delete("key1") is True
            assert await ctx.get("key1") is None
            assert await ctx.delete("key1") is False
            provider.close()

    @pytest.mark.asyncio
    async def test_list(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            provider = SqliteStorageProvider(base_dir=tmpdir)
            ctx = provider.for_trik("trik-1")

            await ctx.set("prefix:a", 1)
            await ctx.set("prefix:b", 2)
            await ctx.set("other", 3)

            all_keys = await ctx.list()
            assert sorted(all_keys) == ["other", "prefix:a", "prefix:b"]

            prefix_keys = await ctx.list("prefix:")
            assert sorted(prefix_keys) == ["prefix:a", "prefix:b"]
            provider.close()

    @pytest.mark.asyncio
    async def test_get_many(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            provider = SqliteStorageProvider(base_dir=tmpdir)
            ctx = provider.for_trik("trik-1")

            await ctx.set("a", 1)
            await ctx.set("b", 2)
            await ctx.set("c", 3)

            result = await ctx.get_many(["a", "c", "missing"])
            assert result == {"a": 1, "c": 3}
            provider.close()

    @pytest.mark.asyncio
    async def test_set_many(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            provider = SqliteStorageProvider(base_dir=tmpdir)
            ctx = provider.for_trik("trik-1")

            await ctx.set_many({"x": 10, "y": 20})
            assert await ctx.get("x") == 10
            assert await ctx.get("y") == 20
            provider.close()

    @pytest.mark.asyncio
    async def test_trik_isolation(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            provider = SqliteStorageProvider(base_dir=tmpdir)
            ctx1 = provider.for_trik("trik-1")
            ctx2 = provider.for_trik("trik-2")

            await ctx1.set("key", "val1")
            await ctx2.set("key", "val2")

            assert await ctx1.get("key") == "val1"
            assert await ctx2.get("key") == "val2"
            provider.close()

    @pytest.mark.asyncio
    async def test_ttl_expiry(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            provider = SqliteStorageProvider(base_dir=tmpdir)
            ctx = provider.for_trik("trik-1")

            # Set with a TTL of 1ms (will expire immediately)
            await ctx.set("expiring", "value", ttl=1)

            # Wait briefly to ensure expiry
            import time
            time.sleep(0.01)

            assert await ctx.get("expiring") is None
            provider.close()

    @pytest.mark.asyncio
    async def test_quota_enforcement(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            from trikhub.manifest import StorageCapabilities
            provider = SqliteStorageProvider(base_dir=tmpdir)
            # Set a very small quota
            ctx = provider.for_trik("trik-1", StorageCapabilities(enabled=True, maxSizeBytes=50))

            await ctx.set("small", "ok")
            with pytest.raises(ValueError, match="Storage quota exceeded"):
                await ctx.set("large", "x" * 100)
            provider.close()

    @pytest.mark.asyncio
    async def test_persistence_across_contexts(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            # Write with one provider
            provider1 = SqliteStorageProvider(base_dir=tmpdir)
            ctx1 = provider1.for_trik("trik-1")
            await ctx1.set("persistent", "data")
            provider1.close()

            # Read with a new provider instance (simulates restart)
            provider2 = SqliteStorageProvider(base_dir=tmpdir)
            ctx2 = provider2.for_trik("trik-1")
            assert await ctx2.get("persistent") == "data"
            provider2.close()

    @pytest.mark.asyncio
    async def test_provider_get_usage(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            provider = SqliteStorageProvider(base_dir=tmpdir)
            ctx = provider.for_trik("trik-1")
            await ctx.set("key", "value")

            usage = await provider.get_usage("trik-1")
            assert usage > 0
            provider.close()

    @pytest.mark.asyncio
    async def test_provider_clear(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            provider = SqliteStorageProvider(base_dir=tmpdir)
            ctx = provider.for_trik("trik-1")
            await ctx.set("key", "value")

            await provider.clear("trik-1")
            triks = await provider.list_triks()
            assert "trik-1" not in triks
            provider.close()

    @pytest.mark.asyncio
    async def test_provider_list_triks(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            provider = SqliteStorageProvider(base_dir=tmpdir)
            ctx1 = provider.for_trik("trik-1")
            ctx2 = provider.for_trik("trik-2")
            await ctx1.set("k", "v")
            await ctx2.set("k", "v")

            triks = await provider.list_triks()
            assert sorted(triks) == ["trik-1", "trik-2"]
            provider.close()

    @pytest.mark.asyncio
    async def test_complex_values(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            provider = SqliteStorageProvider(base_dir=tmpdir)
            ctx = provider.for_trik("trik-1")

            await ctx.set("data", {"nested": [1, 2, 3], "flag": True})
            result = await ctx.get("data")
            assert result == {"nested": [1, 2, 3], "flag": True}
            provider.close()

    def test_get_db_path(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            provider = SqliteStorageProvider(base_dir=tmpdir)
            assert provider.get_db_path().endswith("storage.db")
            provider.close()

    def test_close(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            provider = SqliteStorageProvider(base_dir=tmpdir)
            provider.for_trik("trik-1")
            provider.close()
            # After close, connection is closed — no crash expected
