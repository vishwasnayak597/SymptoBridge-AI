"""
Product-side taxonomy for the DDXPlus dataset.

DDXPlus ships pathologies with an ICD-10 code and a numeric `severity` (1 = most
severe .. 5 = least), but no specialty routing — and this product's whole output is
"which specialist should you see". This module supplies that mapping.

IMPORTANT: every specialization here MUST exist in SPECIALIZATIONS in
backend/src/routes/admin-specializations.ts, or triage will recommend a specialty
the platform has no doctors for. (The pre-DDXPlus model routes Asthma / Bronchitis /
Pneumonia to "Pulmonology", which is NOT in that list — that mismatch is fixed here
by routing respiratory conditions to General Medicine.)

Urgency is hand-set per condition rather than derived from `severity`, because
severity conflates "how bad is this disease" with "how fast must you act"
(Stable angina is severity 2 but is not an emergency).
"""
from __future__ import annotations

# The 16 specializations the platform actually staffs. Keep in sync with
# backend/src/routes/admin-specializations.ts.
SUPPORTED_SPECIALIZATIONS = {
    "General Medicine",
    "Cardiology",
    "Dermatology",
    "Pediatrics",
    "Orthopedics",
    "Psychiatry",
    "Radiology",
    "Surgery",
    "Gynecology",
    "Neurology",
    "Urology",
    "Dentistry",
    "Ophthalmology",
    "ENT (Ear, Nose & Throat)",
    "Oncology",
    "Gastroenterology",
}

DEFAULT_SPECIALIZATION = "General Medicine"
DEFAULT_URGENCY = "medium"

# condition_name -> (specialization, urgency)
# urgency vocabulary matches engine.py URGENCY_ORDER: low < medium < high < urgent
CONDITION_ROUTING: dict[str, tuple[str, str]] = {
    # --- cardiac ---
    "Possible NSTEMI / STEMI":                  ("Cardiology", "urgent"),
    "Unstable angina":                          ("Cardiology", "urgent"),
    "Stable angina":                            ("Cardiology", "high"),
    "Myocarditis":                              ("Cardiology", "urgent"),
    "Pericarditis":                             ("Cardiology", "high"),
    "Atrial fibrillation":                      ("Cardiology", "high"),
    "PSVT":                                     ("Cardiology", "high"),
    "Acute pulmonary edema":                    ("Cardiology", "urgent"),

    # --- airway / immediate respiratory emergencies ---
    "Anaphylaxis":                              ("General Medicine", "urgent"),
    "Larygospasm":                              ("ENT (Ear, Nose & Throat)", "urgent"),
    "Epiglottitis":                             ("ENT (Ear, Nose & Throat)", "urgent"),
    "Pulmonary embolism":                       ("General Medicine", "urgent"),
    "Spontaneous pneumothorax":                 ("Surgery", "urgent"),

    # --- respiratory (no Pulmonology on this platform -> General Medicine) ---
    "Pneumonia":                                ("General Medicine", "high"),
    "Bronchitis":                               ("General Medicine", "medium"),
    "Bronchiectasis":                           ("General Medicine", "medium"),
    "Bronchospasm / acute asthma exacerbation": ("General Medicine", "high"),
    "Acute COPD exacerbation / infection":      ("General Medicine", "high"),
    "Tuberculosis":                             ("General Medicine", "high"),
    "Sarcoidosis":                              ("General Medicine", "medium"),
    "Influenza":                                ("General Medicine", "low"),
    "URTI":                                     ("General Medicine", "low"),
    "Viral pharyngitis":                        ("General Medicine", "low"),

    # --- paediatric-predominant ---
    "Croup":                                    ("Pediatrics", "high"),
    "Bronchiolitis":                            ("Pediatrics", "high"),
    "Whooping cough":                           ("Pediatrics", "medium"),

    # --- ENT ---
    "Acute laryngitis":                         ("ENT (Ear, Nose & Throat)", "low"),
    "Acute otitis media":                       ("ENT (Ear, Nose & Throat)", "medium"),
    "Acute rhinosinusitis":                     ("ENT (Ear, Nose & Throat)", "low"),
    "Chronic rhinosinusitis":                   ("ENT (Ear, Nose & Throat)", "low"),
    "Allergic sinusitis":                       ("ENT (Ear, Nose & Throat)", "low"),

    # --- neurology ---
    "Guillain-Barré syndrome":                  ("Neurology", "urgent"),
    "Myasthenia gravis":                        ("Neurology", "high"),
    "Acute dystonic reactions":                 ("Neurology", "high"),
    "Cluster headache":                         ("Neurology", "medium"),

    # --- surgical / GI ---
    "Boerhaave":                                ("Surgery", "urgent"),
    "Inguinal hernia":                          ("Surgery", "medium"),
    "GERD":                                     ("Gastroenterology", "low"),
    "Scombroid food poisoning":                 ("Gastroenterology", "high"),

    # --- oncology ---
    "Pulmonary neoplasm":                       ("Oncology", "high"),
    "Pancreatic neoplasm":                      ("Oncology", "high"),

    # --- infectious / systemic ---
    "HIV (initial infection)":                  ("General Medicine", "high"),
    "Ebola":                                    ("General Medicine", "urgent"),
    "Chagas":                                   ("General Medicine", "medium"),
    "SLE":                                      ("General Medicine", "medium"),
    "Anemia":                                   ("General Medicine", "medium"),
    "Localized edema":                          ("General Medicine", "medium"),

    # --- musculoskeletal / psych ---
    "Spontaneous rib fracture":                 ("Orthopedics", "medium"),
    "Panic attack":                             ("Psychiatry", "low"),
}


def route(condition_name: str) -> tuple[str, str]:
    """(specialization, urgency) for a DDXPlus pathology, safely defaulted."""
    spec, urg = CONDITION_ROUTING.get(
        condition_name, (DEFAULT_SPECIALIZATION, DEFAULT_URGENCY)
    )
    if spec not in SUPPORTED_SPECIALIZATIONS:
        spec = DEFAULT_SPECIALIZATION
    return spec, urg


# ---------------------------------------------------------------------------
# Body-region binning
# ---------------------------------------------------------------------------
# Four DDXPlus evidences (pain site, pain radiation, affected region, swelling site)
# each have 165 possible values — one-hot encoding them would create 660 near-empty
# features and let side/laterality dominate the model. They are binned into coarse
# anatomical regions instead: diagnostically that is what matters ("chest pain" vs
# "left biceps pain"), and it keeps the feature space learnable.
#
# Rules are ordered; the FIRST matching keyword wins, so specific terms are listed
# before general ones.
REGION_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("head", (
        "forehead", "temple", "occiput", "back of head", "top of the head",
        "skull", "scalp", "eye", "eyebrow", "eyelid", "nose", "nostril",
        "cheek", "chin", "jaw", "ear", "tongue", "gum", "teeth", "tooth",
        "lip", "vermilion", "commissure", "palate", "palace", "uvula",
        "tonsil", "pharynx", "mouth", "face",
    )),
    ("neck", (
        "neck", "cervical", "thyroid", "trachea", "larynx", "throat",
        "trapezius",
    )),
    ("chest", (
        "chest", "sternum", "breast", "rib", "thorax", "pectoral", "clavicle",
        "axilla", "shoulder blade", "scapula",
    )),
    ("abdomen", (
        "belly", "abdom", "epigastric", "hypochondrium", "umbilic", "flank",
        "iliac fossa", "stomach", "navel",
    )),
    ("back", (
        "back", "spine", "lumbar", "thoracic spine", "loin", "renal fossa",
    )),
    ("pelvis", (
        "groin", "pubis", "penis", "glans", "testicle", "scrotum", "vagina",
        "vulva", "labia", "clitoris", "hymen", "perineum", "anus", "rectum",
        "urethra", "buttock", "coccyx", "sacrum", "iliac wing", "iliac crest",
        "hip", "bladder",
    )),
    ("arm", (
        "shoulder", "arm", "biceps", "triceps", "elbow", "forearm", "wrist",
        "hand", "finger", "thumb", "palm",
    )),
    ("leg", (
        "thigh", "knee", "popliteal", "calf", "shin", "tibia", "leg", "ankle",
        "foot", "sole", "toe", "heel", "hamstring", "ischio", "quadriceps",
    )),
    ("generalised", ("everywhere", "generalis", "generaliz", "diffuse")),
]

REGIONS: list[str] = [name for name, _ in REGION_RULES] + ["other"]

# Natural-language names for the regions, used to build patient-facing questions.
REGION_LABELS: dict[str, str] = {
    "head": "head or face",
    "neck": "neck or throat",
    "chest": "chest",
    "abdomen": "stomach area",
    "back": "back",
    "pelvis": "pelvis or groin",
    "arm": "arm or hand",
    "leg": "leg or foot",
    "generalised": "whole body",
    "other": "somewhere else",
}

# Values meaning "absent" / "not applicable". These must NOT become positive
# features: in a Bernoulli model, absence of every E_55__* bit already encodes
# "no pain anywhere". Encoding 'nowhere' as a positive region would tell the
# model a patient with no pain DOES have pain, somewhere.
# "N" is DDXPlus's explicit negative for yes/no categoricals (E_135 "lesion larger
# than 1cm": N/Y; E_204 travel: N + 11 regions). Encoding it positively would create
# a feature meaning "travelled to N".
NULL_VALUE_LABELS = {"nowhere", "na", "n/a", "none", "", "n", "no"}

# The affirmative half of a DDXPlus yes/no categorical.
TRUE_VALUE_LABELS = {"y", "yes"}


def is_null_value(value_label: str) -> bool:
    return (value_label or "").strip().lower() in NULL_VALUE_LABELS


def region_of(value_label: str) -> str:
    """Bin a DDXPlus location label (e.g. 'iliac fossa(R)') to a coarse region."""
    v = (value_label or "").strip().lower()
    for name, keywords in REGION_RULES:
        for kw in keywords:
            if kw in v:
                return name
    return "other"


# ---------------------------------------------------------------------------
# Ordinal binning
# ---------------------------------------------------------------------------
# DDXPlus 0-10 scales, binned to three bands. The band LABELS differ per evidence:
# a 0-10 "how fast did the pain appear" scale is not mild/moderate/severe, it is
# gradual/sudden — using one generic label set produced questions like
# "How fast did the pain appear - is it mild?", which is meaningless.
BAND_CUTS: list[tuple[int, int]] = [(0, 3), (4, 6), (7, 10)]

# evidence code -> (question template with {band}, (low, mid, high) band labels)
ORDINAL_SPECS: dict[str, tuple[str, tuple[str, str, str]]] = {
    "E_56":  ("Would you say the pain is {band}?",
              ("mild", "moderate", "severe")),
    "E_58":  ("Is the pain {band}?",
              ("hard to pinpoint", "roughly localised", "very precisely located")),
    "E_59":  ("Did the pain come on {band}?",
              ("gradually, over days", "over a few hours", "suddenly")),
    "E_134": ("Is the pain from the rash {band}?",
              ("mild", "moderate", "severe")),
    "E_132": ("Is the rash {band}?",
              ("flat, not swollen", "slightly swollen", "clearly swollen")),
    "E_136": ("Is the itching {band}?",
              ("mild", "moderate", "intense")),
}

DEFAULT_ORDINAL_LABELS = ("mild", "moderate", "severe")


def ordinal_band_index(value: float) -> int:
    for i, (lo, hi) in enumerate(BAND_CUTS):
        if lo <= value <= hi:
            return i
    return len(BAND_CUTS) - 1 if value > BAND_CUTS[-1][1] else 0


def ordinal_spec(code: str) -> tuple[str, tuple[str, str, str]]:
    """(question template, band labels) for an ordinal evidence."""
    return ORDINAL_SPECS.get(code, ("Is it {band}?", DEFAULT_ORDINAL_LABELS))
