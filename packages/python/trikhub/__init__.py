"""
TrikHub Python SDK

Provides Python support for the TrikHub ecosystem:
- Native Python trik execution
- Cross-language trik execution via Node.js worker
- CLI for managing Python triks
"""

__version__ = "0.17.0"

from trikhub.gateway.gateway import TrikGateway

__all__ = [
    "TrikGateway",
    "__version__",
]
