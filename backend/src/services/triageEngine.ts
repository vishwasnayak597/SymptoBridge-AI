/**
 * In-process sequential-triage inference engine.
 *
 * A faithful TypeScript port of the Python `engine.py` that used to run as a
 * separate ML microservice. The model is still TRAINED offline in Python
 * (ml-service/train.py); only INFERENCE moved here — it is pure arithmetic over
 * the exported Naive Bayes parameters (see triageModel.ts), so it needs no Python
 * runtime, no network hop, and never cold-starts.
 *
 * Given partial symptom evidence it computes:
 *   - a posterior over diseases,
 *   - the expected information gain (bits) of each not-yet-asked symptom,
 *   - the single most informative next question,
 *   - stop / urgency decisions.
 *
 * Kept numerically identical to the Python version (same clamping, same
 * thresholds, same rounding) so triage results do not change.
 */

import { TRIAGE_MODEL } from './triageModel';

export interface TriageModelData {
  classes: string[];
  symptoms: string[];
  questions: Record<string, string>;
  disease_meta: Record<
    string,
    {
      specialization?: string;
      urgency?: string;
      /** ICD-10 code, present on DDXPlus-trained models. */
      icd10?: string | null;
      /** DDXPlus severity, 1 (most severe) .. 5. Not the same as `urgency`. */
      severity?: number | null;
      /** Which dataset contributed this condition ("knowledge.py" for legacy). */
      source?: string;
    }
  >;
  metrics: any;
  class_log_prior: number[];
  feature_log_prob: number[][]; // shape: [n_classes][n_symptoms], log P(symptom=1 | disease)
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
  /**
   * True when questioning finished without enough confidence to name a specialist.
   * The UI should say so rather than presenting the top condition as an answer.
   */
  lowConfidence: boolean;
  askedCount: number;
}

const EPS = 1e-6;
const MAX_QUESTIONS = 8;
const CONFIDENT_PROB = 0.7; // stop once the leading disease passes this
const URGENT_PROB = 0.45; // stop early if an urgent/high condition passes this
const URGENCY_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2, urgent: 3 };
/**
 * Minimum posterior for a condition of each urgency to raise the session's urgency.
 * Lower bar for worse outcomes: a 6% chance of a heart attack warrants escalation,
 * a 6% chance of a cold does not. Keep in sync with ml-service/engine.py.
 */
const URGENCY_THRESHOLD: Record<string, number> = {
  urgent: 0.05,
  high: 0.12,
  medium: 0.2,
  low: 0.3,
};
const DEFAULT_URGENCY_THRESHOLD = 0.15;
/**
 * Below this leading-condition probability the model does not know enough to name a
 * specialist. Measured separation: genuine answers land at 45-96%, while vague input
 * bottoms out at 15-17% and still produced a confident-looking recommendation.
 * Keep in sync with ml-service/engine.py.
 */
const MIN_CONFIDENCE_TO_NAME_SPECIALIST = 0.3;
const FALLBACK_SPECIALIZATION = 'General Medicine';
const TOP_N = 6;

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;

function entropy(p: number[]): number {
  let h = 0;
  for (const v of p) {
    if (v > 0) h -= v * Math.log2(v);
  }
  return h;
}

class TriageEngine {
  private classes: string[];
  private symptoms: string[];
  private questions: Record<string, string>;
  private diseaseMeta: Record<string, { specialization?: string; urgency?: string }>;
  private metrics: any;
  private symIdx: Map<string, number>;
  private logPrior: number[];
  private pPresent: number[][]; // [n_classes][n_symptoms], P(symptom=1 | disease), clamped

  constructor(model: TriageModelData) {
    this.classes = model.classes;
    this.symptoms = model.symptoms;
    this.questions = model.questions;
    this.diseaseMeta = model.disease_meta;
    this.metrics = model.metrics;

    this.symIdx = new Map(this.symptoms.map((s, i) => [s, i]));
    this.logPrior = model.class_log_prior.slice();
    // P(symptom = 1 | disease), clamped away from 0/1 for stable absence likelihoods.
    this.pPresent = model.feature_log_prob.map((row) =>
      row.map((lp) => Math.min(Math.max(Math.exp(lp), EPS), 1 - EPS))
    );
  }

  private cleanEvidence(evidence: Record<string, unknown>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(evidence || {})) {
      if (this.symIdx.has(k) && v !== null && v !== undefined) {
        out[k] = Number(v) === 1 ? 1 : 0;
      }
    }
    return out;
  }

  /** P(disease | observed symptoms) as a normalized vector aligned to this.classes. */
  private posterior(evidence: Record<string, number>): number[] {
    const logp = this.logPrior.slice();
    for (const [s, val] of Object.entries(evidence)) {
      const j = this.symIdx.get(s)!;
      for (let i = 0; i < this.classes.length; i++) {
        const col = this.pPresent[i][j];
        logp[i] += Math.log(val === 1 ? col : 1 - col);
      }
    }
    let max = -Infinity;
    for (const v of logp) if (v > max) max = v;
    let sum = 0;
    const post = logp.map((v) => {
      const e = Math.exp(v - max);
      sum += e;
      return e;
    });
    return post.map((v) => v / sum);
  }

  /** Expected reduction in entropy (bits) from observing `symptom` next. */
  private infoGain(post: number[], symptom: string): number {
    const j = this.symIdx.get(symptom)!;
    let pYes = 0;
    for (let i = 0; i < post.length; i++) pYes += post[i] * this.pPresent[i][j];
    const pNo = 1 - pYes;
    const hBefore = entropy(post);

    const yes: number[] = new Array(post.length);
    const no: number[] = new Array(post.length);
    let yesSum = 0;
    let noSum = 0;
    for (let i = 0; i < post.length; i++) {
      const col = this.pPresent[i][j];
      yes[i] = post[i] * col;
      no[i] = post[i] * (1 - col);
      yesSum += yes[i];
      noSum += no[i];
    }
    const yesN = yesSum > 0 ? yes.map((v) => v / yesSum) : yes;
    const noN = noSum > 0 ? no.map((v) => v / noSum) : no;
    const hAfter = pYes * entropy(yesN) + pNo * entropy(noN);
    return Math.max(0, hBefore - hAfter);
  }

  /** Most informative symptom not already answered or skipped, as [symptom, infoGain]. */
  private nextQuestion(
    evidence: Record<string, number>,
    skip: Set<string>
  ): [string | null, number] {
    const post = this.posterior(evidence);
    let bestSym: string | null = null;
    let bestGain = -1;
    for (const s of this.symptoms) {
      if (s in evidence || skip.has(s)) continue;
      const g = this.infoGain(post, s);
      if (g > bestGain) {
        bestSym = s;
        bestGain = g;
      }
    }
    return [bestSym, Math.max(0, bestGain)];
  }

  private topConditions(post: number[], n = TOP_N): TriageCondition[] {
    // Highest probability first; ties broken by ascending class index to match
    // the reference numpy `argsort(post)[::-1]` ordering of equal-probability diseases.
    const order = post
      .map((prob, i) => ({ prob, i }))
      .sort((a, b) => (b.prob === a.prob ? a.i - b.i : b.prob - a.prob))
      .slice(0, n);
    return order.map(({ prob, i }) => {
      const name = this.classes[i];
      const meta = this.diseaseMeta[name] || {};
      return {
        disease: name,
        prob: round4(prob),
        specialization: meta.specialization || 'General Medicine',
        urgency: meta.urgency || 'medium',
      };
    });
  }

  private overallUrgency(top: TriageCondition[]): string {
    let worst = 'low';
    for (const c of top) {
      const threshold = URGENCY_THRESHOLD[c.urgency] ?? DEFAULT_URGENCY_THRESHOLD;
      if (c.prob >= threshold && URGENCY_ORDER[c.urgency] > URGENCY_ORDER[worst]) {
        worst = c.urgency;
      }
    }
    return worst;
  }

  private shouldStop(asked: number, top: TriageCondition[]): boolean {
    if (asked >= MAX_QUESTIONS) return true;
    if (top.length > 0 && top[0].prob >= CONFIDENT_PROB) return true;
    for (const c of top) {
      if (URGENCY_ORDER[c.urgency] >= URGENCY_ORDER['high'] && c.prob >= URGENT_PROB) return true;
    }
    return false;
  }

  /** One triage step: posterior + next question + stop/urgency + recommendations. */
  step(evidenceRaw: Record<string, unknown>, skipRaw: string[] = []): TriageStep {
    const evidence = this.cleanEvidence(evidenceRaw);
    const skip = new Set<string>(
      (skipRaw || []).filter((s) => this.symIdx.has(s) && !(s in evidence))
    );
    const post = this.posterior(evidence);
    const top = this.topConditions(post);
    const asked = Object.keys(evidence).length + skip.size;
    let done = this.shouldStop(asked, top);
    let sym: string | null = null;
    let gain = 0;
    if (!done) {
      [sym, gain] = this.nextQuestion(evidence, skip);
    }
    if (sym === null) done = true;

    let specs: string[] = [];
    for (const c of top) {
      if (!specs.includes(c.specialization)) specs.push(c.specialization);
    }

    // Refuse to name a specialist we are not confident about. Vague free text
    // ("not feeling well", "pain") seeds little or nothing, leaving a near-flat
    // posterior — which previously still produced a specific specialty at ~17%
    // confidence. A wrong specialist costs the patient a fee and a week, so below
    // the threshold we say so and route to a GP who can examine them.
    // Only applies once questioning is finished; a flat posterior mid-session is normal.
    const lowConfidence =
      done && (top.length === 0 || top[0].prob < MIN_CONFIDENCE_TO_NAME_SPECIALIST);
    if (lowConfidence) specs = [FALLBACK_SPECIALIZATION];

    return {
      posterior: top,
      nextQuestion:
        done || sym === null
          ? null
          : { symptom: sym, question: this.questions[sym] || sym, infoGain: round4(gain) },
      done,
      urgency: this.overallUrgency(top),
      recommendedSpecializations: specs.slice(0, 3),
      lowConfidence,
      askedCount: asked,
    };
  }

  /** UI "model card" payload — mirrors the old GET /meta response. */
  meta() {
    return {
      symptoms: this.symptoms.map((s) => ({ id: s, question: this.questions[s] || s })),
      diseases: this.classes.map((c) => ({ name: c, ...(this.diseaseMeta[c] || {}) })),
      metrics: this.metrics,
    };
  }

  getSymptoms(): Array<{ id: string; question: string }> {
    return this.symptoms.map((s) => ({ id: s, question: this.questions[s] || s }));
  }

  /**
   * Structured pre-visit summary for the clinical handoff — what the doctor sees
   * before the consult. Built from the final evidence so it captures the model's
   * reasoning: the differential, its urgency, and the symptoms that drove it.
   */
  summarize(chiefComplaint: string, evidenceRaw: Record<string, unknown>): TriageSummary {
    const evidence = this.cleanEvidence(evidenceRaw);
    const post = this.posterior(evidence);
    const conditions = this.topConditions(post);
    const specs: string[] = [];
    for (const c of conditions) {
      if (!specs.includes(c.specialization)) specs.push(c.specialization);
    }
    const drivingSymptoms = Object.keys(evidence)
      .filter((s) => evidence[s] === 1)
      .map((id) => ({ id, question: this.questions[id] || id }));

    return {
      chiefComplaint,
      conditions,
      urgency: this.overallUrgency(conditions),
      drivingSymptoms,
      recommendedSpecializations: specs.slice(0, 3),
      askedCount: Object.keys(evidence).length,
      generatedAt: new Date().toISOString(),
    };
  }
}

export interface TriageSummary {
  chiefComplaint: string;
  conditions: TriageCondition[];
  urgency: string;
  drivingSymptoms: Array<{ id: string; question: string }>;
  recommendedSpecializations: string[];
  askedCount: number;
  generatedAt: string;
}

// Single shared instance built from the exported model.
export const triageEngine = new TriageEngine(TRIAGE_MODEL);
