"""
Bridge the in-repo `knowledge.py` conditions into the DDXPlus feature space.

WHY
DDXPlus is an ACUTE-CARE dataset: strong on cardiac, respiratory and ENT, and it has
no label at all for several of the commonest telemedicine presentations. Trained on
DDXPlus alone the model has nowhere to put them, so it forces them onto its nearest
neighbour with high confidence — measured example: "sudden lower-right abdominal pain,
no appetite, nauseous" came out as Possible NSTEMI/STEMI at 99.9%, i.e. appendicitis
routed to Cardiology.

So the served model trains on the UNION: DDXPlus's 49 pathologies plus the 11
conditions from knowledge.py that DDXPlus does not cover.

HOW (and why not the naive way)
The naive union — concatenate two datasets with different feature sets — leaks. Legacy
patients would be all-zero across the ~250 DDXPlus-only features, so the model would
learn "any DDXPlus feature set => not a legacy condition", and a single 'yes' would
annihilate the legacy posterior.

Instead the legacy conditions' priors are RE-EXPRESSED in DDXPlus feature space: each
old symptom maps to the DDXPlus evidence(s) that mean the same thing, and everything
unmapped falls back to the normal base rate. Every patient then lives in one shared
space where a zero genuinely means "absent", not "never asked".
"""
from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import knowledge  # noqa: E402

# ---------------------------------------------------------------------------
# Which legacy conditions to keep
# ---------------------------------------------------------------------------
# Dropped because DDXPlus already has an equivalent (or better-specified) label.
# Keeping both would create duplicate classes that split probability mass — e.g.
# legacy "Heart Attack" competing with DDXPlus "Possible NSTEMI / STEMI" means
# neither reaches the confidence threshold and triage never stops early.
COVERED_BY_DDXPLUS = {
    "Angina": "Stable angina / Unstable angina",
    "Asthma": "Bronchospasm / acute asthma exacerbation",
    "Bronchitis": "Bronchitis",
    "Common Cold": "URTI",
    "GERD": "GERD",
    "Heart Attack": "Possible NSTEMI / STEMI",
    "Influenza": "Influenza",
    "Pneumonia": "Pneumonia",
}

# The 11 that DDXPlus genuinely cannot represent. These are mostly the common,
# non-emergency presentations a telemedicine product sees most.
LEGACY_CONDITIONS = [
    name for name in knowledge.DISEASES if name not in COVERED_BY_DDXPLUS
]

# ---------------------------------------------------------------------------
# Specialty routing fixes
# ---------------------------------------------------------------------------
# knowledge.py routes several conditions to "Pulmonology", which is NOT one of the
# 16 specializations the platform staffs (see admin-specializations.ts) — those
# patients were being sent to a specialty with zero bookable doctors.
SPECIALIZATION_FIXES = {
    "Pulmonology": "General Medicine",
    "Internal Medicine": "General Medicine",
    "Emergency Medicine": "General Medicine",
    "ENT": "ENT (Ear, Nose & Throat)",
}

# ---------------------------------------------------------------------------
# Symptom translation
# ---------------------------------------------------------------------------
# legacy symptom id -> DDXPlus feature name(s) with the same clinical meaning.
# A legacy symptom may imply several features: "chest_pain" means both "you have
# pain" (E_53) and "the pain is in your chest" (E_55__chest).
SYMPTOM_TO_FEATURES: dict[str, list[str]] = {
    "fever":                      ["E_91"],
    "chills":                     ["E_94"],
    "cough":                      ["E_201"],
    "productive_cough":           ["E_77", "E_201"],
    "sore_throat":                ["E_97"],
    "runny_nose":                 ["E_181"],
    "shortness_of_breath":        ["E_66"],
    "wheezing":                   ["E_214"],
    "chest_pain":                 ["E_53", "E_55__chest"],
    "chest_pain_exertion":        ["E_218"],
    "chest_pain_radiating":       ["E_57__arm"],
    "sweating":                   ["E_50"],
    "palpitations":               ["E_155"],
    "nausea":                     ["E_148"],
    "vomiting":                   ["E_211"],
    "diarrhea":                   ["E_51"],
    "abdominal_pain":             ["E_53", "E_55__abdomen"],
    "loss_of_appetite":           ["E_32", "E_161"],
    "heartburn":                  ["E_173"],
    "acid_reflux":                ["E_173"],
    "bloating":                   ["E_30"],
    "headache":                   ["E_53", "E_55__head"],
    "severe_headache":            ["E_53", "E_55__head", "E_56__2"],
    "neck_stiffness":             ["E_192"],
    "dizziness":                  ["E_82", "E_76"],
    "fatigue":                    ["E_89"],
    "body_ache":                  ["E_144"],
    "muscle_pain":                ["E_144"],
    "rash":                       ["E_129"],
    "loss_of_smell":              ["E_103"],
    "back_pain":                  ["E_53", "E_55__back"],
    "pain_worse_movement":        ["E_216"],
    "radiating_leg_pain":         ["E_57__leg"],
}

# Legacy symptoms with NO DDXPlus equivalent. These become additional features in the
# shared space. Several are highly specific (burning urination for UTI, lower-right
# abdominal pain for appendicitis) and are exactly why DDXPlus alone cannot route
# these patients.
EXTRA_FEATURES: dict[str, str] = {
    "L_high_fever":              "Is your fever high (above 39C / 102F)?",
    "L_dry_cough":               "Is your cough dry (no phlegm)?",
    "L_sneezing":                "Have you been sneezing a lot?",
    "L_lower_right_abdo_pain":   "Is the pain in your lower-right abdomen?",
    "L_photophobia":             "Does light bother your eyes?",
    "L_joint_pain":              "Do you have joint pain?",
    "L_loss_of_taste":           "Have you lost your sense of taste?",
    "L_burning_urination":       "Does it burn when you urinate?",
    "L_frequent_urination":      "Are you urinating more often than usual?",
    "L_blood_in_urine":          "Have you noticed blood in your urine?",
    "L_stiffness":               "Do your muscles or joints feel stiff?",
}

# legacy symptom id -> the extra feature it becomes
EXTRA_SYMPTOM_MAP: dict[str, str] = {
    "high_fever":                 "L_high_fever",
    "dry_cough":                  "L_dry_cough",
    "sneezing":                   "L_sneezing",
    "lower_right_abdominal_pain": "L_lower_right_abdo_pain",
    "sensitivity_to_light":       "L_photophobia",
    "joint_pain":                 "L_joint_pain",
    "loss_of_taste":              "L_loss_of_taste",
    "burning_urination":          "L_burning_urination",
    "frequent_urination":         "L_frequent_urination",
    "blood_in_urine":             "L_blood_in_urine",
    "stiffness":                  "L_stiffness",
}


def features_for(symptom: str) -> list[str]:
    if symptom in SYMPTOM_TO_FEATURES:
        return SYMPTOM_TO_FEATURES[symptom]
    if symptom in EXTRA_SYMPTOM_MAP:
        return [EXTRA_SYMPTOM_MAP[symptom]]
    return []


def unmapped_symptoms() -> list[str]:
    """Legacy symptoms that translate to nothing — should be empty."""
    return [
        s
        for s in knowledge.symptom_list()
        if s not in SYMPTOM_TO_FEATURES and s not in EXTRA_SYMPTOM_MAP
    ]


def condition_feature_probs(condition: str, feature_index: dict[str, int]) -> np.ndarray:
    """
    P(feature = 1 | condition) over the shared feature space.

    Where several legacy symptoms map to the same feature (heartburn and acid_reflux
    both mean E_173), probabilities combine as a noisy-OR: the feature is present if
    ANY contributing symptom is present.
    """
    probs = np.full(len(feature_index), knowledge.BASE_RATE, dtype=float)
    absent = np.ones(len(feature_index), dtype=float)   # P(no contributor fired)
    touched = np.zeros(len(feature_index), dtype=bool)

    for symptom, p in knowledge.DISEASES[condition]["symptoms"].items():
        for feature in features_for(symptom):
            j = feature_index.get(feature)
            if j is None:
                continue
            absent[j] *= (1.0 - float(p))
            touched[j] = True

    probs[touched] = 1.0 - absent[touched]
    return probs


def generate(
    feature_names: list[str],
    per_condition: int = 6000,
    seed: int = 42,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Sample legacy-condition patients directly in the shared feature space.

    Returns (X uint8 [n, n_features], y str [n]).
    """
    rng = np.random.default_rng(seed)
    index = {f: i for i, f in enumerate(feature_names)}
    n_features = len(feature_names)

    blocks: list[np.ndarray] = []
    labels: list[str] = []

    for condition in LEGACY_CONDITIONS:
        p = condition_feature_probs(condition, index)
        draws = (rng.random((per_condition, n_features)) < p).astype(np.uint8)

        # never emit an all-negative patient — the engine would see no evidence at all
        empty = draws.sum(axis=1) == 0
        if empty.any():
            core = int(np.argmax(p))
            draws[empty, core] = 1

        blocks.append(draws)
        labels.extend([condition] * per_condition)

    return np.vstack(blocks), np.array(labels, dtype=object)


def build_disease_meta(conditions: list[str]) -> dict:
    """{specialization, urgency} for legacy conditions, with unstaffed specialties remapped."""
    out = {}
    for name in conditions:
        meta = knowledge.DISEASES[name]
        spec = meta.get("specialization", knowledge.DEFAULT_SPECIALIZATION)
        out[name] = {
            "specialization": SPECIALIZATION_FIXES.get(spec, spec),
            "urgency": meta.get("urgency", knowledge.DEFAULT_URGENCY),
            "icd10": None,          # legacy conditions are not ICD-coded yet
            "severity": None,
            "source": "knowledge.py",
        }
    return out
