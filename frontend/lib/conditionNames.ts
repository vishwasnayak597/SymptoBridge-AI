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
