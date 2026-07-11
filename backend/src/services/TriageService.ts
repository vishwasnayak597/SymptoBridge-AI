/**
 * Bridges the Node API to the Python triage ML microservice.
 *
 * The diagnosis/reasoning lives in the ML service (`ML_SERVICE_URL`); this layer only
 * proxies, seeds initial symptom evidence from free text, and shapes responses. The LLM
 * is intentionally NOT the diagnostician here — it could later replace `extractInitialFindings`
 * as a nicer parser, but the trained model does the actual inference.
 */

// Prefer the explicit env var. Fall back to localhost only in development — in
// production the ML service is a separate Render service, never on localhost, so
// defaulting there would make every triage call fail silently.
const ML_SERVICE_URL =
  process.env.ML_SERVICE_URL ||
  (process.env.NODE_ENV === 'production'
    ? 'https://symptobridge-ml.onrender.com'
    : 'http://localhost:8001');

export interface TriageCondition {
  disease: string;
  prob: number;
  specialization: string;
  urgency: string;
}

export interface TriageStep {
  posterior: TriageCondition[];
  nextQuestion: { symptom: string; question: string; infoGain: number } | null;
  done: boolean;
  urgency: string;
  recommendedSpecializations: string[];
  askedCount: number;
}

interface SymptomMeta {
  id: string;
  question: string;
}

let symptomCache: SymptomMeta[] | null = null;

async function mlFetch(path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${ML_SERVICE_URL}${path}`, body !== undefined
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : {});
  if (!res.ok) {
    throw new Error(`ML service ${path} responded ${res.status}`);
  }
  return res.json();
}

export async function getTriageMeta(): Promise<any> {
  return mlFetch('/meta');
}

async function getSymptoms(): Promise<SymptomMeta[]> {
  if (!symptomCache) {
    const meta = await mlFetch('/meta');
    symptomCache = meta.symptoms || [];
  }
  return symptomCache!;
}

/**
 * Common lay phrasings that the plain token match can't catch, mapped to symptom ids.
 * Token matching handles the easy cases ("back pain" -> back_pain); this covers wording
 * where the patient never says the symptom id's words ("shoots down my leg", "when I stand").
 */
const SYNONYM_PHRASES: Array<[RegExp, string]> = [
  [/\b(worse|hurts?) (when|on) (i )?(stand|move|bend|walk|sit)|when i stand|on movement|bending/, 'pain_worse_movement'],
  [/shoots? down|down (my|the) leg|into (my|the) leg|radiat/, 'radiating_leg_pain'],
  [/stiff/, 'stiffness'],
  [/burning (when|to) (i )?(pee|urinat)|burns? when i pee/, 'burning_urination'],
  [/blood in (my )?(urine|pee)/, 'blood_in_urine'],
  [/(throw|threw|throwing) up|vomit/, 'vomiting'],
  [/short(ness)? of breath|can'?t breathe|out of breath|breathless/, 'shortness_of_breath'],
  [/can'?t smell|lost my sense of smell|no sense of smell/, 'loss_of_smell'],
  [/runny nose|stuffy nose|blocked nose/, 'runny_nose'],
];

/**
 * Seed symptom evidence from the patient's free-text description.
 *
 * Two passes: (1) match the model's symptom vocabulary where every underscore-separated
 * token of a symptom id appears in the text; (2) apply a curated synonym map for lay
 * phrasings the token match would miss. Only symptoms the model actually knows are kept.
 */
export async function extractInitialFindings(symptoms: string): Promise<Record<string, number>> {
  const text = ` ${symptoms.toLowerCase()} `;
  const syms = await getSymptoms();
  const known = new Set(syms.map((s) => s.id));
  const evidence: Record<string, number> = {};

  for (const s of syms) {
    const tokens = s.id.split('_').filter((t) => t.length > 2);
    if (tokens.length > 0 && tokens.every((t) => text.includes(t))) {
      evidence[s.id] = 1;
    }
  }

  for (const [pattern, symptomId] of SYNONYM_PHRASES) {
    if (known.has(symptomId) && pattern.test(text)) {
      evidence[symptomId] = 1;
    }
  }

  return evidence;
}

export async function startTriage(symptoms: string): Promise<TriageStep & { evidence: Record<string, number> }> {
  const evidence = await extractInitialFindings(symptoms);
  const step = await mlFetch('/next-question', { evidence });
  return { ...step, evidence };
}

export async function answerTriage(
  evidence: Record<string, number>,
  skip: string[] = []
): Promise<TriageStep> {
  return mlFetch('/next-question', { evidence, skip });
}
