"""
Train the triage model.

Pipeline: load data (Kaggle CSVs if present, else synthetic) -> inject controlled noise
-> train Bernoulli Naive Bayes (primary, served) + Random Forest / MLP (comparators)
-> evaluate (accuracy, top-3, macro-F1, Brier/calibration) -> persist model.pkl + model_meta.json.

The SERVED model is the Naive Bayes parameters (class log-priors + per-symptom
log P(symptom=1|disease)), because they let the API compute a posterior over *partial*
evidence and the information gain of each unobserved symptom — which a black-box classifier
cannot do.

Run:  python train.py [--noise 0.05] [--per-disease 400]
"""
from __future__ import annotations

import os
import re
import json
import argparse
import numpy as np
import pandas as pd
import joblib

from sklearn.model_selection import train_test_split
from sklearn.naive_bayes import BernoulliNB
from sklearn.ensemble import RandomForestClassifier
from sklearn.neural_network import MLPClassifier
from sklearn.metrics import accuracy_score, f1_score, brier_score_loss

import knowledge
from data.generate_synthetic import generate as generate_synthetic

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "data")
MODEL_PATH = os.path.join(HERE, "model.pkl")
META_PATH = os.path.join(HERE, "model_meta.json")


def humanize(symptom: str) -> str:
    return "Do you have " + symptom.replace("_", " ").strip().lower() + "?"


def load_data(per_disease: int) -> tuple[pd.DataFrame, str, dict[str, str]]:
    """Returns (dataframe with `prognosis` label, source name, symptom->question map)."""
    train_csv = os.path.join(DATA_DIR, "Training.csv")
    if os.path.exists(train_csv):
        df = pd.read_csv(train_csv)
        test_csv = os.path.join(DATA_DIR, "Testing.csv")
        if os.path.exists(test_csv):
            df = pd.concat([df, pd.read_csv(test_csv)], ignore_index=True)
        # drop stray unnamed / all-NaN columns Kaggle ships
        df = df.loc[:, ~df.columns.str.contains("^Unnamed")]
        df = df.dropna(axis=1, how="all")
        df = df.rename(columns={"prognosis": "prognosis"})
        symptom_cols = [c for c in df.columns if c != "prognosis"]
        questions = {s: knowledge.SYMPTOMS.get(s, humanize(s)) for s in symptom_cols}
        return df[symptom_cols + ["prognosis"]], "kaggle", questions

    print("Kaggle CSVs not found -> generating synthetic dataset from clinical priors.")
    df = generate_synthetic(per_disease=per_disease)
    questions = dict(knowledge.SYMPTOMS)
    return df, "synthetic", questions


def inject_noise(X: np.ndarray, rate: float, seed: int = 7) -> np.ndarray:
    """Randomly flip symptom bits at `rate` to simulate noisy real-world reporting."""
    if rate <= 0:
        return X
    rng = np.random.default_rng(seed)
    flips = rng.random(X.shape) < rate
    return np.where(flips, 1 - X, X)


def top_k_accuracy(proba: np.ndarray, y_idx: np.ndarray, k: int = 3) -> float:
    topk = np.argsort(proba, axis=1)[:, -k:]
    return float(np.mean([y_idx[i] in topk[i] for i in range(len(y_idx))]))


def disease_meta(name: str) -> dict:
    for k, v in knowledge.DISEASES.items():
        if k.lower() == name.lower():
            return {"specialization": v["specialization"], "urgency": v["urgency"]}
    return {"specialization": knowledge.DEFAULT_SPECIALIZATION, "urgency": knowledge.DEFAULT_URGENCY}


def load_ddxplus(max_per_class: int | None, verbose: bool = True):
    """
    Load the DDXPlus release using its OFFICIAL train/test split.

    Returns (X_tr, y_tr, X_te, y_te, symptoms, questions, disease_meta, extra_meta).

    Note we do NOT call inject_noise() on this source: DDXPlus evidence patterns
    already reflect realistic reporting, and bit-flipping would break the
    mutual exclusivity of one-hot groups (e.g. flipping a patient into both
    "pain is mild" and "pain is severe").
    """
    from data import ddxplus

    print("Loading DDXPlus (train split)...")
    X_tr, y_tr, fs, conditions = ddxplus.load_dataset(
        "train", max_per_class=max_per_class, verbose=verbose
    )
    print("Loading DDXPlus (test split)...")
    X_te, y_te, _, _ = ddxplus.load_dataset(
        "test", max_per_class=None, verbose=verbose
    )

    classes = sorted(set(y_tr.tolist()))
    disease_meta = ddxplus.build_disease_meta(conditions, classes)

    extra = {
        "dataset": "ddxplus",
        "dataset_citation": ddxplus.CITATION,
        "dataset_license": "CC BY 4.0",
        "split": "official train/test",
        "max_per_class": max_per_class,
        "n_train": int(len(y_tr)),
        "n_test": int(len(y_te)),
    }
    return X_tr, y_tr, X_te, y_te, fs.features, fs.questions, disease_meta, extra


def load_union(max_per_class: int | None, seed: int, verbose: bool = True):
    """
    DDXPlus + the knowledge.py conditions DDXPlus has no label for.

    Both sources are sampled into ONE shared feature space (see data/legacy_bridge.py),
    so a zero means "symptom absent" for every patient rather than "this feature
    belongs to the other dataset".
    """
    from data import ddxplus, legacy_bridge

    missing = legacy_bridge.unmapped_symptoms()
    if missing:
        raise RuntimeError(
            f"legacy symptoms with no DDXPlus mapping: {missing} — "
            "add them to SYMPTOM_TO_FEATURES or EXTRA_SYMPTOM_MAP in legacy_bridge.py"
        )

    extra = legacy_bridge.EXTRA_FEATURES
    per_class = max_per_class or 6000

    print("Loading DDXPlus (train split)...")
    X_ddx_tr, y_ddx_tr, fs, conditions = ddxplus.load_dataset(
        "train", max_per_class=max_per_class, verbose=verbose, extra_features=extra
    )
    print("Loading DDXPlus (test split)...")
    X_ddx_te, y_ddx_te, _, _ = ddxplus.load_dataset(
        "test", max_per_class=None, verbose=verbose, extra_features=extra
    )

    print(f"Sampling {len(legacy_bridge.LEGACY_CONDITIONS)} legacy conditions "
          f"into the shared space...")
    X_leg_tr, y_leg_tr = legacy_bridge.generate(fs.features, per_class, seed=seed)
    # held-out legacy patients from a different seed
    X_leg_te, y_leg_te = legacy_bridge.generate(
        fs.features, max(per_class // 4, 250), seed=seed + 1000
    )
    print(f"  legacy: {len(y_leg_tr)} train / {len(y_leg_te)} test across "
          f"{len(set(y_leg_tr.tolist()))} conditions")

    X_tr = np.vstack([X_ddx_tr, X_leg_tr])
    y_tr = np.concatenate([y_ddx_tr, y_leg_tr])
    X_te = np.vstack([X_ddx_te, X_leg_te])
    y_te = np.concatenate([y_ddx_te, y_leg_te])

    classes = sorted(set(y_tr.tolist()))
    disease_meta = ddxplus.build_disease_meta(
        conditions, [c for c in classes if c in conditions]
    )
    disease_meta.update(
        legacy_bridge.build_disease_meta(
            [c for c in classes if c not in conditions]
        )
    )

    extra_meta = {
        "dataset": "ddxplus+knowledge",
        "dataset_citation": ddxplus.CITATION,
        "dataset_license": "CC BY 4.0 (DDXPlus portion)",
        "split": "DDXPlus official train/test + sampled legacy holdout",
        "max_per_class": max_per_class,
        "n_train": int(len(y_tr)),
        "n_test": int(len(y_te)),
        "n_ddxplus_conditions": len(conditions),
        "n_legacy_conditions": len(legacy_bridge.LEGACY_CONDITIONS),
        "legacy_conditions": legacy_bridge.LEGACY_CONDITIONS,
        "legacy_dropped_as_duplicate": legacy_bridge.COVERED_BY_DDXPLUS,
    }
    return X_tr, y_tr, X_te, y_te, fs.features, fs.questions, disease_meta, extra_meta


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=["auto", "ddxplus", "union"], default="auto",
                        help="'auto' = Kaggle CSVs if present else synthetic; 'ddxplus' = DDXPlus release")
    parser.add_argument("--noise", type=float, default=0.05, help="symptom-flip noise rate")
    parser.add_argument("--per-disease", type=int, default=400, help="synthetic cases per disease")
    parser.add_argument("--max-per-class", type=int, default=6000,
                        help="DDXPlus: cap rows per pathology (0 = no cap)")
    parser.add_argument("--comparators", action="store_true",
                        help="also fit RandomForest/MLP benchmarks (slow on DDXPlus)")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    ddx_meta: dict | None = None

    if args.source in ("ddxplus", "union"):
        cap = None if args.max_per_class in (0, None) else args.max_per_class
        loader = load_ddxplus if args.source == "ddxplus" else \
            (lambda c: load_union(c, args.seed))
        X_tr, y_tr, X_te, y_te, symptoms, questions, ddx_disease_meta, ddx_meta = loader(cap)
        source = args.source
        n_samples = len(y_tr) + len(y_te)
    else:
        df, source, questions = load_data(args.per_disease)
        symptoms = [c for c in df.columns if c != "prognosis"]
        X = df[symptoms].astype(int).to_numpy()
        y = df["prognosis"].astype(str).to_numpy()
        X = inject_noise(X, args.noise, seed=args.seed)
        X_tr, X_te, y_tr, y_te = train_test_split(
            X, y, test_size=0.2, random_state=args.seed, stratify=y
        )
        ddx_disease_meta = None
        n_samples = len(df)

    # ---- primary model: Bernoulli Naive Bayes (served) ----
    nb = BernoulliNB(alpha=1.0)
    nb.fit(X_tr, y_tr)
    classes = list(nb.classes_)
    class_to_idx = {c: i for i, c in enumerate(classes)}
    y_te_idx = np.array([class_to_idx[c] for c in y_te])

    nb_proba = nb.predict_proba(X_te)
    nb_pred = nb.predict(X_te)
    metrics = {
        "source": source,
        "noise_rate": args.noise if source != "ddxplus" else 0.0,
        "n_samples": int(n_samples),
        "n_symptoms": len(symptoms),
        "n_diseases": len(classes),
        "naive_bayes": {
            "accuracy": round(float(accuracy_score(y_te, nb_pred)), 4),
            "top3_accuracy": round(top_k_accuracy(nb_proba, y_te_idx, 3), 4),
            "macro_f1": round(float(f1_score(y_te, nb_pred, average="macro")), 4),
            # one-vs-rest mean Brier score = calibration quality (lower is better)
            "brier_score": round(float(np.mean([
                brier_score_loss((y_te == c).astype(int), nb_proba[:, i])
                for i, c in enumerate(classes)
            ])), 4),
        },
    }

    if ddx_meta:
        metrics["dataset"] = ddx_meta

    # ---- comparators (benchmark only, not served) ----
    if args.comparators:
        rf = RandomForestClassifier(n_estimators=200, random_state=args.seed, n_jobs=-1)
        rf.fit(X_tr, y_tr)
        metrics["random_forest"] = {
            "accuracy": round(float(accuracy_score(y_te, rf.predict(X_te))), 4),
            "top3_accuracy": round(top_k_accuracy(rf.predict_proba(X_te), y_te_idx, 3), 4),
        }

        mlp = MLPClassifier(hidden_layer_sizes=(64,), max_iter=300, random_state=args.seed)
        mlp.fit(X_tr, y_tr)
        metrics["mlp"] = {
            "accuracy": round(float(accuracy_score(y_te, mlp.predict(X_te))), 4),
            "top3_accuracy": round(top_k_accuracy(mlp.predict_proba(X_te), y_te_idx, 3), 4),
        }

    # ---- persist served model (NB parameters for partial-evidence inference) ----
    model = {
        "classes": classes,                                  # disease names
        "symptoms": symptoms,                                # feature order
        "class_log_prior": nb.class_log_prior_.tolist(),     # log P(disease)
        "feature_log_prob": nb.feature_log_prob_.tolist(),   # log P(symptom=1 | disease)
        "questions": questions,                              # symptom -> question text
        "disease_meta": ddx_disease_meta or {c: disease_meta(c) for c in classes},
        "metrics": metrics,
    }
    joblib.dump(model, MODEL_PATH)
    with open(META_PATH, "w") as f:
        json.dump({k: model[k] for k in ("classes", "symptoms", "questions", "disease_meta", "metrics")},
                  f, indent=2)

    print("\n=== Training complete ===")
    print(f"source={source}  samples={metrics['n_samples']}  "
          f"diseases={metrics['n_diseases']}  symptoms={metrics['n_symptoms']}  "
          f"noise={metrics['noise_rate']}")
    print(f"Naive Bayes : acc={metrics['naive_bayes']['accuracy']}  "
          f"top3={metrics['naive_bayes']['top3_accuracy']}  "
          f"macroF1={metrics['naive_bayes']['macro_f1']}  brier={metrics['naive_bayes']['brier_score']}")
    if "random_forest" in metrics:
        print(f"RandomForest: acc={metrics['random_forest']['accuracy']}  top3={metrics['random_forest']['top3_accuracy']}")
    if "mlp" in metrics:
        print(f"MLP         : acc={metrics['mlp']['accuracy']}  top3={metrics['mlp']['top3_accuracy']}")
    if ddx_meta:
        print(f"\nDataset     : {ddx_meta['dataset_citation']}")
        print(f"              train={ddx_meta['n_train']}  test={ddx_meta['n_test']}  ({ddx_meta['split']})")
    print(f"Saved -> {MODEL_PATH}\n        {META_PATH}")


if __name__ == "__main__":
    main()
