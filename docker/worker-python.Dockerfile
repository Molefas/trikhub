# TrikHub Python Worker Image
#
# Generic worker image for running containerized Python triks.
# The trik source is mounted at runtime, not baked into the image.
#
# Build:
#   docker build -f docker/worker-python.Dockerfile -t trikhub/worker-python:3.12 .
#
# Run:
#   docker run -i --rm \
#     -v ~/.trikhub/workspace/<trik-id>:/workspace \
#     -v /path/to/trik:/trik:ro \
#     trikhub/worker-python:3.12

FROM python:3.12-slim

# Create workspace and trik mount points
RUN mkdir -p /workspace /trik

# Install the TrikHub Python package (worker + SDK)
WORKDIR /trikhub

# Copy Python package
COPY packages/python/ /trikhub/packages/python/

# Install trikhub with production dependencies
RUN pip install --no-cache-dir /trikhub/packages/python/

# Set working directory to workspace for trik execution
WORKDIR /workspace

# Disable Python output buffering for real-time JSON-RPC communication
ENV PYTHONUNBUFFERED=1

# Worker communicates via stdin/stdout (JSON-RPC 2.0)
ENTRYPOINT ["python", "-m", "trikhub.worker.main"]
