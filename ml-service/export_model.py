"""
Export the trained triage model (model.pkl) to a TypeScript module the Node
backend can run in-process — no separate ML service needed at request time.

Training still happens here in Python (`train.py`); this just serializes the
learned parameters so the Node engine (backend/src/services/triageEngine.ts)
can compute the posterior / information gain itself.

Regenerate after retraining:  cd ml-service && python export_model.py
"""
from __future__ import annotations

import json
import os

import joblib
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(HERE, "model.pkl")
DEST = os.path.join(HERE, "..", "backend", "src", "services", "triageModel.ts")


def to_native(x):
    if isinstance(x, np.ndarray):
        return x.tolist()
    return x


def main() -> None:
    m = joblib.load(MODEL_PATH)
    out = {
        "classes": list(m["classes"]),
        "symptoms": list(m["symptoms"]),
        "questions": m["questions"],
        "disease_meta": m["disease_meta"],
        "metrics": m.get("metrics", {}),
        "class_log_prior": to_native(m["class_log_prior"]),
        "feature_log_prob": to_native(m["feature_log_prob"]),
    }

    header = (
        "// AUTO-GENERATED from ml-service/model.pkl by export_model.py — do not edit by hand.\n"
        "// Regenerate after retraining:  cd ml-service && python export_model.py\n"
        "/* eslint-disable */\n"
        "import type { TriageModelData } from './triageEngine';\n\n"
    )
    body = "export const TRIAGE_MODEL: TriageModelData = " + json.dumps(out) + ";\n"

    with open(DEST, "w", encoding="utf-8") as f:
        f.write(header + body)

    print(
        f"Wrote {DEST}\n"
        f"  classes:  {len(out['classes'])}\n"
        f"  symptoms: {len(out['symptoms'])}\n"
        f"  feature_log_prob: {len(out['feature_log_prob'])} x "
        f"{len(out['feature_log_prob'][0]) if out['feature_log_prob'] else 0}"
    )


if __name__ == "__main__":
    main()
