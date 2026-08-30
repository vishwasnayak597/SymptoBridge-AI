/**
 * Live-caption translation for video consultations.
 *
 * Translates a spoken sentence into the recipient's language via Gemini so the
 * doctor and patient can speak different languages during the call. Fully
 * degrade-safe: with no GEMINI_API_KEY, or on any error/timeout, it returns the
 * ORIGINAL text so captions still appear (just untranslated) and the call is
 * never affected.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import logger from '../utils/logger';

const KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-1.5-flash-latest';
const CALL_TIMEOUT_MS = 6000;

// Supported caption languages (code -> human name for the prompt).
export const CAPTION_LANGS: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  kn: 'Kannada',
  ta: 'Tamil',
  te: 'Telugu',
  mr: 'Marathi',
  bn: 'Bengali',
};

let genAI: GoogleGenerativeAI | null = null;
let warned = false;

function client(): GoogleGenerativeAI | null {
  if (!KEY) return null;
  if (!genAI) genAI = new GoogleGenerativeAI(KEY);
  return genAI;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('translate timeout')), ms)),
  ]);
}

export async function translateText(text: string, targetLang: string): Promise<string> {
  const clean = (text || '').trim();
  if (!clean) return text;

  const g = client();
  if (!g) {
    if (!warned) {
      warned = true;
      logger.info('GEMINI_API_KEY not set — live captions are shown untranslated');
    }
    return text;
  }

  const langName = CAPTION_LANGS[targetLang] || targetLang;
  try {
    const model = g.getGenerativeModel({ model: MODEL });
    const prompt =
      `Translate the following sentence from a live doctor-patient medical consultation into ${langName}. ` +
      `Keep it natural and faithful. Return ONLY the translation, with no quotes or notes.\n\n${clean}`;
    const res = await withTimeout(model.generateContent(prompt), CALL_TIMEOUT_MS);
    const out = res.response.text().trim().replace(/^["']|["']$/g, '');
    return out || text;
  } catch (e: any) {
    logger.warn(`caption translation failed, sending original: ${e?.message || e}`);
    return text;
  }
}
