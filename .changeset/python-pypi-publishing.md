---
"@trikhub/gateway": patch
---

Added cross-language trik support for Python environments running Node.js triks via worker subprocess.

Python SDK (`trikhub`) updates:
- Version bump to 0.5.0 to align with JS packages
- Added automated PyPI publishing to release workflow
- Node.js worker subprocess for executing JS triks from Python
- NVM auto-detection for Node.js executable discovery
- Git clone approach for cross-language trik installation
