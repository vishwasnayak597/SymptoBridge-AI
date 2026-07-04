"""
FastAPI service that serves the trained triage model.

Endpoints:
  GET  /health         - liveness + whether a model is loaded
  GET  /meta           - symptom list (+ questions), diseases, training metrics (UI "model card")
  POST /predict        - posterior over diseases for the given partial evidence
  POST /next-question  - full triage step: posterior + most-informative next question + stop/urgency

Run:  uvicorn app:app --reload --port 8001
"""
from __future__ import annotations

import os
from typing import Optional

import time

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from prometheus_client import Histogram, generate_latest, CONTENT_TYPE_LATEST

from engine import TriageModel

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "model.pkl")

app = FastAPI(title="SymptoBridge AI Triage Model", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

_model: Optional[TriageModel] = None

# Prometheus: request-duration histogram labeled by path/method/status.
REQUEST_DURATION = Histogram(
    "ml_request_duration_seconds",
    "ML service request duration in seconds",
    ["method", "path", "status"],
    buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
)


@app.middleware("http")
async def metrics_middleware(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    if request.url.path != "/metrics":
        REQUEST_DURATION.labels(
            method=request.method, path=request.url.path, status=str(response.status_code)
        ).observe(time.perf_counter() - start)
    return response


@app.get("/metrics")
def metrics():
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


def get_model() -> Optional[TriageModel]:
    global _model
    if _model is None:
        try:
            _model = TriageModel.load(MODEL_PATH)
        except FileNotFoundError:
            return None
    return _model


class Evidence(BaseModel):
    evidence: dict[str, int] = {}
    skip: list[str] = []   # symptoms asked but answered "not sure" (excluded from re-asking)


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": get_model() is not None}


@app.get("/meta")
def meta():
    model = get_model()
    if model is None:
        return {"error": "model_not_trained"}
    return {
        "symptoms": [{"id": s, "question": model.questions.get(s, s)} for s in model.symptoms],
        "diseases": [
            {"name": c, **model.disease_meta.get(c, {})} for c in model.classes
        ],
        "metrics": model.metrics,
    }


@app.post("/predict")
def predict(body: Evidence):
    model = get_model()
    if model is None:
        return {"error": "model_not_trained"}
    post = model.posterior(body.evidence)
    return {"posterior": model.top_conditions(post)}


@app.post("/next-question")
def next_question(body: Evidence):
    model = get_model()
    if model is None:
        return {"error": "model_not_trained"}
    return model.step(body.evidence, body.skip)
