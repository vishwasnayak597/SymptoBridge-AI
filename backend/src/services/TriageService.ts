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
 * Seed symptom evidence from the patient's free-text description by matching the model's
 * symptom vocabulary (all underscore-separated tokens of a symptom id must appear).
 */
export async function extractInitialFindings(symptoms: string): Promise<Record<string, number>> {
  const text = ` ${symptoms.toLowerCase()} `;
  const syms = await getSymptoms();
  const evidence: Record<string, number> = {};
  for (const s of syms) {
    const tokens = s.id.split('_').filter((t) => t.length > 2);
    if (tokens.length > 0 && tokens.every((t) => text.includes(t))) {
      evidence[s.id] = 1;
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
