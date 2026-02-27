"""TrikHub Python Worker — v2 protocol worker for executing Python triks."""


def __getattr__(name):
    if name in ("PythonWorker", "run_worker"):
        from trikhub.worker.main import PythonWorker, run_worker
        globals()["PythonWorker"] = PythonWorker
        globals()["run_worker"] = run_worker
        return globals()[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = ["PythonWorker", "run_worker"]
