"""
Inference engine for sequential triage.

Given the trained Naive Bayes parameters, this computes:
  - a posterior over diseases from *partial* symptom evidence,
  - the expected information gain (bits) of each not-yet-asked symptom,
  - the next best question (max info gain),
  - stop/urgency decisions.

Pure NumPy; no web framework — so it is unit-testable in isolation.
"""
from __future__ import annotations

import os
import numpy as np
import joblib

EPS = 1e-6
MAX_QUESTIONS = 8
CONFIDENT_PROB = 0.70          # stop once the leading disease passes this
URGENT_PROB = 0.45             # stop early if an urgent/high condition passes this
URGENCY_ORDER = {"low": 0, "medium": 1, "high": 2, "urgent": 3}
# Minimum posterior for a condition of each urgency to raise the session's urgency.
# Lower bar for worse outcomes: a 6% chance of a heart attack warrants escalation,
# a 6% chance of a cold does not. Keep in sync with triageEngine.ts.
URGENCY_THRESHOLD = {"urgent": 0.05, "high": 0.12, "medium": 0.20, "low": 0.30}

# Below this leading-condition probability the model does not know enough to name a
# specialist, and says so instead of guessing. Measured separation: genuine answers
# land at 45-96%, while vague input ("not feeling well", "pain") bottoms out at
# 15-17% and still produced a confident-looking specialty recommendation.
# Guessing a specialist costs the patient a consultation fee and a week.
MIN_CONFIDENCE_TO_NAME_SPECIALIST = 0.30
FALLBACK_SPECIALIZATION = "General Medicine"
TOP_N = 6


def _entropy(p: np.ndarray) -> float:
    p = p[p > 0]
    return float(-np.sum(p * np.log2(p)))


class TriageModel:
    def __init__(self, model: dict):
        self.classes: list[str] = model["classes"]
        self.symptoms: list[str] = model["symptoms"]
        self.questions: dict[str, str] = model["questions"]
        self.disease_meta: dict[str, dict] = model["disease_meta"]
        self.metrics: dict = model.get("metrics", {})

        self.sym_idx = {s: i for i, s in enumerate(self.symptoms)}
        self.log_prior = np.asarray(model["class_log_prior"], dtype=float)
        # P(symptom = 1 | disease), clamped away from 0/1 for stable absence likelihoods
        p_present = np.exp(np.asarray(model["feature_log_prob"], dtype=float))
        self.p_present = np.clip(p_present, EPS, 1 - EPS)   # shape (n_classes, n_symptoms)

    @classmethod
    def load(cls, path: str) -> "TriageModel":
        if not os.path.exists(path):
            raise FileNotFoundError(
                f"model not found at {path} — run `python train.py` first."
            )
        return cls(joblib.load(path))

    # ---- core inference ----
    def _clean_evidence(self, evidence: dict) -> dict[str, int]:
        out: dict[str, int] = {}
        for k, v in (evidence or {}).items():
            if k in self.sym_idx and v is not None:
                out[k] = 1 if int(v) == 1 else 0
        return out

    def posterior(self, evidence: dict) -> np.ndarray:
        """P(disease | observed symptoms) as a normalized vector aligned to self.classes."""
        ev = self._clean_evidence(evidence)
        logp = self.log_prior.copy()
        for s, val in ev.items():
            j = self.sym_idx[s]
            col = self.p_present[:, j]
            logp += np.log(col if val == 1 else (1.0 - col))
        logp -= logp.max()
        post = np.exp(logp)
        return post / post.sum()

    def info_gain(self, post: np.ndarray, symptom: str) -> float:
        """Expected reduction in entropy (bits) from observing `symptom` next."""
        j = self.sym_idx[symptom]
        col = self.p_present[:, j]                       # P(s=1 | disease)
        p_yes = float(np.dot(post, col))
        p_no = 1.0 - p_yes
        h_before = _entropy(post)

        yes = post * col
        no = post * (1.0 - col)
        yes = yes / yes.sum() if yes.sum() > 0 else yes
        no = no / no.sum() if no.sum() > 0 else no
        h_after = p_yes * _entropy(yes) + p_no * _entropy(no)
        return max(0.0, h_before - h_after)

    def next_question(self, evidence: dict, skip: set | None = None):
        """Most informative symptom not already answered or skipped, as (symptom, info_gain)."""
        ev = self._clean_evidence(evidence)
        skip = set(skip or [])
        post = self.posterior(ev)
        best_sym, best_gain = None, -1.0
        for s in self.symptoms:
            if s in ev or s in skip:
                continue
            g = self.info_gain(post, s)
            if g > best_gain:
                best_sym, best_gain = s, g
        return best_sym, max(0.0, best_gain)

    # ---- presentation / decisions ----
    def top_conditions(self, post: np.ndarray, n: int = TOP_N) -> list[dict]:
        order = np.argsort(post)[::-1][:n]
        out = []
        for i in order:
            name = self.classes[i]
            meta = self.disease_meta.get(name, {})
            out.append({
                "disease": name,
                "prob": round(float(post[i]), 4),
                "specialization": meta.get("specialization", "General Medicine"),
                "urgency": meta.get("urgency", "medium"),
            })
        return out

    def overall_urgency(self, top: list[dict]) -> str:
        """
        Worst urgency among plausible conditions.

        The threshold SCALES WITH SEVERITY rather than being a flat 0.15. A flat cut
        weighs a 14% chance of a heart attack the same as a 14% chance of a cold and
        reports neither — it treats probability as the only thing that matters, when
        what matters is expected harm. The effect got worse with the move from 19 to
        49 conditions, because probability mass spreads over more classes and fewer
        conditions clear any fixed bar early in a session.
        """
        worst = "low"
        for c in top:
            urg = c["urgency"]
            if c["prob"] >= URGENCY_THRESHOLD.get(urg, 0.15) and \
                    URGENCY_ORDER[urg] > URGENCY_ORDER[worst]:
                worst = urg
        return worst

    def should_stop(self, asked: int, post: np.ndarray, top: list[dict]) -> bool:
        if asked >= MAX_QUESTIONS:
            return True
        if top and top[0]["prob"] >= CONFIDENT_PROB:
            return True
        # early stop if a high/urgent condition is already likely
        for c in top:
            if URGENCY_ORDER[c["urgency"]] >= URGENCY_ORDER["high"] and c["prob"] >= URGENT_PROB:
                return True
        return False

    def step(self, evidence: dict, skip: list | None = None) -> dict:
        """One triage step: posterior + next question + stop/urgency + recommendations."""
        ev = self._clean_evidence(evidence)
        skip_set = {s for s in (skip or []) if s in self.sym_idx and s not in ev}
        post = self.posterior(ev)
        top = self.top_conditions(post)
        asked = len(ev) + len(skip_set)
        done = self.should_stop(asked, post, top)
        sym, gain = (None, 0.0) if done else self.next_question(ev, skip_set)
        if sym is None:
            done = True

        specs: list[str] = []
        for c in top:
            if c["specialization"] not in specs:
                specs.append(c["specialization"])

        # Refuse to name a specialist we are not confident about. Only applies once
        # questioning has finished — mid-session the posterior is expected to be flat.
        low_confidence = bool(
            done and (not top or top[0]["prob"] < MIN_CONFIDENCE_TO_NAME_SPECIALIST)
        )
        if low_confidence:
            specs = [FALLBACK_SPECIALIZATION]

        return {
            "posterior": top,
            "nextQuestion": None if (done or sym is None) else {
                "symptom": sym,
                "question": self.questions.get(sym, sym),
                "infoGain": round(gain, 4),
            },
            "done": done,
            "urgency": self.overall_urgency(top),
            "recommendedSpecializations": specs[:3],
            "lowConfidence": low_confidence,
            "askedCount": asked,
        }
