"""
Evaluate the model the way the PRODUCT actually uses it.

train.py reports batch accuracy: every symptom known, one shot. That is not what
users experience. In the app the engine starts from a chief complaint, asks at most
MAX_QUESTIONS yes/no questions chosen by information gain, and stops early on
confidence or urgency. Accuracy under that budget is a different (and lower) number,
and it is the one that matters.

This simulates the real loop against held-out patients:
  * seed evidence from INITIAL_EVIDENCE (what the patient volunteers)
  * repeatedly ask the max-information-gain question
  * answer truthfully from the patient's full evidence list
  * stop on the engine's own stop rule

and reports, at the point of stopping:
  * top-1 / top-3 pathology accuracy
  * SPECIALIST accuracy  <- the product's actual output
  * questions asked, and why it stopped
  * whether urgent conditions were correctly escalated

Run:  python evaluate_triage.py [--n 3000] [--max-questions 8] [--confident 0.70]
"""
from __future__ import annotations

import argparse
import ast
import csv
import io
import os
import sys
import zipfile
from collections import Counter, defaultdict

import numpy as np
import joblib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from data import ddxplus  # noqa: E402
from data import ddxplus_taxonomy as tax  # noqa: E402

EPS = 1e-6
URGENCY_ORDER = {"low": 0, "medium": 1, "high": 2, "urgent": 3}


class Simulator:
    """Mirrors engine.py's inference, with the stop thresholds made tunable."""

    def __init__(self, model: dict, max_questions: int, confident: float, urgent: float):
        self.classes = model["classes"]
        self.symptoms = model["symptoms"]
        self.meta = model["disease_meta"]
        self.sym_idx = {s: i for i, s in enumerate(self.symptoms)}
        self.log_prior = np.asarray(model["class_log_prior"], dtype=float)
        p = np.exp(np.asarray(model["feature_log_prob"], dtype=float))
        self.p_present = np.clip(p, EPS, 1 - EPS)
        self.max_questions = max_questions
        self.confident = confident
        self.urgent = urgent

    def posterior(self, evidence: dict[str, int]) -> np.ndarray:
        logp = self.log_prior.copy()
        for s, v in evidence.items():
            j = self.sym_idx.get(s)
            if j is None:
                continue
            col = self.p_present[:, j]
            logp += np.log(col if v == 1 else (1.0 - col))
        logp -= logp.max()
        post = np.exp(logp)
        return post / post.sum()

    @staticmethod
    def _entropy(p: np.ndarray) -> float:
        p = p[p > 0]
        return float(-np.sum(p * np.log2(p)))

    def next_question(self, post: np.ndarray, asked: set[str]) -> tuple[str | None, float]:
        h_before = self._entropy(post)
        best, best_gain = None, -1.0
        for s, j in self.sym_idx.items():
            if s in asked:
                continue
            col = self.p_present[:, j]
            p_yes = float(np.dot(post, col))
            p_no = 1.0 - p_yes
            yes = post * col
            no = post * (1.0 - col)
            sy, sn = yes.sum(), no.sum()
            h_after = 0.0
            if sy > 0:
                h_after += p_yes * self._entropy(yes / sy)
            if sn > 0:
                h_after += p_no * self._entropy(no / sn)
            gain = h_before - h_after
            if gain > best_gain:
                best, best_gain = s, gain
        return best, max(0.0, best_gain)

    def should_stop(self, asked_n: int, top: list[tuple[str, float]]) -> str | None:
        """Returns the stop REASON, or None to keep asking."""
        if asked_n >= self.max_questions:
            return "budget"
        if top and top[0][1] >= self.confident:
            return "confident"
        for name, prob in top:
            urg = self.meta.get(name, {}).get("urgency", "medium")
            if URGENCY_ORDER.get(urg, 1) >= URGENCY_ORDER["high"] and prob >= self.urgent:
                return "urgency"
        return None

    def top(self, post: np.ndarray, n: int = 3) -> list[tuple[str, float]]:
        order = np.argsort(post)[::-1][:n]
        return [(self.classes[i], float(post[i])) for i in order]

    def run(self, truth_evidence: set[str], seed_n: int = 3) -> dict:
        """
        One simulated consultation. `truth_evidence` = features the patient really has.

        `seed_n` is how many findings the opening free-text description yields before
        any question is asked. Measured against the real extractor on typical
        complaints this is 2-7, so 1 badly overstates how many questions get asked.
        """
        evidence: dict[str, int] = {}
        asked: set[str] = set()

        for s in list(truth_evidence)[:seed_n]:
            evidence[s] = 1
            asked.add(s)

        reason = None
        while True:
            post = self.posterior(evidence)
            top = self.top(post, 6)
            reason = self.should_stop(len(asked), top)
            if reason:
                break
            q, gain = self.next_question(post, asked)
            if q is None or gain <= 0:
                reason = "exhausted"
                break
            evidence[q] = 1 if q in truth_evidence else 0
            asked.add(q)

        post = self.posterior(evidence)
        top = self.top(post, 3)
        return {
            "top": top,
            "asked": len(asked),
            "reason": reason,
            "confidence": top[0][1] if top else 0.0,
        }


def load_test_patients(fs, limit: int):
    """Yield (pathology, set_of_feature_names) for held-out patients."""
    path = os.path.join(ddxplus.DDX_DIR, "release_test_patients.zip")
    with zipfile.ZipFile(path) as z:
        with z.open(z.namelist()[0]) as fh:
            text = io.TextIOWrapper(fh, encoding="utf-8", errors="replace")
            for i, row in enumerate(csv.DictReader(text)):
                if i >= limit:
                    return
                try:
                    tokens = ast.literal_eval(row.get("EVIDENCES") or "[]")
                except (ValueError, SyntaxError):
                    continue
                vec = np.zeros(fs.n_features, dtype=np.uint8)
                fs.encode(tokens, vec)
                feats = {fs.features[j] for j in np.nonzero(vec)[0]}
                if feats:
                    yield (row.get("PATHOLOGY") or "").strip(), feats


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=3000, help="patients to simulate")
    ap.add_argument("--max-questions", type=int, default=8)
    ap.add_argument("--confident", type=float, default=0.70)
    ap.add_argument("--urgent", type=float, default=0.45)
    ap.add_argument("--per-condition", action="store_true",
                    help="break results down by individual condition, worst first")
    ap.add_argument("--seed-findings", type=int, default=3,
                    help="findings the opening free-text description supplies (real range 2-7)")
    ap.add_argument("--sweep", action="store_true",
                    help="sweep max-questions to find where accuracy plateaus")
    args = ap.parse_args()

    model = joblib.load(os.path.join(HERE, "model.pkl"))
    _, evidences = ddxplus.load_meta()

    # A union-trained model carries the legacy bridge features; rebuild the same space.
    is_union = any(s.startswith("L_") for s in model["symptoms"])
    extra = None
    if is_union:
        from data import legacy_bridge
        extra = legacy_bridge.EXTRA_FEATURES
    fs = ddxplus.FeatureSpace(evidences, extra=extra)

    if fs.features != model["symptoms"]:
        print("!! model.pkl feature order does not match the current FeatureSpace.")
        print("   Retrain with:  python train.py --source union")
        sys.exit(1)

    print(f"Loading up to {args.n} held-out patients...")
    patients = list(load_test_patients(fs, args.n))

    if is_union:
        # DDXPlus's test split has no legacy conditions in it, so evaluating on it
        # alone would silently skip the 11 conditions the union exists to cover.
        from data import legacy_bridge
        per = max(args.n // (len(legacy_bridge.LEGACY_CONDITIONS) * 4), 20)
        Xl, yl = legacy_bridge.generate(fs.features, per_condition=per, seed=999)
        for i in range(len(yl)):
            feats = {fs.features[j] for j in np.nonzero(Xl[i])[0]}
            if feats:
                patients.append((str(yl[i]), feats))

    print(f"  {len(patients)} patients, {len(set(p for p, _ in patients))} conditions\n")

    budgets = [3, 5, 8, 12, 16, 20] if args.sweep else [args.max_questions]

    for budget in budgets:
        sim = Simulator(model, budget, args.confident, args.urgent)
        top1 = top3 = spec_hit = 0
        urgent_total = urgent_caught = 0
        asked_total = 0
        reasons: Counter = Counter()
        per_spec: dict[str, list[int]] = defaultdict(list)
        # Per-CONDITION scoring: a specialty average can look healthy while an
        # individual condition inside it is never reached at all.
        per_cond: dict[str, dict] = defaultdict(lambda: {'n': 0, 'top1': 0, 'top3': 0, 'spec': 0})
        confusions: dict[str, Counter] = defaultdict(Counter)

        asked_counts: list[int] = []
        for truth, feats in patients:
            r = sim.run(feats, seed_n=args.seed_findings)
            asked_counts.append(max(0, r["asked"] - args.seed_findings))
            names = [n for n, _ in r["top"]]
            if names and names[0] == truth:
                top1 += 1
            if truth in names:
                top3 += 1

            true_spec = model["disease_meta"].get(truth, {}).get("specialization")
            pred_spec = model["disease_meta"].get(names[0], {}).get("specialization") if names else None
            hit = int(true_spec is not None and true_spec == pred_spec)
            spec_hit += hit
            if true_spec:
                per_spec[true_spec].append(hit)

            if not hit and names:
                # What is it actually being mistaken FOR? Fixing a weak condition
                # means knowing which neighbour is stealing it, not guessing.
                confusions[truth][f"{names[0]}  [{pred_spec}]"] += 1

            c = per_cond[truth]
            c['n'] += 1
            c['top1'] += int(bool(names) and names[0] == truth)
            c['top3'] += int(truth in names)
            c['spec'] += hit

            true_urg = model["disease_meta"].get(truth, {}).get("urgency", "medium")
            if URGENCY_ORDER.get(true_urg, 1) >= URGENCY_ORDER["urgent"]:
                urgent_total += 1
                pred_urgs = [
                    model["disease_meta"].get(n, {}).get("urgency", "medium") for n in names
                ]
                if any(URGENCY_ORDER.get(u, 1) >= URGENCY_ORDER["high"] for u in pred_urgs):
                    urgent_caught += 1

            asked_total += r["asked"]
            reasons[r["reason"]] += 1

        n = len(patients)
        print(f"--- max_questions = {budget} ---")
        print(f"  top-1 pathology : {top1/n:.3f}")
        print(f"  top-3 pathology : {top3/n:.3f}")
        print(f"  SPECIALIST      : {spec_hit/n:.3f}   <- what the product outputs")
        if urgent_total:
            print(f"  urgent escalated: {urgent_caught/urgent_total:.3f}  ({urgent_caught}/{urgent_total})")
        # How many questions the PATIENT is actually asked, i.e. excluding the
        # findings their free-text description already supplied. The average hides
        # the tail, and the tail is what makes people abandon a form.
        arr = np.array(asked_counts)
        print(f"  questions asked : median {int(np.median(arr))}, "
              f"mean {arr.mean():.1f}, p90 {int(np.percentile(arr, 90))}, max {int(arr.max())}")
        print(f"  distribution    : ", end="")
        hist = Counter(arr.tolist())
        for k in sorted(hist):
            print(f"{k}q:{100*hist[k]/n:.0f}%  ", end="")
        print()
        print(f"  stop reason     : {dict(reasons.most_common())}")

        if args.per_condition:
            # A specialty average can look healthy while a single condition inside
            # it is never reached at all — so score every condition on its own.
            print("\n  per-condition, worst first — top1 / top3 / specialist:")
            rows = []
            for name, c in per_cond.items():
                meta = model["disease_meta"].get(name, {})
                rows.append((
                    c["spec"] / c["n"], c["top1"] / c["n"], c["top3"] / c["n"], c["n"],
                    name, meta.get("specialization", "?"), meta.get("urgency", "?"),
                    meta.get("source") == "knowledge.py",
                ))
            for sp, t1, t3, cnt, name, spec, urg, legacy in sorted(rows):
                flag = "  <-- BAD" if sp < 0.60 else ("  <-- weak" if sp < 0.80 else "")
                tag = " [legacy]" if legacy else ""
                print(f"    {t1:.2f} {t3:.2f} {sp:.2f}  ({cnt:5d})  {name[:34]:34s} "
                      f"{spec[:22]:22s} {urg:7s}{tag}{flag}")

        if args.per_condition:
            print("\n  where the weak conditions actually go:")
            weak = sorted(
                (c["spec"] / c["n"], name) for name, c in per_cond.items()
                if c["spec"] / c["n"] < 0.85
            )
            for sp, name in weak:
                print(f"\n    {name}  (specialist {sp:.2f})")
                for wrong, cnt in confusions[name].most_common(4):
                    print(f"        {cnt:4d}x -> {wrong}")

        if not args.sweep:
            print("\n  per-specialty recall:")
            for spec, hits in sorted(per_spec.items(), key=lambda kv: -len(kv[1])):
                print(f"    {sum(hits)/len(hits):.3f}  ({len(hits):5d})  {spec}")
        print()


if __name__ == "__main__":
    main()
