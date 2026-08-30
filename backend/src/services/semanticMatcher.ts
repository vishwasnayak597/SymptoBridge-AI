/**
 * Semantic symptom matching (embeddings).
 *
 * Upgrades the free-text -> symptom-id extraction beyond exact/regex matching:
 * the patient's wording is embedded and compared (cosine similarity) against the
 * model's symptom vocabulary, so paraphrases the regex can't catch ("stings when
 * I go to the toilet" -> burning_urination) still resolve.
 *
 * Design for this project's constraints:
 *  - Uses the Gemini embeddings API (already a dependency) — no heavy in-process
 *    model, negligible memory.
 *  - Symptom vectors are embedded ONCE (lazily, one batch call) and cached.
 *  - Fully degrade-safe: with no GEMINI_API_KEY, or on ANY error/timeout, it
 *    returns {} and the caller falls back to the existing regex extraction, so a
 *    triage request can never fail because of this.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { triageEngine } from './triageEngine';
import logger from '../utils/logger';

const KEY = process.env.GEMINI_API_KEY;
const EMBED_MODEL = 'text-embedding-004';
const THRESHOLD = 0.75; // cosine cutoff — conservative (precision) since it feeds a medical model; tune with real queries
const MAX_ADDED = 4; // never flood the evidence with weak matches
const CALL_TIMEOUT_MS = 6000;

let genAI: GoogleGenerativeAI | null = null;
let symptomVecs: Array<{ id: string; vec: number[]; norm: number }> | null = null;
let initPromise: Promise<void> | null = null;
let warned = false;

function client(): GoogleGenerativeAI | null {
  if (!KEY) return null;
  if (!genAI) genAI = new GoogleGenerativeAI(KEY);
  return genAI;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('embed timeout')), ms)),
  ]);
}

const norm = (v: number[]): number => {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s) || 1;
};
const dot = (a: number[], b: number[]): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

async function embedBatch(texts: string[]): Promise<number[][]> {
  const g = client();
  if (!g) throw new Error('no GEMINI_API_KEY');
  const model = g.getGenerativeModel({ model: EMBED_MODEL });
  const res = await withTimeout(
    model.batchEmbedContents({
      requests: texts.map((t) => ({ content: { role: 'user', parts: [{ text: t }] } })),
    }),
    CALL_TIMEOUT_MS
  );
  return res.embeddings.map((e) => e.values as number[]);
}

/** Embed the 44 symptom descriptions once and cache them. */
async function ensureSymptomVecs(): Promise<void> {
  if (symptomVecs) return;
  if (!initPromise) {
    initPromise = (async () => {
      const syms = triageEngine.getSymptoms();
      // A short natural description per symptom: the human name + the triage question.
      const descs = syms.map((s) => `${s.id.replace(/_/g, ' ')}. ${s.question}`);
      const vecs = await embedBatch(descs);
      symptomVecs = syms.map((s, i) => ({ id: s.id, vec: vecs[i], norm: norm(vecs[i]) }));
    })().catch((e) => {
      initPromise = null; // allow a later retry
      throw e;
    });
  }
  return initPromise;
}

/**
 * Return symptom ids semantically present in `text` (as {id: 1}). Empty when the
 * feature is disabled or anything goes wrong — the caller keeps its regex result.
 */
export async function semanticMatch(text: string): Promise<Record<string, number>> {
  if (!client()) {
    if (!warned) {
      warned = true;
      logger.info('GEMINI_API_KEY not set — semantic symptom matching disabled (regex extraction only)');
    }
    return {};
  }
  try {
    await ensureSymptomVecs();
    if (!symptomVecs) return {};

    // Split into phrases so a multi-symptom description keeps per-symptom signal
    // (one averaged vector for the whole text would blur distinct complaints).
    const phrases = text
      .split(/[.,;\n]| and | with | also | plus /i)
      .map((s) => s.trim())
      .filter((s) => s.length > 2);
    const chunks = phrases.length ? phrases : [text.trim()];

    const qVecs = await embedBatch(chunks);
    const qNorms = qVecs.map(norm);

    const scored: Array<{ id: string; score: number }> = [];
    for (const sv of symptomVecs) {
      let best = 0;
      for (let i = 0; i < qVecs.length; i++) {
        const cos = dot(sv.vec, qVecs[i]) / (sv.norm * qNorms[i]);
        if (cos > best) best = cos;
      }
      if (best >= THRESHOLD) scored.push({ id: sv.id, score: best });
    }
    scored.sort((a, b) => b.score - a.score);

    const out: Record<string, number> = {};
    for (const s of scored.slice(0, MAX_ADDED)) out[s.id] = 1;
    return out;
  } catch (e: any) {
    logger.warn(`semantic symptom matching failed, using regex only: ${e?.message || e}`);
    return {};
  }
}
