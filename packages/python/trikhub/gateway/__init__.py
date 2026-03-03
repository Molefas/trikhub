"""
TrikHub Python Gateway

Loads Python triks natively and JavaScript triks via Node.js subprocess.
Provides message routing, handoff session management, and tool-mode execution.
"""

from trikhub.gateway.gateway import (
    ExposedToolDefinition,
    HandoffToolDefinition,
    LoadFromConfigOptions,
    RouteForceBack,
    RouteResult,
    RouteToMain,
    RouteToTrik,
    RouteTransferBack,
    TrikGateway,
    TrikGatewayConfig,
)
from trikhub.gateway.config_store import (
    ConfigStore,
    FileConfigStore,
    InMemoryConfigStore,
)
from trikhub.gateway.node_worker import (
    NodeWorker,
    NodeWorkerConfig,
)
from trikhub.gateway.container_manager import (
    ContainerWorkerHandle,
    ContainerOptions,
    ContainerManagerConfig,
    DockerContainerManager,
)
from trikhub.gateway.session_storage import (
    InMemorySessionStorage,
    SessionStorage,
)
from trikhub.gateway.storage_provider import (
    InMemoryStorageProvider,
    SqliteStorageProvider,
    StorageProvider,
)

__all__ = [
    # Gateway
    "TrikGateway",
    "TrikGatewayConfig",
    "LoadFromConfigOptions",
    # Route results
    "RouteResult",
    "RouteToMain",
    "RouteToTrik",
    "RouteTransferBack",
    "RouteForceBack",
    # Tool definitions
    "HandoffToolDefinition",
    "ExposedToolDefinition",
    # Config
    "ConfigStore",
    "FileConfigStore",
    "InMemoryConfigStore",
    # Node worker
    "NodeWorker",
    "NodeWorkerConfig",
    # Container manager
    "ContainerWorkerHandle",
    "ContainerOptions",
    "ContainerManagerConfig",
    "DockerContainerManager",
    # Session storage
    "SessionStorage",
    "InMemorySessionStorage",
    # Storage provider
    "StorageProvider",
    "InMemoryStorageProvider",
    "SqliteStorageProvider",
]
