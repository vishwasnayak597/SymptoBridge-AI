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

/**
 * Fire-and-forget wake-up for the ML service. Called on login so the model is
 * warming while the patient navigates to the triage wizard — on the free tier a
 * cold ML service takes ~30s to answer its first request. Best-effort: errors are
 * swallowed and it never blocks the caller. The AbortSignal caps the dangling
 * request so a down ML service can't leave the socket hanging indefinitely.
 */
export function warmUpMlService(): void {
  fetch(`${ML_SERVICE_URL}/health`, { signal: AbortSignal.timeout(30000) }).catch(() => {});
}

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Call the ML microservice, tolerating free-tier cold starts.
 *
 * On Render's free tier the ML service spins down after inactivity and takes
 * ~30-50s to answer its first request; while it wakes, the router returns
 * 502/503/504 or the socket times out. A single attempt therefore failed with
 * "service unavailable" the first time a patient triaged after an idle period.
 * We retry on those transient conditions with backoff so the request rides out
 * the cold start instead of surfacing an error. Each attempt is capped by an
 * AbortSignal so a truly dead service can't hang the socket indefinitely.
 */
async function mlFetch(path: string, body?: unknown): Promise<any> {
  const RETRIABLE = new Set([502, 503, 504]);
  // Render's router usually returns 502 *quickly* while a spun-down service boots,
  // rather than holding the connection — so a cold start looks like a burst of fast
  // 502s for ~30-50s, not one long hang. These backoffs keep retrying across that
  // whole window (~55s of waiting) so the request rides out the boot instead of
  // giving up early. The generous per-attempt timeout below also covers the rarer
  // "router holds the connection until awake" case. Total budget stays under the
  // frontend's 90s request timeout for triage calls.
  const backoffs = [1000, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 12000];
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    try {
      const res = await fetch(`${ML_SERVICE_URL}${path}`, {
        ...(body !== undefined
          ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        if (RETRIABLE.has(res.status) && attempt < backoffs.length) {
          await sleep(backoffs[attempt]);
          continue;
        }
        throw new Error(`ML service ${path} responded ${res.status}`);
      }
      return res.json();
    } catch (err: any) {
      // Network error / timeout while the service is waking — retry until we run out.
      lastError = err instanceof Error ? err : new Error(String(err));
      const isAbort = err?.name === 'AbortError' || err?.name === 'TimeoutError';
      const isNetwork = err?.name === 'TypeError' || isAbort;
      if (isNetwork && attempt < backoffs.length) {
        await sleep(backoffs[attempt]);
        continue;
      }
      throw lastError;
    }
  }
  throw lastError ?? new Error(`ML service ${path} unreachable`);
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
