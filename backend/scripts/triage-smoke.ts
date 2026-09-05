/**
 * End-to-end smoke test for free-text triage.
 *
 * Feeds realistic patient complaints through the same path the API uses
 * (extractInitialFindings -> triageEngine.step) and prints what the patient
 * would actually see: the seeded evidence, the first questions asked, and the
 * specialist recommended.
 *
 * This is the check that matters after a model swap: the model can be accurate
 * in batch and still ask irrelevant questions if free-text seeding is broken.
 *
 * Run:  npx tsx scripts/triage-smoke.ts
 */
import { extractInitialFindings } from '../src/services/TriageService';
import { triageEngine } from '../src/services/triageEngine';

const COMPLAINTS = [
  'I have a bad cough and a fever for three days, and I feel short of breath',
  'crushing chest pain spreading to my left arm, sweating and feel sick',
  'severe headache, light hurts my eyes and my neck is stiff',
  'burning in my chest after eating, bitter taste in my mouth',
  'my heart is racing and I feel like I am going to die',
  'sore throat, runny nose, sneezing since yesterday',
  'sudden stomach pain in my lower right side, no appetite, feel nauseous',
  'wheezing and cannot breathe properly, worse at night',
  // conditions DDXPlus has no label for — these are what the legacy bridge exists for
  'it burns when I pee and I am going to the toilet constantly',
  'severe pain in my back and side, blood in my urine, vomiting',
  'high fever, terrible headache behind my eyes, joint pain and a rash',
];

const MAX_SHOW = 4;

async function run(text: string) {
  console.log('\n' + '='.repeat(78));
  console.log(`PATIENT: "${text}"`);

  const evidence = await extractInitialFindings(text);
  const seeded = Object.keys(evidence);
  console.log(`\n  seeded ${seeded.length} findings:`);
  for (const id of seeded) {
    const q = triageEngine.getSymptoms().find((s) => s.id === id)?.question ?? id;
    console.log(`    ${id.padEnd(14)} ${q}`);
  }
  if (seeded.length === 0) {
    console.log('    (none — free-text seeding produced nothing)');
  }

  // walk the first few questions the engine would ask
  const working: Record<string, number> = { ...evidence };
  console.log('\n  next questions the engine asks:');
  for (let i = 0; i < MAX_SHOW; i++) {
    const step = triageEngine.step(working);
    if (step.done || !step.nextQuestion) {
      console.log(`    (stops after ${i} more — done)`);
      break;
    }
    const { symptom, question, infoGain } = step.nextQuestion;
    console.log(`    ${i + 1}. [${infoGain.toFixed(2)} bits] ${question}`);
    working[symptom] = 0; // assume "no" so we see a spread of questions
  }

  const final = triageEngine.step(working);
  console.log('\n  top conditions:');
  for (const c of final.posterior.slice(0, 3)) {
    console.log(
      `    ${(c.prob * 100).toFixed(1).padStart(5)}%  ${c.disease.padEnd(34)} ` +
        `${c.specialization}  [${c.urgency}]`
    );
  }
  console.log(`  -> recommend: ${final.recommendedSpecializations.join(', ')}`);
  console.log(`  -> urgency:   ${final.urgency}`);
}

(async () => {
  const meta = triageEngine.meta();
  console.log(
    `model: ${meta.diseases?.length ?? '?'} conditions, ` +
      `${meta.symptoms?.length ?? '?'} features` +
      (meta.metrics?.dataset ? ` (${meta.metrics.dataset.dataset})` : '')
  );
  for (const c of COMPLAINTS) {
    await run(c);
  }
  console.log('\n' + '='.repeat(78));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
