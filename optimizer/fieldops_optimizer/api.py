"""Private-network dispatch optimization API. The authenticated gateway is its trust boundary."""

from fastapi import FastAPI

from .scheduling import OptimizationRequest, dispatch

app = FastAPI(title="FieldOps Dispatch Optimizer", version="1.0.0", docs_url=None, redoc_url=None)


@app.get("/health")
def health():
    return {"status": "ready", "service": "dispatch-optimizer"}


@app.post("/optimize")
def optimize(request: OptimizationRequest):
    return dispatch(request)
