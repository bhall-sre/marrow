import { MARROW } from '../config.mjs';

const fields = foundry.data.fields;

/** Fields every item carries. */
const describable = () => ({
  description: new fields.HTMLField(),
  cost: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
});

/* -------------------------------------------------------------------------- */

/** III.2-III.4. A Skill is a rank and the prerequisites that gate it. */
export class SkillData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...describable(),
      rank: new fields.StringField({
        required: true, initial: 'trained', choices: Object.keys(MARROW.skillRanks),
      }),
      // III: "To take an Expert Skill you must first hold one of its Trained
      // prerequisites." Any one of these satisfies it -- they are alternatives, not a set.
      prerequisites: new fields.ArrayField(new fields.StringField()),
    };
  }

  prepareDerivedData() {
    this.bonus = MARROW.skillRanks[this.rank]?.bonus ?? 0;
    this.rankLabel = MARROW.skillRanks[this.rank]?.label ?? this.rank;
  }
}

/* -------------------------------------------------------------------------- */

/** VIII.2. */
export class WeaponData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...describable(),
      damage: new fields.StringField({ initial: '1d10' }),
      damageType: new fields.StringField({
        required: true, initial: 'bluntForce', choices: Object.keys(MARROW.damageTypes),
      }),
      // VIII.2 lists arrows and bolts among the weapons with no range of their own, so ''
      // is allowed and reads as a dash.
      range: new fields.StringField({
        required: true, blank: true, initial: 'adjacent',
        choices: ['', ...Object.keys(MARROW.ranges)],
      }),
      // "Ammo is what you have ready."
      ammo: new fields.SchemaField({
        value: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
        max: new fields.NumberField({ integer: true, initial: 0, min: 0 }),
      }),
      // VIII.2 tags
      antiArmor: new fields.BooleanField({ initial: false }),
      reload: new fields.BooleanField({ initial: false }),
      heavy: new fields.BooleanField({ initial: false }),
      reach: new fields.BooleanField({ initial: false }),
      twoHanded: new fields.BooleanField({ initial: false }),
      // a handful of weapons carry their own [+]/[-], unrelated to the armour matchup
      // blank: true, or the empty choice below is rejected -- StringField refuses '' by
      // default however the choices are written.
      innate: new fields.StringField({
        blank: true, initial: '', choices: ['', 'advantage', 'disadvantage'],
      }),
      equipped: new fields.BooleanField({ initial: false }),
      notes: new fields.StringField(),
    };
  }

  prepareDerivedData() {
    this.damageTypeLabel = MARROW.damageTypes[this.damageType]?.label ?? this.damageType;
    this.rangeLabel = MARROW.ranges[this.range] ?? '—';
    this.usesAmmo = this.ammo.max > 0;
  }

  /** VIII.1, resolved against a defender's armour kind. */
  matchupAgainst(armorKind) {
    return MARROW.matchupFor(this.damageType, armorKind);
  }
}

/* -------------------------------------------------------------------------- */

/** VIII.3 and VIII.4. Shields are armour that happens to be carried. */
export class ArmorData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...describable(),
      armorPoints: new fields.NumberField({ required: true, integer: true, initial: 1, min: 0 }),
      damageReduction: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      // left blank, kind is derived from AP -- every armour in VIII.3 agrees with its band
      kind: new fields.StringField({
        blank: true, initial: '', choices: ['', ...Object.keys(MARROW.armorKinds)],
      }),
      isShield: new fields.BooleanField({ initial: false }),
      // VIII.3: the warded cloak "Removes the Disadvantage on Blight Saves."
      warded: new fields.BooleanField({ initial: false }),
      heavy: new fields.BooleanField({ initial: false }),
      equipped: new fields.BooleanField({ initial: false }),
      /**
       * VIII.3 gives armour three states and no hit points at all. XII.5 destroys it
       * outright -- "if a single hit deals damage equal to or greater than your AP, the
       * armor is destroyed" -- and VIII.3's Repair paragraph brings it back in two steps:
       * "a leatherworker's kit patches torn armor back to serviceable, but patched armor
       * has AP 1 until a proper smith sees it. A smith restores full AP."
       */
      state: new fields.StringField({
        required: true, blank: false, initial: 'intact',
        choices: ['intact', 'destroyed', 'patched'],
      }),
      notes: new fields.StringField(),
    };
  }

  prepareDerivedData() {
    if (!this.kind) this.kind = MARROW.armorKindForAP(this.armorPoints);
    this.kindLabel = this.isShield ? 'Shield' : (MARROW.armorKinds[this.kind]?.label ?? this.kind);

    // The Armor Points this actually contributes right now. Destroyed armour keeps its
    // Damage Reduction: XII.5 is explicit that DR "keeps working after the armor is gone."
    this.effectiveAP = this.state === 'destroyed' ? 0
      : this.state === 'patched' ? Math.min(1, this.armorPoints)
      : this.armorPoints;
    this.destroyed = this.state === 'destroyed';
    this.stateLabel = game.i18n.localize(`MARROW.ArmorState.${this.state}`);
  }
}

/* -------------------------------------------------------------------------- */

/** IX, and XVIII.2 treatments -- anything you simply own or buy. */
export class GearData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...describable(),
      quantity: new fields.NumberField({ required: true, integer: true, initial: 1, min: 0 }),
      // trinkets and crests are gear you keep rather than use
      category: new fields.StringField({
        initial: 'gear', choices: ['gear', 'treatment', 'trinket', 'crest'],
      }),
    };
  }
}

/* -------------------------------------------------------------------------- */

/** II. What a Class grants, and what it asks you to choose. */
export class ClassData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const adj = () => new fields.NumberField({ required: true, integer: true, initial: 0 });
    return {
      ...describable(),
      traumaResponse: new fields.HTMLField(),
      // II: flat adjustments, applied to everyone of this class
      adjustments: new fields.SchemaField({
        strength: adj(), speed: adj(), intellect: adj(), combat: adj(),
        sanity: adj(), fear: adj(), body: adj(),
        maxWounds: adj(),
      }),
      // II: "+5 to one Stat of your choice" / "-10 to one Stat of your choice"
      choice: new fields.SchemaField({
        amount: new fields.NumberField({ integer: true, initial: 0 }),
        from: new fields.ArrayField(new fields.StringField(), {
          initial: ['strength', 'speed', 'intellect', 'combat'],
        }),
      }),
      // II: the Blighted "begin play at Blight 3"
      startingBlight: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      grantedSkills: new fields.ArrayField(new fields.StringField()),
      // II's Skills line, verbatim. The named Skills above are granted automatically; the
      // rest of the line ("one Expert Skill, or two Trained Skills", "one Trained Skill
      // from the life you had before this happened") asks for a judgement no schema can
      // make, so it is shown to the player rather than modelled.
      skillsNote: new fields.HTMLField(),
      // V, VI, VII
      tables: new fields.SchemaField({
        loadout: new fields.StringField(),
        trinket: new fields.StringField(),
        crest: new fields.StringField(),
      }),
    };
  }
}

/* -------------------------------------------------------------------------- */

/** XVII.2. `{B}` in a formula is the caster's Blight Level at the moment of casting. */
export class WorkingData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField(),
      formula: new fields.StringField(),
      notes: new fields.StringField(),
      // only The Calling has one: a table the Warden rolls in private
      wardenTable: new fields.StringField(),
    };
  }

  /** Substitute the caster's Blight Level into the stored formula. */
  scaled(blight) {
    return String(this.formula ?? '').replaceAll('{B}', String(blight));
  }
}

/* -------------------------------------------------------------------------- */

/** XI.3 Conditions, and XIII.1 Bleeding. */
export class ConditionData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField(),
      // XIII.1: Bleeding is cumulative -- 1 damage per round per point, ignoring armour
      bleeding: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      // XI.3: "permanent until treated"
      permanent: new fields.BooleanField({ initial: true }),
    };
  }
}
