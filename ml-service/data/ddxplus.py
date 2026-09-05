"""
DDXPlus ingestion.

Downloads the DDXPlus release (Mila, CC BY 4.0) and encodes it into the flat
binary symptom matrix this project's Bernoulli Naive Bayes engine already expects,
so `engine.py` (posterior over partial evidence + information-gain question
selection) keeps working unchanged.

Why not just one-hot everything: DDXPlus has 223 evidences, but four of them are
body-location pickers with 165 values each. Naive one-hot gives 972 mostly-empty
features. Instead:

  * 208 binary evidences        -> 1 feature each, unchanged
  * 0-10 intensity/speed scales -> 3 ordinal bands (mild / moderate / severe)
  * small categoricals          -> one-hot per value
  * 165-value location pickers  -> binned to ~10 coarse anatomical regions

...which lands around 300 features that each carry real signal.

Dataset: Fansi Tchango et al., "DDXPlus: A New Dataset For Automatic Medical
Diagnosis", NeurIPS 2022 Datasets & Benchmarks. https://arxiv.org/abs/2205.09148
Licensed CC BY 4.0 — attribution is required wherever this model is served.

Usage:
    python -m data.ddxplus --download          # fetch ~180MB into data/ddxplus/
    python -m data.ddxplus --inspect           # print the derived feature space
"""
from __future__ import annotations

import ast
import csv
import io
import json
import os
import sys
import zipfile
from collections import Counter, defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from data import ddxplus_taxonomy as tax  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DDX_DIR = os.path.join(HERE, "ddxplus")

CITATION = (
    "DDXPlus (Fansi Tchango et al., NeurIPS 2022 Datasets & Benchmarks), CC BY 4.0 "
    "— https://arxiv.org/abs/2205.09148"
)

# figshare "DDXPlus Dataset (English)" — article 22687585
FILES = {
    "release_conditions.json":       "https://ndownloader.figshare.com/files/62561569",
    "release_evidences.json":        "https://ndownloader.figshare.com/files/40278013",
    "release_train_patients.zip":    "https://ndownloader.figshare.com/files/40278019",
    "release_validate_patients.zip": "https://ndownloader.figshare.com/files/40278022",
    "release_test_patients.zip":     "https://ndownloader.figshare.com/files/40278016",
}

# Evidences whose values are anatomical locations (165 each) — binned to regions.
LOCATION_EVIDENCES = {"E_55", "E_57", "E_133", "E_152"}

# Readable question templates for the binned location features.
LOCATION_TEMPLATES = {
    "E_55":  "Do you feel pain in your {region}?",
    "E_57":  "Does the pain spread to your {region}?",
    "E_133": "Is the affected area on your {region}?",
    "E_152": "Is the swelling on your {region}?",
}

# A 0-10 scale is treated as ordinal (binned) rather than one-hot.
ORDINAL_MIN_LEVELS = 6

SEP = "_@_"          # DDXPlus evidence/value separator
FEAT_SEP = "__"      # our derived-feature separator


# ---------------------------------------------------------------------------
# download
# ---------------------------------------------------------------------------
def download(force: bool = False) -> None:
    """Fetch the DDXPlus release into data/ddxplus/ (skips files already present)."""
    import urllib.request

    os.makedirs(DDX_DIR, exist_ok=True)
    for name, url in FILES.items():
        dest = os.path.join(DDX_DIR, name)
        if os.path.exists(dest) and not force:
            print(f"  have {name} ({os.path.getsize(dest)/1e6:.1f} MB)")
            continue
        print(f"  downloading {name} ...", flush=True)
        urllib.request.urlretrieve(url, dest)
        print(f"  saved {name} ({os.path.getsize(dest)/1e6:.1f} MB)")


def _require(name: str) -> str:
    path = os.path.join(DDX_DIR, name)
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"{name} not found in {DDX_DIR}. Run:  python -m data.ddxplus --download"
        )
    return path


# ---------------------------------------------------------------------------
# feature space
# ---------------------------------------------------------------------------
class FeatureSpace:
    """Maps DDXPlus evidence tokens onto our flat binary feature vector."""

    def __init__(self, evidences: dict, extra: dict[str, str] | None = None):
        """
        `extra` adds features DDXPlus has no evidence for (see data/legacy_bridge.py).
        They are appended AFTER the DDXPlus features so that a model trained without
        them stays a prefix of one trained with them.
        """
        self.evidences = evidences
        self.features: list[str] = []
        self.questions: dict[str, str] = {}
        # feature name -> index
        self.index: dict[str, int] = {}
        # evidence code -> how to encode it
        self.kind: dict[str, str] = {}
        # evidence code -> {raw value -> feature name}
        self.value_map: dict[str, dict[str, str]] = {}
        # feature -> the evidence code it came from (groups related questions)
        self.group: dict[str, str] = {}
        self._build()
        for name, question in (extra or {}).items():
            self.kind[name] = "extra"
            self._add(name, question, name)

    def _add(self, feature: str, question: str, code: str) -> None:
        if feature in self.index:
            return
        self.index[feature] = len(self.features)
        self.features.append(feature)
        self.questions[feature] = question
        self.group[feature] = code

    def _build(self) -> None:
        for code, ev in self.evidences.items():
            dtype = ev.get("data_type", "B")
            question = (ev.get("question_en") or code).strip()
            values = ev.get("possible-values") or []
            meaning = ev.get("value_meaning") or {}

            if dtype == "B" or not values:
                self.kind[code] = "binary"
                self._add(code, question, code)
                continue

            stem = question.rstrip("? ").strip()

            if code in LOCATION_EVIDENCES:
                self.kind[code] = "region"
                template = LOCATION_TEMPLATES.get(code, stem + ", in the {region}?")
                vmap: dict[str, str] = {}
                for raw in values:
                    key = str(raw)
                    label = (meaning.get(key, {}) or {}).get("en", key)
                    # 'nowhere' means no pain — never a positive feature
                    if tax.is_null_value(label):
                        vmap[key] = None
                        continue
                    region = tax.region_of(label)
                    feature = f"{code}{FEAT_SEP}{region}"
                    vmap[key] = feature
                    self._add(
                        feature,
                        template.format(region=tax.REGION_LABELS.get(region, region)),
                        code,
                    )
                self.value_map[code] = vmap
                continue

            numeric = all(isinstance(v, (int, float)) for v in values)
            if numeric and len(values) >= ORDINAL_MIN_LEVELS:
                self.kind[code] = "ordinal"
                template, band_labels = tax.ordinal_spec(code)
                vmap = {}
                for raw in values:
                    i = tax.ordinal_band_index(float(raw))
                    band = band_labels[i]
                    feature = f"{code}{FEAT_SEP}{i}"
                    vmap[str(raw)] = feature
                    self._add(feature, template.format(band=band), code)
                self.value_map[code] = vmap
                continue

            # Some "categoricals" are really yes/no pairs (N/Y). One-hot would make
            # two features and produce nonsense questions ("Is the lesion larger
            # than 1cm - N?"). Collapse them to a single binary feature carrying the
            # original question.
            labels = {
                str(raw): (meaning.get(str(raw), {}) or {}).get("en", str(raw))
                for raw in values
            }
            positives = {k: v for k, v in labels.items() if not tax.is_null_value(v)}
            if len(positives) == 1 and all(
                v.strip().lower() in tax.TRUE_VALUE_LABELS for v in positives.values()
            ):
                self.kind[code] = "boolean"
                self._add(code, question, code)
                self.value_map[code] = {
                    k: (code if k in positives else None) for k in labels
                }
                continue

            # small categorical / multi-choice -> one-hot
            self.kind[code] = "onehot"
            vmap = {}
            for key, label in labels.items():
                if tax.is_null_value(label):
                    vmap[key] = None
                    continue
                feature = f"{code}{FEAT_SEP}{key}"
                vmap[key] = feature
                self._add(feature, self._phrase(stem, label), code)
            self.value_map[code] = vmap

    @staticmethod
    def _phrase(stem: str, label: str) -> str:
        """Turn a categorical stem + value into a readable yes/no question."""
        s = stem.rstrip(":").strip()
        low = s.lower()
        if low.startswith("characterize your pain"):
            return f"Would you describe the pain as {label}?"
        if low.startswith("what color") or low.startswith("what colour"):
            return f"Is the rash {label}?"
        if low.startswith("have you traveled") or low.startswith("have you travelled"):
            return f"Have you travelled to {label} in the last 4 weeks?"
        return f"{s} — {label}?"

    def encode(self, tokens: list[str], out: np.ndarray) -> None:
        """Set bits in `out` (len == n_features) for one patient's EVIDENCES list."""
        for token in tokens:
            if SEP in token:
                code, _, raw = token.partition(SEP)
                vmap = self.value_map.get(code, {})
                if raw in vmap:
                    # None here is deliberate: an "absent" value ('nowhere', 'NA')
                    # that must not set any bit.
                    feature = vmap[raw]
                else:
                    # genuinely unseen value -> mark the parent evidence if binary
                    feature = code if code in self.index else None
            else:
                feature = token if token in self.index else None
            if feature is not None:
                idx = self.index.get(feature)
                if idx is not None:
                    out[idx] = 1

    @property
    def n_features(self) -> int:
        return len(self.features)


# ---------------------------------------------------------------------------
# loading
# ---------------------------------------------------------------------------
def load_meta() -> tuple[dict, dict]:
    with open(_require("release_conditions.json"), encoding="utf-8") as f:
        conditions = json.load(f)
    with open(_require("release_evidences.json"), encoding="utf-8") as f:
        evidences = json.load(f)
    return conditions, evidences


def _parse_evidences(raw: str) -> list[str]:
    """
    Parse "['E_7', 'E_54_@_V_180']" into ['E_7', 'E_54_@_V_180'].

    ast.literal_eval is correct but builds a full AST per row, which dominates
    runtime over 1M+ rows. Evidence tokens are a closed alphabet
    ([A-Za-z0-9_@]), so a strip-and-split is equivalent and ~10x faster.
    """
    s = raw.strip()
    if len(s) < 2 or s[0] != "[":
        return []
    s = s[1:-1].strip()
    if not s:
        return []
    out = []
    for part in s.split(","):
        tok = part.strip().strip("'\"")
        if tok:
            out.append(tok)
    return out


# A few DDXPlus labels are renamed to what a patient would recognise. Imported
# lazily so this module keeps working without the legacy bridge.
try:  # pragma: no cover - trivial import guard
    from data.legacy_bridge import RELABEL_DDXPLUS as _RELABEL
except Exception:  # noqa: BLE001
    _RELABEL = {}


def _iter_patients(zip_name: str):
    """Yield (pathology, evidence_tokens, age, sex) from a DDXPlus patient zip."""
    path = _require(zip_name)
    with zipfile.ZipFile(path) as z:
        member = z.namelist()[0]
        with z.open(member) as fh:
            text = io.TextIOWrapper(fh, encoding="utf-8", errors="replace")
            reader = csv.reader(text)
            header = next(reader, None)
            if not header:
                return
            col = {name: i for i, name in enumerate(header)}
            i_path, i_ev = col.get("PATHOLOGY"), col.get("EVIDENCES")
            i_age, i_sex = col.get("AGE"), col.get("SEX")
            if i_path is None or i_ev is None:
                raise RuntimeError(f"unexpected DDXPlus columns in {zip_name}: {header}")
            for row in reader:
                if len(row) <= max(i_path, i_ev):
                    continue
                tokens = _parse_evidences(row[i_ev])
                if not tokens:
                    continue
                yield (
                    _RELABEL.get(row[i_path].strip(), row[i_path].strip()),
                    tokens,
                    row[i_age] if i_age is not None and len(row) > i_age else None,
                    row[i_sex] if i_sex is not None and len(row) > i_sex else None,
                )


def load_dataset(
    split: str = "train",
    max_per_class: int | None = 6000,
    verbose: bool = True,
    extra_features: dict[str, str] | None = None,
) -> tuple[np.ndarray, np.ndarray, FeatureSpace, dict]:
    """
    Returns (X uint8 [n, n_features], y str [n], feature_space, conditions).

    `max_per_class` caps rows per pathology — Naive Bayes converges long before
    1.3M rows, and the cap keeps the matrix in memory comfortably.
    """
    zip_name = {
        "train": "release_train_patients.zip",
        "validate": "release_validate_patients.zip",
        "test": "release_test_patients.zip",
    }[split]

    conditions, evidences = load_meta()
    fs = FeatureSpace(evidences, extra=extra_features)

    if verbose:
        extra_n = len(extra_features or {})
        suffix = f" (+{extra_n} legacy)" if extra_n else ""
        print(f"  feature space: {fs.n_features} features from {len(evidences)} evidences{suffix}")

    kept: Counter = Counter()
    rows: list[np.ndarray] = []
    labels: list[str] = []
    seen = 0

    for pathology, tokens, _age, _sex in _iter_patients(zip_name):
        seen += 1
        if not pathology:
            continue
        if max_per_class is not None and kept[pathology] >= max_per_class:
            continue
        vec = np.zeros(fs.n_features, dtype=np.uint8)
        fs.encode(tokens, vec)
        rows.append(vec)
        labels.append(pathology)
        kept[pathology] += 1

    if not rows:
        raise RuntimeError(f"no usable rows parsed from {zip_name}")

    X = np.vstack(rows)
    y = np.array(labels, dtype=object)

    if verbose:
        print(f"  {split}: read {seen} rows -> kept {len(y)} across {len(kept)} pathologies")
        density = float(X.mean())
        print(f"  mean feature density: {density:.4f} ({density * fs.n_features:.1f} bits set per patient)")

    return X, y, fs, conditions


def build_disease_meta(conditions: dict, classes: list[str]) -> dict:
    """condition -> {specialization, urgency, icd10} for the served model."""
    meta = {}
    for name in classes:
        spec, urgency = tax.route(name)
        entry = conditions.get(name, {})
        meta[name] = {
            "specialization": spec,
            "urgency": urgency,
            "icd10": (entry.get("icd10-id") or "").strip().upper() or None,
            "severity": entry.get("severity"),
        }
    return meta


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def _inspect() -> None:
    conditions, evidences = load_meta()
    fs = FeatureSpace(evidences)

    print(f"conditions : {len(conditions)}")
    print(f"evidences  : {len(evidences)}")
    print(f"features   : {fs.n_features}")
    print()
    print("encoding by kind:")
    for kind, n in Counter(fs.kind.values()).most_common():
        print(f"  {kind:8s} {n:4d} evidences")
    print()

    by_group = defaultdict(list)
    for feat, code in fs.group.items():
        by_group[code].append(feat)
    multi = {c: f for c, f in by_group.items() if len(f) > 1}
    print(f"grouped (non-binary) evidences: {len(multi)}")
    for code in list(multi)[:6]:
        print(f"  {code}: {len(multi[code])} features")
        for feat in multi[code][:4]:
            print(f"      {feat:28s} {fs.questions[feat]}")
    print()

    print("specialty routing coverage:")
    routed = Counter()
    unmapped = []
    for name in conditions:
        spec, _ = tax.route(name)
        routed[spec] += 1
        if name not in tax.CONDITION_ROUTING:
            unmapped.append(name)
    for spec, n in routed.most_common():
        print(f"  {n:3d}  {spec}")
    if unmapped:
        print(f"\n  !! {len(unmapped)} conditions fell back to default: {unmapped}")
    else:
        print("\n  all conditions explicitly routed")

    print("\nregion binning check (E_55 pain site):")
    vm = evidences["E_55"].get("value_meaning", {})
    regions = Counter(tax.region_of(v.get("en", "")) for v in vm.values())
    for r, n in regions.most_common():
        flag = "  <-- check" if r == "other" and n > 12 else ""
        print(f"  {n:4d}  {r}{flag}")


def main() -> None:
    import argparse

    p = argparse.ArgumentParser(description="DDXPlus ingestion")
    p.add_argument("--download", action="store_true", help="fetch the release from figshare")
    p.add_argument("--force", action="store_true", help="re-download even if present")
    p.add_argument("--inspect", action="store_true", help="print the derived feature space")
    args = p.parse_args()

    if args.download:
        print(f"Downloading DDXPlus into {DDX_DIR}")
        download(force=args.force)
        print("done.")
    if args.inspect:
        _inspect()
    if not (args.download or args.inspect):
        p.print_help()


if __name__ == "__main__":
    main()
