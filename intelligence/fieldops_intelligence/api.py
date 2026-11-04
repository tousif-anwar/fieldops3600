"""Private-network advisory API. The authenticated gateway is its trust boundary."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from starlette.concurrency import run_in_threadpool

from .prediction import MODEL_VERSION, PredictionRequest, get_model
from .scheduling import OptimizationRequest, dispatch


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fit reproducible synthetic model once. Fail readiness if it cannot be fitted.
    await run_in_threadpool(get_model)
    yield


app = FastAPI(title="FieldOps Advisory Intelligence", version="1.0.0", lifespan=lifespan, docs_url=None, redoc_url=None)


@app.get("/health")
def health():
    return {"status": "ready", "modelVersion": MODEL_VERSION, "syntheticTraining": True}


@app.post("/predict")
def predict(request: PredictionRequest):
    return get_model().predict(request)


@app.post("/optimize")
def optimize(request: OptimizationRequest):
    return dispatch(request)
