# SymptoBridge AI - Triage ML Service

A self-contained Python/FastAPI microservice that **trains and serves its own** probabilistic
diagnosis model and drives **sequential, information-gain-based triage** — the symptom checker's
"intelligence" lives here, not in any third-party LLM API.

## What it does
- Trains a calibrated **Bernoulli Naive Bayes** model (benchmarked vs Random Forest / MLP) on a
  symptom→disease dataset (Kaggle if present, else a synthetic fallback).
- Serves the learned parameters so it can compute a posterior over **partial** symptom evidence and
  the **expected information gain** (bits) of each unasked symptom — i.e. the most useful next question.

## Why Naive Bayes is the served model
Active feature acquisition needs `P(symptom | disease)` to score *unobserved* questions and to update
beliefs from partial evidence. NB exposes exactly that; a black-box classifier (RF/MLP) only scores
fully-specified inputs. RF/MLP are trained as benchmarks to show breadth.

## Run locally
```bash
python -m venv venv
venv/Scripts/python -m pip install -r requirements.txt   # (Windows; use venv/bin on macOS/Linux)
python train.py                # trains -> model.pkl + model_meta.json
pytest tests/                  # engine unit tests
uvicorn app:app --port 8001    # serve
```

## Endpoints
| Method | Path | Purpose |
|---|---|---|
| GET  | `/health` | liveness + model-loaded flag |
| GET  | `/meta` | symptom list (+ questions), diseases, training metrics (UI "model card") |
| POST | `/predict` | `{evidence:{symptom:0\|1}}` → disease posterior |
| POST | `/next-question` | full step: posterior + most-informative next question + stop/urgency + recommended specializations |

## Data
See `data/README.md`. Kaggle "Disease Prediction from Symptoms" is preferred; a synthetic generator
(`data/generate_synthetic.py`) is the always-available fallback. `train.py` injects controlled noise
so reported accuracy is realistic.

## Deploy
`Dockerfile` trains at build time and serves on `:8001`. Deploy as a Render Python/Docker web service;
point the Node backend at it via `ML_SERVICE_URL`.
