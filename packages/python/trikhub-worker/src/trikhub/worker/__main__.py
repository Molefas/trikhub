"""Entry point for `python -m trikhub.worker.main`."""

import asyncio
from trikhub.worker.main import run_worker

asyncio.run(run_worker())
