/**
 * Regression tests for free-text symptom seeding.
 *
 * These patterns are the only thing standing between a patient's words and the
 * model's evidence vector, and their failures are SILENT: a pattern that misses
 * produces an empty differential rather than an error, and a pattern that
 * over-matches feeds the Bayesian model evidence the patient never gave. Both
 * bugs shipped at least once:
 *
 *   - \bhurt\b never matched "hurts" and \bache\b never matched "headache", so
 *     "severe headache" seeded nothing at all.
 *   - unanchored /shin/ matched "cru(shin)g", so "crushing chest pain" seeded
 *     leg pain.
 */
import { LAY_PHRASES, PAIN_REGIONS, PAIN_MODIFIERS, isOpaqueEvidenceId } from '../services/triageSynonyms';

const pad = (s: string) => ` ${s.toLowerCase()} `;

function seed(text: string): Set<string> {
  const t = pad(text);
  const out = new Set<string>();
  for (const [re, ids] of LAY_PHRASES) if (re.test(t)) ids.forEach((i) => out.add(i));
  if (out.has('E_53')) {
    for (const [re, id] of PAIN_REGIONS) if (re.test(t)) out.add(id);
    for (const [re, id] of PAIN_MODIFIERS) if (re.test(t)) out.add(id);
  }
  return out;
}

describe('lay-phrase seeding', () => {
  it('matches inflected forms of pain words', () => {
    for (const phrase of ['my chest hurts', 'headache', 'aching all over', 'backache', 'soreness in my throat']) {
      expect(seed(phrase).has('E_53')).toBe(true);
    }
  });

  it('does not match body parts inside unrelated words', () => {
    // "crushing" contains "shin"; "spreading" contains no region either.
    const s = seed('crushing chest pain spreading to my left arm');
    expect(s.has('E_55__chest')).toBe(true);
    expect(s.has('E_55__arm')).toBe(true);
    expect(s.has('E_55__leg')).toBe(false);
  });

  it('seeds the classic cardiac presentation', () => {
    const s = seed('crushing chest pain spreading to my left arm, sweating and feel sick');
    expect(s.has('E_53')).toBe(true);       // pain
    expect(s.has('E_55__chest')).toBe(true);
    expect(s.has('E_50')).toBe(true);       // sweating
    expect(s.has('E_148')).toBe(true);      // nausea
  });

  it('seeds respiratory complaints', () => {
    const s = seed('bad cough and a fever for three days, and I feel short of breath');
    expect(s.has('E_91')).toBe(true);   // fever
    expect(s.has('E_201')).toBe(true);  // cough
    expect(s.has('E_66')).toBe(true);   // shortness of breath
  });

  it('seeds reflux without seeding cardiac chest pain', () => {
    const s = seed('burning in my chest after eating, bitter taste in my mouth');
    expect(s.has('E_173')).toBe(true);  // reflux
    expect(s.has('E_14')).toBe(false);  // NOT "chest pain at rest"
  });

  it('picks up severity and onset only alongside pain', () => {
    expect(seed('severe headache').has('E_56__2')).toBe(true);
    expect(seed('sudden stomach pain').has('E_59__2')).toBe(true);
    // no pain reported -> no severity/onset evidence invented
    expect(seed('severe cough').has('E_56__2')).toBe(false);
  });

  it('never seeds pain radiation from a site mention', () => {
    // E_57 is "does the pain RADIATE to X" — a question the patient has not answered.
    for (const text of ['chest pain', 'pain in my arm', 'headache']) {
      for (const id of seed(text)) {
        expect(id.startsWith('E_57')).toBe(false);
      }
    }
  });

  // The L_* features exist precisely because DDXPlus cannot represent these
  // conditions. If their patterns silently stop matching, the model has no route to
  // UTI / kidney stone / appendicitis / dengue at all — and (as measured) confidently
  // misroutes them instead, e.g. appendicitis -> Cardiology.
  it('seeds urinary findings that DDXPlus has no evidence for', () => {
    const s = seed('it burns when I pee and I am going to the toilet constantly');
    expect(s.has('L_burning_urination')).toBe(true);
    expect(s.has('L_frequent_urination')).toBe(true);
  });

  it('seeds haematuria from lay phrasing', () => {
    expect(seed('blood in my urine').has('L_blood_in_urine')).toBe(true);
    expect(seed('my pee is pink').has('L_blood_in_urine')).toBe(true);
  });

  it('seeds the appendicitis localiser', () => {
    const s = seed('sudden stomach pain in my lower right side, no appetite');
    expect(s.has('L_lower_right_abdo_pain')).toBe(true);
    expect(s.has('E_55__abdomen')).toBe(true);
    expect(s.has('E_59__2')).toBe(true); // sudden onset
  });

  it('seeds the dengue-ish cluster', () => {
    const s = seed('high fever, terrible headache behind my eyes, joint pain and a rash');
    expect(s.has('L_high_fever')).toBe(true);
    expect(s.has('L_joint_pain')).toBe(true);
    expect(s.has('E_129')).toBe(true); // rash
    expect(s.has('E_91')).toBe(true);  // fever
  });

  it('seeds photophobia for migraine', () => {
    expect(seed('severe headache and light hurts my eyes').has('L_photophobia')).toBe(true);
  });

  it('recognises opaque DDXPlus ids', () => {
    expect(isOpaqueEvidenceId('E_91')).toBe(true);
    expect(isOpaqueEvidenceId('E_55__chest')).toBe(true);
    expect(isOpaqueEvidenceId('chest_pain')).toBe(false);
  });
});
