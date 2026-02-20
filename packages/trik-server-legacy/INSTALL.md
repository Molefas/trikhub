# Installing as Home Assistant Addon

## Option 1: Local Addon (Development)

1. Copy the entire `skill-poc-v2` repo to your HA addons folder:
   ```bash
   cp -r skill-poc-v2 /addons/skill-gateway
   ```

2. In Home Assistant, go to **Settings > Add-ons > Add-on Store**

3. Click the three dots (top right) > **Repositories**

4. Add your local path or refresh

5. Find "Skill Gateway" and install

## Option 2: Build and Push Image

1. Build the Docker image:
   ```bash
   cd skill-poc-v2
   docker build -f packages/skill-server/Dockerfile.addon -t skill-gateway:latest .
   ```

2. Tag and push to your registry:
   ```bash
   docker tag skill-gateway:latest your-registry/skill-gateway:latest
   docker push your-registry/skill-gateway:latest
   ```

3. Update `config.yaml` to reference your image

## Configuration

After installing, configure the addon:

| Option | Description | Default |
|--------|-------------|---------|
| `skills_dir` | Path to skills directory | `/share/skills` |
| `port` | Server port | `3000` |
| `log_level` | Logging level | `info` |
| `lint_on_load` | Validate skills before loading | `true` |
| `auth_token` | Optional bearer token for API auth | (empty) |

## Adding Skills

1. Create a folder in `/share/skills/` (or your configured path)
2. Add `manifest.json` and `graph.ts` (see template)
3. Restart the addon

## API Endpoints

Once running, the addon exposes:

- `GET http://homeassistant.local:3000/api/v1/health` - Health check
- `GET http://homeassistant.local:3000/api/v1/tools` - List available tools
- `POST http://homeassistant.local:3000/api/v1/execute` - Execute a skill action
- `GET http://homeassistant.local:3000/api/v1/content/:ref` - Get passthrough content

## Connecting Your Agent

From your Python agent:

```python
import requests

GATEWAY_URL = "http://homeassistant.local:3000"

# Get available tools
tools = requests.get(f"{GATEWAY_URL}/api/v1/tools").json()

# Execute a tool
result = requests.post(
    f"{GATEWAY_URL}/api/v1/execute",
    json={
        "tool": "my-skill:my-action",
        "input": {"query": "hello"}
    }
).json()
```
