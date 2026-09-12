/**
 * Patient/doctor-facing names for triage conditions.
 *
 * The model's class labels come straight from the DDXPlus dataset, which ships a
 * handful of misspellings ("Larygospasm"). The dataset spelling is the key the
 * model and `ddxplus_taxonomy.py` match on, so it must not be renamed at the
 * source — correct it only where it is shown to a human.
 */
const DISPLAY_NAMES: Record<string, string> = {
  Larygospasm: 'Laryngospasm',
};

export function conditionDisplayName(name?: string): string {
  if (!name) return '';
  return DISPLAY_NAMES[name] ?? name;
}

/**
 * What the patient actually said yes to, for the doctor's pre-visit summary.
 *
 * The triage model's symptom ids are DDXPlus evidence codes ("E_91"), so rendering the
 * id showed doctors chips like "E 91". Each finding also carries the exact question
 * the patient answered, and that is shown verbatim — deliberately NOT rewritten into a
 * short label. A rewrite works for "Do you have a fever?" but a third of the model's
 * 318 questions are qualifiers ("Did the pain come on suddenly?", "Is the affected
 * area on your chest?"), and paraphrasing a patient's clinical answers is where
 * meaning quietly changes.
 *
 * Older summaries from the previous model use readable ids ("high_fever") with no
 * separate question, so those fall back to the humanised id.
 */
export function findingText(finding: { id: string; question?: string }): string {
  if (finding.question && finding.question !== finding.id) return finding.question;
  const words = finding.id.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
