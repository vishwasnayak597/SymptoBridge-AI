"""
Clinically-informed priors used by the synthetic data generator (fallback when the
Kaggle CSVs are absent) and as the source of human-readable question text + disease
metadata (specialization / urgency) surfaced by the API.

These are coarse, education-grade priors — NOT clinical truth — and the model is trained
*from sampled data*, not from this table directly.
"""

# symptom_id -> patient-facing yes/no question
SYMPTOMS: dict[str, str] = {
    "fever": "Do you have a fever?",
    "high_fever": "Is your fever high (above 39C / 102F)?",
    "chills": "Do you have chills?",
    "cough": "Do you have a cough?",
    "dry_cough": "Is your cough dry (no phlegm)?",
    "productive_cough": "Is your cough bringing up phlegm/mucus?",
    "sore_throat": "Do you have a sore throat?",
    "runny_nose": "Do you have a runny or blocked nose?",
    "sneezing": "Have you been sneezing a lot?",
    "shortness_of_breath": "Are you short of breath?",
    "wheezing": "Do you hear wheezing when you breathe?",
    "chest_pain": "Do you have chest pain?",
    "chest_pain_exertion": "Does the chest pain get worse with exertion?",
    "chest_pain_radiating": "Does the chest pain spread to your arm, jaw, or back?",
    "sweating": "Are you sweating unusually (cold sweats)?",
    "palpitations": "Do you feel your heart racing or pounding?",
    "nausea": "Do you feel nauseous?",
    "vomiting": "Have you been vomiting?",
    "diarrhea": "Do you have diarrhea?",
    "abdominal_pain": "Do you have abdominal (stomach) pain?",
    "lower_right_abdominal_pain": "Is the pain in your lower-right abdomen?",
    "loss_of_appetite": "Have you lost your appetite?",
    "heartburn": "Do you have a burning feeling in your chest after eating?",
    "acid_reflux": "Do you get acid coming up into your throat?",
    "bloating": "Do you feel bloated or gassy?",
    "headache": "Do you have a headache?",
    "severe_headache": "Is the headache severe or the worst you've had?",
    "sensitivity_to_light": "Does light bother your eyes (photophobia)?",
    "neck_stiffness": "Is your neck stiff or painful to bend?",
    "dizziness": "Do you feel dizzy or lightheaded?",
    "fatigue": "Are you unusually tired or fatigued?",
    "body_ache": "Do you have general body aches?",
    "joint_pain": "Do you have joint pain?",
    "muscle_pain": "Do you have muscle pain?",
    "rash": "Do you have a skin rash?",
    "loss_of_smell": "Have you lost your sense of smell?",
    "loss_of_taste": "Have you lost your sense of taste?",
    "burning_urination": "Does it burn when you urinate?",
    "frequent_urination": "Are you urinating more often than usual?",
    "blood_in_urine": "Have you noticed blood in your urine?",
    "back_pain": "Do you have back pain?",
    "pain_worse_movement": "Does the pain get worse when you move, bend, or stand?",
    "radiating_leg_pain": "Does the pain shoot down into your leg or buttock?",
    "stiffness": "Do your muscles or joints feel stiff?",
}

# disease -> metadata + characteristic symptoms with P(symptom present | disease)
DISEASES: dict[str, dict] = {
    "Common Cold": {
        "specialization": "General Medicine", "urgency": "low",
        "symptoms": {"runny_nose": 0.9, "sneezing": 0.85, "sore_throat": 0.7,
                     "cough": 0.6, "fatigue": 0.5, "headache": 0.3},
    },
    "Influenza": {
        "specialization": "General Medicine", "urgency": "low",
        "symptoms": {"fever": 0.9, "high_fever": 0.5, "chills": 0.7, "body_ache": 0.85,
                     "fatigue": 0.8, "cough": 0.6, "sore_throat": 0.5, "headache": 0.6},
    },
    "COVID-19": {
        "specialization": "General Medicine", "urgency": "medium",
        "symptoms": {"fever": 0.7, "dry_cough": 0.75, "fatigue": 0.7, "loss_of_smell": 0.6,
                     "loss_of_taste": 0.55, "shortness_of_breath": 0.4, "sore_throat": 0.4,
                     "body_ache": 0.5},
    },
    "Pneumonia": {
        "specialization": "Pulmonology", "urgency": "high",
        "symptoms": {"high_fever": 0.7, "fever": 0.85, "productive_cough": 0.8,
                     "shortness_of_breath": 0.7, "chest_pain": 0.5, "chills": 0.6,
                     "fatigue": 0.6},
    },
    "Bronchitis": {
        "specialization": "Pulmonology", "urgency": "medium",
        "symptoms": {"productive_cough": 0.85, "cough": 0.9, "fatigue": 0.5,
                     "sore_throat": 0.4, "shortness_of_breath": 0.4, "wheezing": 0.4},
    },
    "Asthma": {
        "specialization": "Pulmonology", "urgency": "medium",
        "symptoms": {"wheezing": 0.85, "shortness_of_breath": 0.85, "cough": 0.6,
                     "dry_cough": 0.5, "chest_pain": 0.3},
    },
    "Migraine": {
        "specialization": "Neurology", "urgency": "low",
        "symptoms": {"severe_headache": 0.8, "headache": 0.95, "sensitivity_to_light": 0.75,
                     "nausea": 0.6, "dizziness": 0.4},
    },
    "Tension Headache": {
        "specialization": "Neurology", "urgency": "low",
        "symptoms": {"headache": 0.95, "fatigue": 0.5, "muscle_pain": 0.4},
    },
    "GERD": {
        "specialization": "Gastroenterology", "urgency": "low",
        "symptoms": {"heartburn": 0.9, "acid_reflux": 0.85, "chest_pain": 0.4,
                     "bloating": 0.5, "nausea": 0.3},
    },
    "Gastritis": {
        "specialization": "Gastroenterology", "urgency": "medium",
        "symptoms": {"abdominal_pain": 0.85, "nausea": 0.6, "bloating": 0.6,
                     "loss_of_appetite": 0.5, "vomiting": 0.4, "heartburn": 0.4},
    },
    "Food Poisoning": {
        "specialization": "Gastroenterology", "urgency": "medium",
        "symptoms": {"vomiting": 0.8, "diarrhea": 0.85, "abdominal_pain": 0.7,
                     "nausea": 0.8, "fever": 0.4, "loss_of_appetite": 0.5},
    },
    "Appendicitis": {
        "specialization": "Surgery", "urgency": "urgent",
        "symptoms": {"lower_right_abdominal_pain": 0.9, "abdominal_pain": 0.85,
                     "loss_of_appetite": 0.7, "nausea": 0.6, "vomiting": 0.5, "fever": 0.4},
    },
    "Heart Attack": {
        "specialization": "Cardiology", "urgency": "urgent",
        "symptoms": {"chest_pain": 0.9, "chest_pain_radiating": 0.7, "sweating": 0.7,
                     "shortness_of_breath": 0.6, "nausea": 0.4, "palpitations": 0.4,
                     "chest_pain_exertion": 0.5},
    },
    "Angina": {
        "specialization": "Cardiology", "urgency": "high",
        "symptoms": {"chest_pain": 0.85, "chest_pain_exertion": 0.8, "shortness_of_breath": 0.5,
                     "sweating": 0.4, "palpitations": 0.4},
    },
    "Urinary Tract Infection": {
        "specialization": "Urology", "urgency": "medium",
        "symptoms": {"burning_urination": 0.9, "frequent_urination": 0.8, "back_pain": 0.4,
                     "blood_in_urine": 0.3, "fever": 0.3, "abdominal_pain": 0.3},
    },
    "Muscle Strain": {
        "specialization": "Orthopedics", "urgency": "low",
        "symptoms": {"back_pain": 0.85, "pain_worse_movement": 0.8, "muscle_pain": 0.7,
                     "stiffness": 0.6, "joint_pain": 0.2},
    },
    "Sciatica": {
        "specialization": "Orthopedics", "urgency": "medium",
        "symptoms": {"back_pain": 0.8, "radiating_leg_pain": 0.85, "pain_worse_movement": 0.6,
                     "muscle_pain": 0.3, "stiffness": 0.4},
    },
    "Kidney Stone": {
        "specialization": "Urology", "urgency": "high",
        "symptoms": {"back_pain": 0.7, "blood_in_urine": 0.5, "frequent_urination": 0.4,
                     "nausea": 0.5, "vomiting": 0.4, "abdominal_pain": 0.4},
    },
    "Dengue": {
        "specialization": "General Medicine", "urgency": "high",
        "symptoms": {"high_fever": 0.8, "fever": 0.95, "severe_headache": 0.6, "joint_pain": 0.8,
                     "muscle_pain": 0.75, "rash": 0.5, "fatigue": 0.7, "nausea": 0.5},
    },
}

# probability a symptom NOT characteristic of a disease still shows up (noise floor)
BASE_RATE = 0.04

DEFAULT_SPECIALIZATION = "General Medicine"
DEFAULT_URGENCY = "medium"


def symptom_list() -> list[str]:
    return list(SYMPTOMS.keys())


def disease_list() -> list[str]:
    return list(DISEASES.keys())
