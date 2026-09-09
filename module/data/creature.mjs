import { MARROW } from '../config.mjs';

const fields = foundry.data.fields;

/**
 * A Creature -- MARROW.md has no monster stat block of its own, so this mirrors the one the
 * Mothership Foundry system uses for its `creature` type: Health and Wounds like a
 * character, and just the two numbers a fight actually needs, Combat and Instinct.
 *
 * See CONVERSION_NOTES.md: Mothership's creature also offers optional Speed/Loyalty/Sanity/
 * Armor toggles and a "swarm" scaling rule. Those are extensions on top of the base block,
 * not part of it, and are left out here rather than invented.
 */
export class CreatureData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const score = (label) => new fields.SchemaField({
      value: new fields.NumberField({ required: true, integer: true, initial: 10, min: 0, max: 99 }),
      label: new fields.StringField({ initial: label }),
    });

    return {
      biography: new fields.HTMLField(),
      notes: new fields.HTMLField(),

      combat:   score('Combat'),
      instinct: score('Instinct'),

      health: new fields.SchemaField({
        value: new fields.NumberField({ required: true, integer: true, initial: 10, min: 0 }),
        max:   new fields.NumberField({ required: true, integer: true, initial: 10, min: 1 }),
      }),
      wounds: new fields.SchemaField({
        value: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
        max:   new fields.NumberField({ required: true, integer: true, initial: 2, min: 1 }),
      }),

      silver: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
    };
  }

  /* ------------------------------------------------------------------------------ */

  prepareBaseData() {
    this.armor = { points: 0, damageReduction: 0, kind: null, cover: 'none' };
  }

  prepareDerivedData() {
    this.dead = this.wounds.value >= this.wounds.max;

    for (const key of ['combat', 'instinct']) this[key].total = this[key].value;

    for (const item of this.parent.items) {
      if (item.type !== 'armor' || !item.system.equipped) continue;
      this.armor.points += item.system.effectiveAP;
      this.armor.damageReduction += item.system.damageReduction;
      if (!item.system.isShield && !this.armor.kind) this.armor.kind = item.system.kind;
    }
    if (!this.armor.kind) this.armor.kind = MARROW.armorKindForAP(this.armor.points);

    this.bleeding = this.parent.items
      .filter(i => i.type === 'condition' && i.system.bleeding > 0)
      .reduce((sum, i) => sum + i.system.bleeding, 0);
  }

  /** The numbers a Check can be rolled against, for whatever wants to offer a choice. */
  rollableGroups() {
    return [{ label: 'MARROW.Numbers', keys: ['combat', 'instinct'] }];
  }

  /**
   * Only two numbers exist to roll against. `skillBonus` is accepted and added like every
   * other model's: a creature holds no Skills by default, but nothing stops a Warden
   * dropping one on it, and silently discarding the bonus would be a lie.
   */
  rollTarget(key, skillBonus = 0) {
    return (key === 'combat' ? this.combat.total : this.instinct.total) + skillBonus;
  }

  hasDisadvantageOn() {
    return false;
  }
}
