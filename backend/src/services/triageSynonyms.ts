/**
 * Lay-phrase -> DDXPlus evidence mapping.
 *
 * WHY THIS FILE EXISTS
 * The pre-DDXPlus model used self-describing symptom ids (`chest_pain`, `sore_throat`),
 * so free text could be matched by simply checking whether every token of the id
 * appeared in the patient's words. DDXPlus evidence codes are opaque (`E_91`,
 * `E_55__chest`), which breaks that trick completely — and worse, a naive token match
 * would fire `E_57__chest` ("does the pain RADIATE to your chest") on the word "chest",
 * seeding evidence the patient never gave. In a Bayesian model that is not a cosmetic
 * bug: fabricated evidence shifts the posterior.
 *
 * So free-text seeding now has two honest layers:
 *   1. this curated map  — high precision, covers the common presenting complaints
 *   2. semantic matching — recall for everything else (see semanticMatcher.ts)
 *
 * Patterns are matched against the lowercased complaint. Each entry may seed several
 * evidences: "severe chest pain" seeds "pain somewhere" + "pain in chest" + "severe".
 *
 * Evidence codes and their questions come from DDXPlus release_evidences.json
 * (CC BY 4.0 — see README). To look one up:
 *   cd ml-service && python -c "import json;e=json.load(open('data/ddxplus/release_evidences.json'));print(e['E_91']['question_en'])"
 */

/** [pattern, evidence codes to set to 1] */
export const LAY_PHRASES: Array<[RegExp, string[]]> = [
  // ---- constitutional ----
  [/\bfever|temperature|feverish|pyrexia|hot and cold\b/, ['E_91']],
  [/\bchills?|shivers?|shivering|rigors?\b/, ['E_94']],
  [/\bsweat|perspir|night sweats?\b/, ['E_50']],
  [/\b(tired|fatigue|exhaust|worn out|no energy|lethargic)\b/, ['E_89']],
  [/\b(bedridden|can'?t get out of bed|stuck in bed|too weak to)\b/, ['E_88']],
  [/\b(lost|losing) weight|weight loss\b/, ['E_162', 'E_174']],
  [/\b(no|loss of|lost my) appetite|not hungry|can'?t eat\b/, ['E_32', 'E_161']],
  [/\b(pale|pallor|washed out|white as a sheet)\b/, ['E_154']],
  [/\bswollen glands|swollen lymph|lumps? in my neck\b/, ['E_9']],

  // ---- respiratory ----
  [/\bcough(ing)?\b/, ['E_201']],
  [/\b(phlegm|sputum|mucus|bringing up|productive cough|green|yellow) (cough|phlegm|mucus)?\b/, ['E_77']],
  [/\bcough(ing)? up blood|blood in my (phlegm|sputum)|haemoptysis|hemoptysis\b/, ['E_45']],
  [/\bcoughing fits?|fits of coughing|can'?t stop coughing\b/, ['E_203']],
  [/\bwhooping cough\b/, ['E_202']],
  [/\b(short(ness)? of breath|can'?t breathe|cannot breathe|breathless|out of breath|dyspn)\b/, ['E_66']],
  [/\b(breathless|puffed|out of breath) (with|on|after) (minimal|little|slight|walking|stairs)\b/, ['E_64']],
  [/\bwheez(e|ing|y)\b/, ['E_214']],
  [/\bnoisy breathing|whistling when i breathe\b/, ['E_112']],
  [/\bhigh[- ]pitched (sound|noise)|stridor\b/, ['E_194']],
  [/\bchok(e|ing)|suffocat|can'?t get air\b/, ['E_75']],
  [/\bwake up (gasping|breathless|choking)|can'?t breathe at night\b/, ['E_67']],
  [/\bstop breathing (while|when) (i'?m )?asleep|sleep apn(o|e)a\b/, ['E_23']],
  [/\b(runny|blocked|stuffy|congested|blocked[- ]up) nose|nasal congestion|sniffl/, ['E_181']],
  [/\b(green|yellow|coloured|colored) (snot|mucus|nasal|discharge)\b/, ['E_182']],
  [/\bitchy (nose|throat)|nose (is )?itch/, ['E_169']],
  [/\b(can'?t|cannot|lost my sense of) smell|no sense of smell|anosmia\b/, ['E_103']],
  [/\bsore throat|throat hurts|painful throat|scratchy throat\b/, ['E_97']],
  [/\b(hoarse|voice.{0,12}(gone|deeper|softer|croaky)|lost my voice)\b/, ['E_212']],
  [/\b(hard|difficult|trouble|painful) (to )?swallow|can'?t swallow|dysphagia\b/, ['E_65']],

  // ---- cardiac ----
  [/\b(palpitations?|heart (racing|pounding|fluttering)|racing heart)\b/, ['E_155']],
  [/\bheart(beat)? (is )?(irregular|skipping|missing a beat)|irregular (heart|pulse)\b/, ['E_164']],
  [/\bchest pain (even )?at rest|chest hurts when i'?m resting\b/, ['E_14', 'E_53']],
  [/\b(hurts?|pain|worse) (when|as) i breathe in|painful to breathe\b/, ['E_220']],
  [/\bworse (when|on) (exertion|exercise|walking|climbing)|better (when|with) rest\b/, ['E_218']],
  [/\b(better|improves?|relieved) (when i )?lean(ing)? forward\b/, ['E_33']],
  [/\bworse (when |while )?lying (down|flat)|better sitting up\b/, ['E_217']],

  // ---- GI ----
  [/\b(nausea|nauseous|feel sick|queasy|feel like (i'?m going to )?(be sick|vomit))\b/, ['E_148']],
  [/\b(vomit|throw(n|ing)? up|threw up|been sick|puking)\b/, ['E_211']],
  [/\bvomit(ed|ing)? blood|coffee grounds?|blood in my vomit\b/, ['E_210']],
  [/\b(diarrh|loose (stools?|motions?)|runny (stools?|tummy)|the runs)\b/, ['E_51']],
  [/\bblack (stools?|poo|motions?)|tarry stools?|melaena|melena\b/, ['E_140']],
  [/\bblood in (my )?(stool|poo|motions?)|bleeding from (my )?(back passage|bottom)\b/, ['E_179']],
  [/\b(heartburn|acid reflux|burning.{0,20}(chest|throat)|bitter taste|indigestion)\b/, ['E_173']],
  [/\b(bloat|distend|swollen (tummy|belly|stomach)|gassy)\b/, ['E_30']],
  [/\bworse after (eating|meals|food)|after i eat\b/, ['E_215']],
  [/\b(can'?t|unable to) (pass|open) (stool|motion|gas|wind)|not opened my bowels\b/, ['E_150']],
  [/\bpale stools?|dark urine\b/, ['E_188']],

  // ---- neuro ----
  [/\b(passed out|fainted|blacked out|lost consciousness|syncope)\b/, ['E_159']],
  [/\b(fit|seizure|convulsion|shaking uncontrollably)\b/, ['E_43']],
  [/\b(dizzy|light[- ]?headed|about to faint|room spinning|vertigo)\b/, ['E_82', 'E_76']],
  [/\b(confus|disorient|muddled|not making sense)\b/, ['E_39']],
  [/\bdouble vision|seeing double|diplopia\b/, ['E_52']],
  [/\b(numb|tingl|pins and needles|loss of sensation)\b/, ['E_177']],
  [/\bnumb.{0,20}(feet|toes)\b/, ['E_93']],
  [/\b(weak|weakness|paralys).{0,20}(arms?|legs?|limbs?)|can'?t lift my (arms?|legs?)\b/, ['E_84']],
  [/\b(face|facial).{0,15}(droop|weak|paralys)|one side of my face\b/, ['E_156']],
  [/\b(slur|hard to speak|can'?t (get my )?words|trouble speaking)\b/, ['E_63']],
  [/\b(droop|can'?t open).{0,12}eyelid|ptosis\b/, ['E_172']],
  [/\b(worse|weaker) (when|with) (tired|fatigue|use|exertion)\b/, ['E_90']],
  [/\bmuscle spasms?|twitch|cramping in my (face|neck)\b/, ['E_193']],
  [/\b(stiff neck|can'?t turn my (head|neck)|neck spasm)\b/, ['E_192']],

  // ---- skin / eyes / allergy ----
  [/\b(rash|hives|spots?|red patches?|skin (lesion|problem)|itchy skin|welts?)\b/, ['E_129']],
  [/\b(watery|streaming|running) eyes|eyes.{0,12}water/, ['E_127']],
  [/\bred eyes?|bloodshot\b/, ['E_74']],
  [/\bitchy eyes?|eyes.{0,10}itch/, ['E_170']],
  [/\b(allergic|allergy|ate something i'?m allergic|bee sting|peanut)\b/, ['E_42']],
  [/\b(swelling|swollen|puffy)\b/, ['E_151']],

  // ---- msk / general pain ----
  // Deliberately NOT \b-anchored: word boundaries here silently failed on the most
  // common phrasings — \bhurt\b misses "hurts", \bache\b misses "headache" and
  // "backache", \bsore\b misses "soreness". Since E_53 only asserts "pain somewhere",
  // over-matching is far cheaper than missing the patient's entire complaint.
  [/pain|hurt|ache|aching|sore|agony|tender|throbbing|stabbing|cramp/, ['E_53']],
  [/\b(all my muscles|muscle ache|body ache|aching all over|myalgia)\b/, ['E_144']],
  [/\b(worse|hurts?) (when|on|with) (i )?(mov|bend|stand|walk|turn)|on movement\b/, ['E_216']],
  [/\bworse (when|with) coughing|hurts when i cough|straining\b/, ['E_221']],
  [/\b(jaw|mouth).{0,15}(pain|lock|can'?t open)|can'?t open my mouth\b/, ['E_205', 'E_38']],
  [/\b(mouth ulcers?|sores? in my mouth)\b/, ['E_206']],

  // ---- psych ----
  [/\b(feel|felt) like i('?m| am| was)? (going to )?di(e|ying)|thought i was dying\b/, ['E_111']],
  [/\b(detached|unreal|not myself|outside my body|derealis|depersonalis)\b/, ['E_171']],
  [/\b(irritable|mood swings?|snapping at)\b/, ['E_114']],

  // ---- gynae ----
  [/\bvaginal discharge\b/, ['E_163']],
  [/\b(heavy|long) periods?|menorrhagia\b/, ['E_145']],

  // ---- timing ----
  [/\bworse at night|only at night|wakes me at night\b/, ['E_219']],

  // ---- legacy-bridge features (L_*) ----
  // DDXPlus has no evidence for these, but they are highly specific for the
  // conditions it cannot represent — burning urination for UTI, lower-right
  // abdominal pain for appendicitis. See ml-service/data/legacy_bridge.py.
  [/\b(high|very high) (fever|temperature)|39 ?(c|degrees)|10[23] ?(f|degrees)|burning up\b/, ['L_high_fever']],
  [/\bdry cough|tickly cough|cough.{0,20}(no|without) (phlegm|mucus)\b/, ['L_dry_cough']],
  [/sneez/, ['L_sneezing']],
  [/\blower (right|rhs)|right (lower|side).{0,18}(abdom|stomach|tummy|belly)|\briq\b|mcburney/, ['L_lower_right_abdo_pain']],
  [/light (hurts|bothers|is painful)|sensitive to light|photophob|bright light/, ['L_photophobia']],
  [/\bjoints?\b|arthriti/, ['L_joint_pain']],
  [/(can'?t|cannot|lost my sense of) taste|no sense of taste|food (has no|tastes of nothing)/, ['L_loss_of_taste']],
  [/(burn|sting|hurt)s? (when|as) i (pee|wee|urinat)|burning (when|on) urinat|painful urinat|dysuria/, ['L_burning_urination']],
  [/(pee|urinat|going to the (loo|toilet)|weeing).{0,24}(more often|a lot|constantly|frequent)|frequent urinat/, ['L_frequent_urination']],
  [/blood in (my )?(urine|pee|wee)|(urine|pee) (is |looks )?(red|pink|bloody)|haematuria|hematuria/, ['L_blood_in_urine']],
  [/\bstiff(ness)?\b/, ['L_stiffness']],
];

/**
 * Body-region phrases -> the "where is the pain" region features.
 * Only E_55 (pain SITE) is seeded here — never E_57 (pain RADIATION), which is a
 * different clinical question the patient has not been asked yet.
 */
// Anatomy terms are ANCHORED, unlike the pain verbs above. Short body-part words are
// substrings of common English: an unanchored /shin/ matches "cru(shin)g", so
// "crushing chest pain" seeded leg pain. Anchor anatomy; only the compound-forming
// terms ("head" in "headache", "abdom" in "abdominal") are allowed to run free.
export const PAIN_REGIONS: Array<[RegExp, string]> = [
  [/\bheads?\b|headache|forehead|migraine|\btemples?\b|skull|\bfaces?\b|\bjaws?\b|\btooth\b|\bteeth\b|\bears?\b|\beyes?\b/, 'E_55__head'],
  [/\bnecks?\b|\bthroats?\b/, 'E_55__neck'],
  [/\bchest\b|\bribs?\b|\bbreasts?\b|sternum/, 'E_55__chest'],
  [/stomach|\btummy\b|\bbelly\b|abdom|\bgut\b|epigastr|\bflanks?\b/, 'E_55__abdomen'],
  [/\bback\b|\bspine\b|lumbar/, 'E_55__back'],
  [/\bgroin\b|pelvi|\bhips?\b|buttock|genital|testicle|\bbladder\b/, 'E_55__pelvis'],
  [/\barms?\b|\bshoulders?\b|\belbows?\b|\bwrists?\b|\bhands?\b|\bfingers?\b/, 'E_55__arm'],
  [/\blegs?\b|\bthighs?\b|\bknees?\b|\bcalf\b|\bcalves\b|\bshins?\b|\bankles?\b|\bfoot\b|\bfeet\b|\btoes?\b/, 'E_55__leg'],
];

/** Severity and onset wording -> the binned ordinal features. */
export const PAIN_MODIFIERS: Array<[RegExp, string]> = [
  [/\b(severe|excruciating|unbearable|worst|agonis|agoniz|10\/10|terrible)\b/, 'E_56__2'],
  [/\b(moderate|quite bad|fairly bad|uncomfortable)\b/, 'E_56__1'],
  [/\b(mild|slight|a bit of|little bit of|niggl)\b/, 'E_56__0'],
  [/\b(sudden|suddenly|out of nowhere|all at once|instant|abrupt)\b/, 'E_59__2'],
  [/\b(gradual|slowly|over (the last |a )?(few )?(days|weeks)|creeping|came on slowly)\b/, 'E_59__0'],
];

/** True for opaque DDXPlus-style codes, where token matching on the id is unsafe. */
export function isOpaqueEvidenceId(id: string): boolean {
  return /^E_\d+/.test(id);
}
