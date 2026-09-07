import { MARROW } from '../config.mjs';

const fields = foundry.data.fields;

/**
 * A MARROW player character.
 *
 * Two ideas drive the whole schema, and they are worth stating before the code:
 *
 * 1. Stored values are what the character *has*. Derived values are what they *roll*.
 *    `stats.x.value` is the Stat as written on the sheet; `stats.x.total` is that Stat
 *    after the Blight has taken its cut. Nothing ever writes a derived value back, so the
 *    penalty can never compound into the stored number.
 *
 * 2. The Blight (MARROW.md XVI) is not a status effect bolted on top. It is a first-class
 *    resource that reaches every Stat, every Save, the Stress floor, and the Body Save's
 *    Advantage state. It only ever rises.
 */
export class CharacterData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const stat = (label, rollLabel) => new fields.SchemaField({
      value: new fields.NumberField({ required: true, integer: true, initial: 30, min: 0, max: 99 }),
      label: new fields.StringField({ initial: label }),
      rollLabel: new fields.StringField({ initial: rollLabel }),
    });

    return {
      // --- identity -----------------------------------------------------------------
      biography: new fields.HTMLField(),
      notes: new fields.HTMLField(),
      pronouns: new fields.StringField(),
      className: new fields.StringField(),
      // I. step 9: "Write a Tally of zero. It counts the jobs you have walked away from.
      // It does nothing at all. Others have died for less."
      tally: new fields.NumberField({ integer: true, initial: 0, min: 0 }),

      // --- Stats (I.1, 2d10+25) and Saves (I.2, 2d10+10) ------------------------------
      stats: new fields.SchemaField({
        strength:  stat('Strength',  'Strength Check'),
        speed:     stat('Speed',     'Speed Check'),
        intellect: stat('Intellect', 'Intellect Check'),
        combat:    stat('Combat',    'Combat Check'),
      }),
      saves: new fields.SchemaField({
        sanity: stat('Sanity', 'Sanity Save'),
        fear:   stat('Fear',   'Fear Save'),
        body:   stat('Body',   'Body Save'),
      }),

      // --- Health and Wounds (I.4, XIII) ---------------------------------------------
      health: new fields.SchemaField({
        value: new fields.NumberField({ required: true, integer: true, initial: 15, min: 0 }),
        max:   new fields.NumberField({ required: true, integer: true, initial: 15, min: 0 }),
      }),
      wounds: new fields.SchemaField({
        value: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
        max:   new fields.NumberField({ required: true, integer: true, initial: 2, min: 1 }),
      }),

      // --- Stress (XI). `base` is the character's own permanent floor, raised by Panic
      // results; `min` is derived from it plus whatever the Blight is adding.
      stress: new fields.SchemaField({
        value: new fields.NumberField({ required: true, integer: true, initial: 2, min: 0 }),
        base:  new fields.NumberField({ required: true, integer: true, initial: 2, min: 0 }),
        max:   new fields.NumberField({ required: true, integer: true, initial: 20, min: 1 }),
      }),

      // --- The Blight (XVI) ----------------------------------------------------------
      blight: new fields.SchemaField({
        value: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0, max: 10 }),
        // highest level a Mark has been rolled for, so suppressing Blight with a purge and
        // regaining it does not ask for a second Mark at the same level (XVI.2, XVI.3)
        marked: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      }),

      // --- IV. Silver pennies. One flat currency, no denominations. -------------------
      silver: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
    };
  }

  /* ------------------------------------------------------------------------------ */

  prepareBaseData() {
    // Armour accumulates here before derived data reads it.
    this.armor = { points: 0, damageReduction: 0, kind: null, cover: 'none' };
  }

  prepareDerivedData() {
    const blight = this.blight.value;

    // XVI.1 bands. Named once, read everywhere.
    this.blight.touched  = blight >= 1 && blight <= 3;
    this.blight.steeped  = blight >= 4;
    this.blight.consumed = blight >= 7;
    this.blight.undone   = blight >= 10;
    this.blight.band = this.blight.undone ? 'undone'
      : this.blight.consumed ? 'consumed'
      : this.blight.steeped ? 'steeped'
      : this.blight.touched ? 'touched' : 'clean';

    // XVI.1: "Every level of Blight is a permanent -1 to all Stats and all Saves."
    // `total` is the number you roll under. `value` is left untouched.
    for (const key of Object.keys(this.stats)) {
      this.stats[key].total = Math.max(0, this.stats[key].value - blight);
      this.stats[key].penalty = blight;
    }
    for (const key of Object.keys(this.saves)) {
      this.saves[key].total = Math.max(0, this.saves[key].value - blight);
      this.saves[key].penalty = blight;
    }

    // XVI.1: Steeped +1 Minimum Stress, Consumed +1 again (they stack).
    const blightStress = (this.blight.steeped ? 1 : 0) + (this.blight.consumed ? 1 : 0);
    this.stress.min = this.stress.base + blightStress;
    this.stress.blightPenalty = blightStress;
    if (this.stress.value < this.stress.min) this.stress.value = this.stress.min;

    // Armour from equipped items (VIII.4: shields add their AP to your armour's).
    for (const item of this.parent.items) {
      if (item.type !== 'armor' || !item.system.equipped) continue;
      // XII.5: destroyed armor gives no AP, but its DR "keeps working after the armor is gone."
      if (!item.system.destroyed) this.armor.points += item.system.armorPoints;
      this.armor.damageReduction += item.system.damageReduction;
      // The worn armour sets the kind the VIII.1 matchup keys off; a shield never does.
      if (!item.system.isShield && !this.armor.kind) this.armor.kind = item.system.kind;
    }
    if (!this.armor.kind) this.armor.kind = MARROW.armorKindForAP(this.armor.points);

    // XIII.1: Bleeding is cumulative and ignores armour and DR. It lives on Condition
    // items so that clearing the condition clears the bleed.
    this.bleeding = this.parent.items
      .filter(i => i.type === 'condition' && i.system.bleeding > 0)
      .reduce((sum, i) => sum + i.system.bleeding, 0);
  }

  /**
   * The number to roll under for a Stat or Save, plus any Skill that applies.
   * @param {string} key  a Stat or Save key
   * @param {number} skillBonus
   */
  rollTarget(key, skillBonus = 0) {
    const group = key in this.stats ? this.stats : this.saves;
    return group[key].total + skillBonus;
  }

  /** XVI.1, Consumed: "[-] on all Body Saves." */
  hasDisadvantageOn(key) {
    return key === 'body' && this.blight.consumed;
  }
}
