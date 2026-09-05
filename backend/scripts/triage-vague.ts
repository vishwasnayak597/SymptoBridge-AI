/**
 * Adversarial free-text test: what real patients actually type or say.
 *
 * scripts/triage-smoke.ts uses well-formed clinical sentences. Real input is vague,
 * short, misspelled, ungrammatical, or comes out of speech-to-text with filler words
 * and transcription errors. This checks the two failure modes that matter:
 *
 *   1. seeds NOTHING  -> the engine starts from a flat prior and flails
 *   2. seeds WRONGLY  -> the engine is confidently wrong from question one
 *
 * A vague complaint SHOULD produce more questions. That is the system working:
 * questions exist to resolve ambiguity. What must not happen is a confident answer
 * off ambiguous input.
 *
 * Run:  npx tsx scripts/triage-vague.ts
 */
import { extractInitialFindings } from '../src/services/TriageService';
import { triageEngine } from '../src/services/triageEngine';

const CASES: Array<[string, string]> = [
  ['vague, two sites', 'I have chest pain and back pain'],
  ['very short', 'stomach hurts'],
  ['no content', 'not feeling well'],
  ['one word', 'pain'],
  ['typos', 'chst pian and cough sinse 3 days'],
  ['non-clinical', 'my heart feels funny and I go dizzy when I stand'],
  ['speech-to-text', 'um so i have like a pain in my chest and also my back hurts a bit'],
  ['run-on', 'fever cough tired no appetite headache everything hurts'],
  ['hinglish', 'mujhe chest mein dard hai and saans lene mein problem'],
  ['emotional', 'something is really wrong please help me'],
];

const MAX_Q = 8;

async function run(label: string, text: string) {
  const evidence = await extractInitialFindings(text);
  const seeded = Object.keys(evidence);

  // walk the full session, answering "no" to everything asked (worst case: the
  // engine gets no new positive information and must rely on what it started with)
  const working: Record<string, number> = { ...evidence };
  let asked = 0;
  for (let i = 0; i < MAX_Q; i++) {
    const step = triageEngine.step(working);
    if (step.done || !step.nextQuestion) break;
    working[step.nextQuestion.symptom] = 0;
    asked++;
  }
  const final = triageEngine.step(working);
  const top = final.posterior[0];

  console.log(
    `\n${label.padEnd(16)} "${text}"\n` +
      `  seeded ${String(seeded.length).padStart(2)} findings` +
      `   asks ${asked} questions` +
      `   -> ${top ? `${(top.prob * 100).toFixed(0)}% ${top.disease}` : 'nothing'}` +
      `  [${final.urgency}]  ${final.recommendedSpecializations[0] ?? '-'}` +
      `${final.lowConfidence ? '  <<< NOT SURE' : ''}`
  );
  if (seeded.length) {
    console.log(`  seeded: ${seeded.join(', ')}`);
  }
  if (seeded.length === 0) {
    console.log('  !! nothing seeded — engine starts from the flat prior');
  }
  if (seeded.length <= 2 && top && top.prob > 0.7) {
    console.log(`  !! CONFIDENT (${(top.prob * 100).toFixed(0)}%) on ${seeded.length} findings`);
  }
}

(async () => {
  const meta = triageEngine.meta();
  console.log(`model: ${meta.diseases?.length} conditions, ${meta.symptoms?.length} features`);
  console.log('(answering "no" to every question — worst case for the engine)');
  for (const [label, text] of CASES) await run(label, text);
  console.log();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
