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

import re

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
# Matching is WORD-ANCHORED. Plain substring matching silently mis-binned a third of
# the vocabulary: "ear" matched "for(ear)m" and "face" matched "palmar (face) of the
# wrist", so forearm and wrist pain were encoded as HEAD pain. With the arm folded
# into the head bucket, head pain stopped discriminating anything and "I have a
# headache" produced a flat differential of sinusitis / pharyngitis / epiglottitis.
#
# Rules are ordered and FIRST MATCH WINS, so specific structures (eye, ear, throat)
# are listed before the broad ones they sit inside.
REGION_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("eye",   (r"eyes?", r"eyebrows?", r"eyelids?", r"orbit")),
    ("ear",   (r"ears?", r"tympan\w*", r"mastoid")),
    ("throat", (
        r"pharynx", r"tonsils?", r"uvula", r"palace", r"palate", r"larynx",
        r"tongue", r"throat",
    )),
    ("face", (
        r"cheeks?", r"nose", r"nostrils?", r"chin", r"jaws?", r"gums?", r"teeth",
        r"tooth", r"lips?", r"commissures?", r"vermilion", r"mouth",
    )),
    ("head", (
        r"forehead", r"temples?", r"occiput", r"skull", r"scalp", r"head",
    )),
    ("neck",  (r"neck", r"cervical", r"thyroid", r"trachea")),
    ("chest", (
        r"chest", r"sternum", r"breasts?", r"ribs?", r"thorax", r"pectoral",
        r"clavicle", r"axilla", r"scapula",
    )),
    ("abdomen", (
        r"belly", r"abdom\w*", r"epigastric", r"hypochondrium", r"umbilic\w*",
        r"flank", r"fossa", r"stomach", r"navel",
    )),
    ("back",  (r"back", r"spine", r"lumbar", r"loin", r"trapezius")),
    ("pelvis", (
        r"groin", r"pubis", r"penis", r"glans", r"testicles?", r"scrotum",
        r"vagina", r"vulva", r"labia\w*", r"clitoris", r"hymen", r"perineum",
        r"anus", r"rectum", r"buttocks?", r"coccyx", r"sacrum", r"wing",
        r"crest", r"hips?", r"bladder", r"urethra", r"vaginal", r"vulval", r"vestibule",
    )),
    ("arm", (
        r"shoulders?", r"arms?", r"forearms?", r"biceps", r"triceps", r"elbows?",
        r"wrists?", r"hands?", r"fingers?", r"thumbs?", r"palm\w*",
    )),
    ("leg", (
        r"thighs?", r"knees?", r"calf", r"calves", r"shins?", r"legs?", r"ankles?",
        r"foot", r"feet", r"toes?", r"heels?", r"hamstrings?", r"ischio\w*", r"soles?", r"tibia",
        r"quadriceps",
    )),
    ("generalised", (r"nowhere", r"everywhere", r"generalis\w*", r"generaliz\w*", r"diffuse")),
]

REGIONS: list[str] = [name for name, _ in REGION_RULES] + ["other"]

# Patient-facing wording for each region, used to build readable questions
# ("Do you feel pain in your throat?" rather than "...in your throat region?").
REGION_LABELS: dict[str, str] = {
    "eye": "eye",
    "ear": "ear",
    "throat": "throat",
    "face": "face or jaw",
    "head": "head",
    "neck": "neck",
    "chest": "chest",
    "abdomen": "stomach area",
    "back": "back",
    "pelvis": "hip or groin",
    "arm": "arm or hand",
    "leg": "leg or foot",
    "generalised": "all over",
    "other": "that area",
}

# ---------------------------------------------------------------------------
# Absent / affirmative value labels
# ---------------------------------------------------------------------------
# DDXPlus spells "no finding" several ways. "N" is its explicit negative for
# yes/no categoricals (E_135 lesion size: N/Y; E_204 travel: N + 11 regions).
# Encoding any of these positively would tell the model that a painless patient
# has pain, and that someone who has not travelled travelled to a country
# called "N".
NULL_VALUE_LABELS = {"nowhere", "na", "n/a", "none", "", "n", "no"}

# The affirmative half of a DDXPlus yes/no categorical.
TRUE_VALUE_LABELS = {"y", "yes"}


def is_null_value(label: str) -> bool:
    """True when a value means 'absent' and should set no feature bit."""
    return (label or "").strip().lower() in NULL_VALUE_LABELS

# One compiled, word-anchored alternation per region.
_REGION_PATTERNS = [
    (name, re.compile(r"\b(?:" + "|".join(kws) + r")\b"))
    for name, kws in REGION_RULES
]


def region_of(value_label: str) -> str:
    """Bin a DDXPlus location label (e.g. 'iliac fossa(R)') to an anatomical region."""
    # Laterality suffixes carry no diagnostic weight and break \b anchoring.
    v = re.sub(r"\((?:l|r|d|g)\)", " ", (value_label or "").strip().lower())
    for name, pattern in _REGION_PATTERNS:
        if pattern.search(v):
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
