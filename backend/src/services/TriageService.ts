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

import { triageEngine, TriageCondition, TriageStep } from './triageEngine';

export type { TriageCondition, TriageStep };

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
 * Two passes: (1) match the model's symptom vocabulary where every underscore-separated
 * token of a symptom id appears in the text; (2) apply a curated synonym map for lay
 * phrasings the token match would miss. Only symptoms the model actually knows are kept.
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
