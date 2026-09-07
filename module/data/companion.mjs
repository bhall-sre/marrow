import { MARROW } from '../config.mjs';

const fields = foundry.data.fields;

/**
 * A Retainer (MARROW.md XX).
 *
 * The document type is `companion` so it never collides with anything else in a world,
 * but every label the player reads says "Retainer", which is what MARROW.md calls them.
 *
 * XX: "Retainers are simpler than you. They have four numbers." That simplicity is the
 * whole point of a separate model rather than a stripped-down character:
 *
 *   - Combat, as a character's.
 *   - Instinct, one number standing in for Fear, Sanity, Body, Speed and Intellect.
 *   - Maximum Wounds. "They do not track Health. Any damage they take is one Wound."
 *   - Loyalty, a Save rolled 2d10+10 at hiring.
 *
 * There is no Health field here at all. A retainer that had one would drift back toward
 * being a second-class character, and the Warden would start rolling damage for them.
 */
export class CompanionData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const score = (label) => new fields.SchemaField({
      value: new fields.NumberField({ required: true, integer: true, initial: 25, min: 0, max: 99 }),
      label: new fields.StringField({ initial: label }),
    });

    return {
      biography: new fields.HTMLField(),
      notes: new fields.HTMLField(),
      pronouns: new fields.StringField(),
      /** The occupation column of the XX hiring table. */
      occupation: new fields.StringField(),

      combat:   score('Combat'),
      instinct: score('Instinct'),
      loyalty:  score('Loyalty'),

      // "Any damage they take is one Wound. At their maximum, they die."
      wounds: new fields.SchemaField({
        value: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
        max:   new fields.NumberField({ required: true, integer: true, initial: 2, min: 1 }),
      }),

      // XX: "A retainer with a Motivation always fails a Loyalty Save when the two are in
      // conflict. Always." Held as text because only the Warden can judge the conflict.
      motivation: new fields.StringField(),

      // XX, wages and the death-price.
      wage: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      dangerMoney: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      deathPrice: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      beneficiary: new fields.StringField(),
      guilded: new fields.BooleanField({ initial: false }),

      // XX: "Short them or stiff them and every future Loyalty Save is at [-]."
      shorted: new fields.BooleanField({ initial: false }),

      // XX, The Touched: "a Touched retainer begins at Blight 4".
      blight: new fields.SchemaField({
        value: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0, max: 10 }),
        marked: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      }),

      silver: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
    };
  }

  /* ------------------------------------------------------------------------------ */

  prepareBaseData() {
    this.armor = { points: 0, damageReduction: 0, kind: null, cover: 'none' };
  }

  prepareDerivedData() {
    const blight = this.blight.value;

    this.blight.touched  = blight >= 1 && blight <= 3;
    this.blight.steeped  = blight >= 4;
    this.blight.consumed = blight >= 7;
    this.blight.undone   = blight >= 10;
    this.blight.band = this.blight.undone ? 'undone'
      : this.blight.consumed ? 'consumed'
      : this.blight.steeped ? 'steeped'
      : this.blight.touched ? 'touched' : 'clean';

    // XVI.1 says "all Stats and all Saves" without carving out retainers, so it reaches
    // Combat, Instinct and Loyalty the same way it reaches a character's seven numbers.
    // See CONVERSION_NOTES.md -- the XX table's Touched row is read as the number before
    // the penalty, not after.
    for (const key of ['combat', 'instinct', 'loyalty']) {
      this[key].total = Math.max(0, this[key].value - blight);
      this[key].penalty = blight;
    }

    // "At their maximum, they die."
    this.dead = this.wounds.value >= this.wounds.max;

    for (const item of this.parent.items) {
      if (item.type !== 'armor' || !item.system.equipped) continue;
      // VIII.3's three states decide what it is worth right now; XII.5 keeps its Damage
      // Reduction working whatever state it is in.
      this.armor.points += item.system.effectiveAP;
      this.armor.damageReduction += item.system.damageReduction;
      if (!item.system.isShield && !this.armor.kind) this.armor.kind = item.system.kind;
    }
    if (!this.armor.kind) this.armor.kind = MARROW.armorKindForAP(this.armor.points);

    this.bleeding = this.parent.items
      .filter(i => i.type === 'condition' && i.system.bleeding > 0)
      .reduce((sum, i) => sum + i.system.bleeding, 0);
  }

  /**
   * Instinct stands in for five of a character's numbers, so any Save a retainer is asked
   * for that is not Loyalty resolves against Instinct.
   */
  rollTarget(key, skillBonus = 0) {
    const which = key === 'combat' ? 'combat' : key === 'loyalty' ? 'loyalty' : 'instinct';
    return this[which].total + skillBonus;
  }

  /** XX: shorted wages put every future Loyalty Save at [-]. */
  hasDisadvantageOn(key) {
    if (key === 'loyalty') return this.shorted;
    // Consumed's [-] on Body Saves reaches the Instinct number that stands in for Body.
    return key === 'instinct' && this.blight.consumed;
  }
}
