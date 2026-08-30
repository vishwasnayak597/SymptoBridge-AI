/**
 * Triage service.
 *
 * The trained probabilistic model runs IN-PROCESS via `triageEngine` (a TS port
 * of the former Python ML microservice). This layer only seeds initial symptom
 * evidence from the patient's free text and shapes responses — the engine does
 * the actual Naive Bayes inference. The LLM is intentionally NOT the diagnostician;
 * it could later replace `extractInitialFindings` as a nicer parser.
 *
 * History: triage inference used to live in a separate Python service reached over
 * HTTP, which cold-started for ~30-50s on the free tier. Inference is just
 * arithmetic over the exported model params, so it was folded into the API — no
 * network hop, no cold start, one fewer service to run.
 */

import { triageEngine, TriageCondition, TriageStep, TriageSummary } from './triageEngine';
import { semanticMatch } from './semanticMatcher';

export type { TriageCondition, TriageStep, TriageSummary };

/**
 * Build the structured pre-visit summary attached to a triage-driven booking, so
 * the doctor sees the AI's reasoning (differential, urgency, driving symptoms)
 * before the consult. Pure function of the final evidence.
 */
export function buildTriageSummary(chiefComplaint: string, evidence: Record<string, number>): TriageSummary {
  return triageEngine.summarize(chiefComplaint, evidence);
}

/**
 * No-op kept for backwards compatibility.
 *
 * Triage now runs in-process, so there is no separate ML service to wake. The
 * login route still calls this; keeping it as a harmless no-op avoids touching
 * every caller.
 */
export function warmUpMlService(): void {
  /* triage is in-process now — nothing to warm */
}

export async function getTriageMeta(): Promise<any> {
  return triageEngine.meta();
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
 * Three passes: (1) match the model's symptom vocabulary where every underscore-separated
 * token of a symptom id appears in the text; (2) apply a curated synonym map for lay
 * phrasings the token match would miss; (3) semantic (embedding) matching for paraphrases
 * neither of the above catches. The first two are high-precision and always run; the third
 * boosts recall and degrades to a no-op when the embeddings API is unavailable. Only
 * symptoms the model actually knows are kept.
 */
export async function extractInitialFindings(symptoms: string): Promise<Record<string, number>> {
  const text = ` ${symptoms.toLowerCase()} `;
  const syms = triageEngine.getSymptoms();
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

  // Recall boost — safe: semanticMatch swallows its own errors and returns {} when
  // disabled, so this only ever ADDS confirmed symptoms, never breaks extraction.
  const semantic = await semanticMatch(symptoms);
  for (const [id, val] of Object.entries(semantic)) {
    if (known.has(id) && !(id in evidence)) evidence[id] = val;
  }

  return evidence;
}

export async function startTriage(
  symptoms: string
): Promise<TriageStep & { evidence: Record<string, number> }> {
  const evidence = await extractInitialFindings(symptoms);
  const step = triageEngine.step(evidence);
  return { ...step, evidence };
}

export async function answerTriage(
  evidence: Record<string, number>,
  skip: string[] = []
): Promise<TriageStep> {
  return triageEngine.step(evidence, skip);
}
