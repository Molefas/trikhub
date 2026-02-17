"""
TrikHub Python SDK

Provides Python support for the TrikHub ecosystem:
- Native Python trik execution
- Cross-language trik execution via Node.js worker
- CLI for managing Python triks
- Optional HTTP server
"""

__version__ = "0.5.0"

from trikhub.gateway.gateway import TrikGateway
from trikhub.gateway.worker_protocol import (
    WorkerProtocol,
    InvokeParams,
    InvokeResult,
    WorkerErrorCodes,
)

__all__ = [
    "TrikGateway",
    "WorkerProtocol",
    "InvokeParams",
    "InvokeResult",
    "WorkerErrorCodes",
    "__version__",
]
