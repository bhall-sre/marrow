/**
 * MARROW's constants, all traceable to MARROW.md.
 * Nothing here is a magic number without a section reference.
 */
export const MARROW = {};

MARROW.id = 'marrow';

/* -------------------------------------------------------------------------- */
/*  VIII.1 THE THREE ARMORS                                                    */
/* -------------------------------------------------------------------------- */

/** Armour kinds and the AP band each occupies. */
MARROW.armorKinds = {
  soft:  { label: 'Soft',  min: 0, max: 4 },
  mail:  { label: 'Mail',  min: 5, max: 7 },
  plate: { label: 'Plate', min: 8, max: 10 },
};

/**
 * Every armour in VIII.3 sits inside the band VIII.1 gives its kind, so kind is
 * recoverable from AP alone when an item does not declare one.
 */
MARROW.armorKindForAP = function (ap) {
  const n = Number(ap ?? 0);
  if (n >= MARROW.armorKinds.plate.min) return 'plate';
  if (n >= MARROW.armorKinds.mail.min) return 'mail';
  return 'soft';
};

/* -------------------------------------------------------------------------- */
/*  XIII WOUNDS / VIII.2 damage types                                          */
/* -------------------------------------------------------------------------- */

/** The five Wound columns. A weapon's wound type names its column and its matchup. */
MARROW.damageTypes = {
  bluntForce: { label: 'Blunt Force',    attack: 'crushing' },
  bleeding:   { label: 'Bleeding',       attack: 'cutting' },
  piercing:   { label: 'Piercing',       attack: 'piercing' },
  fireBlast:  { label: 'Fire & Blast',   attack: null },  // "ignores all of this"
  goreMassive:{ label: 'Gore & Massive', attack: 'cutting' },
};

/**
 * VIII.1: "Crushing beats Plate, Piercing beats Mail, Cutting beats Soft, and each is
 * poor against one other." Resolves to a single Advantage or Disadvantage on the Combat
 * Check -- never to damage.
 */
MARROW.matchup = {
  crushing: { beats: 'plate', losesTo: 'soft' },
  piercing: { beats: 'mail',  losesTo: 'plate' },
  cutting:  { beats: 'soft',  losesTo: 'mail' },
};

/**
 * @returns {'advantage'|'disadvantage'|null} for a damage type against an armour kind.
 */
MARROW.matchupFor = function (damageType, armorKind) {
  const attack = MARROW.damageTypes[damageType]?.attack;
  if (!attack || !armorKind) return null;               // Fire & Blast ignores the matchup
  const m = MARROW.matchup[attack];
  if (m.beats === armorKind) return 'advantage';
  if (m.losesTo === armorKind) return 'disadvantage';
  return null;
};

/* -------------------------------------------------------------------------- */
/*  III SKILLS                                                                 */
/* -------------------------------------------------------------------------- */

/** III: Trained +10, Expert +15, Master +20. */
MARROW.skillRanks = {
  trained: { label: 'Trained', bonus: 10 },
  expert:  { label: 'Expert',  bonus: 15 },
  master:  { label: 'Master',  bonus: 20 },
};

/* -------------------------------------------------------------------------- */
/*  XVII WORKINGS                                                              */
/* -------------------------------------------------------------------------- */

/**
 * XVII.1's cost ladder. The Working always happens; the Sanity Save decides only what it
 * takes out of you.
 */
MARROW.workingOutcomes = {
  criticalSuccess: { stress: 0, blight: null, panic: false },
  success:         { stress: 1, blight: null, panic: false },
  failure:         { stress: 1, blight: 1,    panic: false },
  criticalFailure: { stress: 0, blight: '1d5', panic: true },
};

/* -------------------------------------------------------------------------- */
/*  XVI.3 GAINING BLIGHT                                                       */
/* -------------------------------------------------------------------------- */

/** Ground types and how often they ask for a Body Save at Disadvantage. */
MARROW.groundTypes = {
  tainted: { label: 'Tainted', interval: 'day' },
  steeped: { label: 'Steeped', interval: 'hour' },
  quick:   { label: 'Quick',   interval: 'round' },
};

/* -------------------------------------------------------------------------- */
/*  XIV RANGE                                                                  */
/* -------------------------------------------------------------------------- */

MARROW.ranges = {
  adjacent: 'Adjacent',
  close: 'Close',
  long: 'Long',
  extreme: 'Extreme',
};

/* -------------------------------------------------------------------------- */
/*  XII.6 COVER                                                                */
/* -------------------------------------------------------------------------- */

MARROW.cover = {
  none:          { label: 'No Cover',      ap: 0,  dr: 0 },
  insignificant: { label: 'Insignificant', ap: 5,  dr: 0 },
  light:         { label: 'Light',         ap: 10, dr: 0 },
  heavy:         { label: 'Heavy',         ap: 20, dr: 5 },
};

/** Table keys the system rolls on its own behalf, resolved through settings. */
MARROW.tables = {
  panic: 'Panic',
  death: 'Death',
  marks: 'Marks of the Blight',
  wounds: {
    bluntForce: 'Wounds: Blunt Force',
    bleeding: 'Wounds: Bleeding',
    piercing: 'Wounds: Piercing',
    fireBlast: 'Wounds: Fire & Blast',
    goreMassive: 'Wounds: Gore & Massive',
  },
};

/* -------------------------------------------------------------------------- */
/*  Sheet groupings                                                            */
/* -------------------------------------------------------------------------- */

/**
 * IX gear, XVIII.2 treatments, VI trinkets and VII crests are one Item type wearing four
 * faces. The sheet uses this to decide the sections and their order.
 */
MARROW.gearCategories = {
  gear:      'MARROW.Category.Gear',
  treatment: 'MARROW.Category.Treatment',
  trinket:   'MARROW.Category.Trinket',
  crest:     'MARROW.Category.Crest',
};

/** VIII.2's weapon tags, in the order they read best on a sheet. */
MARROW.weaponTags = [
  { key: 'antiArmor',  label: 'MARROW.Tag.AntiArmor',  hint: 'MARROW.Tag.AntiArmorHint' },
  { key: 'reload',     label: 'MARROW.Tag.Reload',     hint: 'MARROW.Tag.ReloadHint' },
  { key: 'heavy',      label: 'MARROW.Tag.Heavy',      hint: 'MARROW.Tag.HeavyHint' },
  { key: 'reach',      label: 'MARROW.Tag.Reach',      hint: 'MARROW.Tag.ReachHint' },
  { key: 'twoHanded',  label: 'MARROW.Tag.TwoHanded',  hint: 'MARROW.Tag.TwoHandedHint' },
];

/** I.1, I.2: the seven numbers, by key. */
MARROW.statLabels = {
  strength: 'Strength', speed: 'Speed', intellect: 'Intellect', combat: 'Combat',
  sanity: 'Sanity', fear: 'Fear', body: 'Body',
};

/** VIII.3's Repair paragraph, as the three states armour can be in. */
MARROW.armorStates = {
  intact: 'MARROW.ArmorState.intact',
  destroyed: 'MARROW.ArmorState.destroyed',
  patched: 'MARROW.ArmorState.patched',
};
