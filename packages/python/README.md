# TrikHub Python SDK

Python SDK for TrikHub - AI skills marketplace.

## Installation

```bash
pip install trikhub
```

## Quick Start

```python
from trikhub import TrikGateway

# Initialize the gateway
gateway = TrikGateway()
await gateway.initialize()

# Load triks from config
await gateway.load_triks_from_config()

# Get available tool definitions
tools = gateway.get_tool_definitions()
```

## CLI Usage

```bash
# Install a trik
trik install @scope/trik-name

# List installed triks
trik list

# Search for triks
trik search "topic"
```

## Documentation

For full documentation, visit [docs.trikhub.com](https://docs.trikhub.com).

## License

MIT
