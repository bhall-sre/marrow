import { MARROW } from '../config.mjs';
import { resolveTable } from '../dice/check.mjs';

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * MARROW.md I, "Making your character". Nine steps, in order.
 *
 * The design rule here is the same one that governs the rest of the system: enforce what
 * MARROW.md states as a mechanic, and show -- rather than decide -- what it leaves to
 * judgement.
 *
 *   Enforced:  the dice (2d10+25, 2d10+10, 1d10+10, 2d10x10), the Class adjustments, and
 *              III's prerequisite rule, which is unambiguous.
 *   Shown:     each Class's Skills allowance, which is written in prose ("one Expert Skill,
 *              or two Trained Skills") and cannot be modelled without inventing a schema
 *              MARROW.md does not have.
 *
 * I.1: "Roll fast and start playing." So every roll happens at once on open, the whole set
 * can be re-rolled, and nothing is required before Create except a Class.
 */
export class CharacterCreation extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'marrow-creation',
    classes: ['marrow', 'creation'],
    tag: 'form',
    window: { title: 'MARROW.Creation.Title', resizable: true },
    position: { width: 720, height: 800 },
    form: { handler: CharacterCreation.#onSubmit, closeOnSubmit: true },
    actions: {
      rollNumber: CharacterCreation.#onRollNumber,
      rollKit: CharacterCreation.#onRollKit,
      pickClass: CharacterCreation.#onPickClass,
      toggleSkill: CharacterCreation.#onToggleSkill,
    },
  };

  static PARTS = {
    body: { template: 'systems/marrow/templates/dialog/creation.hbs', scrollable: [''] },
  };

  /**
   * @param {object}  [options]
   * @param {Actor}   [options.actor]  regenerate this character in place. Without one, a new
   *                                   character is created on submit.
   */
  constructor(options = {}) {
    super(options);
    this.actor = options.actor ?? null;
    // Nothing is rolled until the player rolls it. A number, once rolled, is what it is --
    // I.1: "do not agonize over the numbers."
    this.rolls = CharacterCreation.blankRolls();
    this.kit = { loadout: null, trinket: null, crest: null };
    this.classId = null;
    this.choice = null;
    this.chosenSkills = new Set();
  }

  /* --- The dice of I.1, I.2, I.4, I.8 ---------------------------------------- */

  /**
   * The nine numbers I asks you to roll, each with the formula MARROW.md gives it.
   * I.1: Stats 2d10+25. I.2: Saves 2d10+10. I.4: Health 1d10+10. I.8: silver 2d10 x 10.
   */
  static NUMBERS = [
    { group: 'stats', key: 'strength',  formula: '2d10+25' },
    { group: 'stats', key: 'speed',     formula: '2d10+25' },
    { group: 'stats', key: 'intellect', formula: '2d10+25' },
    { group: 'stats', key: 'combat',    formula: '2d10+25' },
    { group: 'saves', key: 'sanity',    formula: '2d10+10' },
    { group: 'saves', key: 'fear',      formula: '2d10+10' },
    { group: 'saves', key: 'body',      formula: '2d10+10' },
    { group: 'root',  key: 'health',    formula: '1d10+10' },
    { group: 'root',  key: 'silver',    formula: '2d10 * 10' },
  ];

  static blankRolls() {
    return { stats: {}, saves: {}, health: null, silver: null };
  }

  #valueOf({ group, key }) {
    return group === 'root' ? this.rolls[key] : (this.rolls[group][key] ?? null);
  }

  #setValue({ group, key }, value) {
    if (group === 'root') this.rolls[key] = value;
    else this.rolls[group][key] = value;
  }

  get allRolled() {
    return CharacterCreation.NUMBERS.every(n => this.#valueOf(n) !== null);
  }

  async _prepareContext(options) {
    this.classes ??= await CharacterCreation.#loadClasses();
    this.skills ??= await CharacterCreation.#loadSkills();

    const chosen = this.classes.find(c => c.id === this.classId) ?? null;

    return {
      numbers: CharacterCreation.NUMBERS.map(n => ({
        ...n,
        label: game.i18n.localize(`MARROW.Adjust.${n.key}`) === `MARROW.Adjust.${n.key}`
          ? game.i18n.localize(n.key === 'health' ? 'MARROW.Health' : 'MARROW.Silver')
          : game.i18n.localize(`MARROW.Adjust.${n.key}`),
        value: this.#valueOf(n),
        rolled: this.#valueOf(n) !== null,
      })),
      allRolled: this.allRolled,
      kit: this.#kitContext(chosen),
      classes: this.classes.map(c => ({
        id: c.id, name: c.name, img: c.img,
        selected: c.id === this.classId,
        skillsNote: c.system.skillsNote,
        summary: CharacterCreation.#adjustmentSummary(c),
        startingBlight: c.system.startingBlight,
      })),
      chosenClass: chosen ? {
        name: chosen.name,
        skillsNote: chosen.system.skillsNote,
        granted: chosen.system.grantedSkills,
        choice: chosen.system.choice.amount ? {
          amount: chosen.system.choice.amount,
          isPenalty: chosen.system.choice.amount < 0,
          options: chosen.system.choice.from.map(key => ({
            key,
            label: MARROW.statLabels?.[key] ?? key.capitalize(),
            selected: this.choice === key,
          })),
        } : null,
      } : null,
      skillsByRank: this.#skillsByRank(chosen),
      preview: this.#preview(chosen),
      existing: this.actor ? { name: this.actor.name, pronouns: this.actor.system.pronouns } : null,
      isRegenerate: !!this.actor,
      canSubmit: !!this.classId && this.allRolled,
      // Says what is still missing, rather than leaving a disabled button unexplained.
      blockedBy: !this.allRolled ? 'MARROW.Creation.RollEverythingFirst'
        : !this.classId ? 'MARROW.Creation.PickClassFirst'
        : null,
    };
  }

  /**
   * I.8's three draws. Each is rolled here rather than at submit, so the player sees what
   * they got before committing -- the same as every other number on this page.
   */
  #kitContext(chosen) {
    const slots = [
      { slot: 'loadout', label: 'MARROW.Roll.Loadout', table: chosen?.system.tables.loadout },
      { slot: 'trinket', label: 'MARROW.Roll.Trinket', table: chosen?.system.tables.trinket },
      { slot: 'crest',   label: 'MARROW.Roll.Crest',   table: chosen?.system.tables.crest },
    ];
    return slots.map(s => ({
      ...s,
      label: game.i18n.localize(s.label),
      text: this.kit[s.slot],
      rolled: this.kit[s.slot] !== null,
      // V's Loadout table is the Class's own, so there is nothing to roll until one is picked.
      available: !!s.table,
    }));
  }

  static async #loadClasses() {
    const pack = game.packs.get('marrow.classes');
    if (!pack) return [];
    return (await pack.getDocuments()).sort((a, b) => a.name.localeCompare(b.name));
  }

  static async #loadSkills() {
    const pack = game.packs.get('marrow.skills');
    if (!pack) return [];
    return (await pack.getDocuments()).sort((a, b) => a.name.localeCompare(b.name));
  }

  static #adjustmentSummary(classItem) {
    const s = classItem.system;
    const bits = [];
    for (const [key, value] of Object.entries(s.adjustments)) {
      if (!value) continue;
      const label = game.i18n.localize(`MARROW.Adjust.${key}`);
      bits.push(`${value > 0 ? '+' : ''}${value} ${label}`);
    }
    if (s.choice.amount) {
      bits.push(game.i18n.format('MARROW.Creation.ChoiceSummary', {
        amount: `${s.choice.amount > 0 ? '+' : ''}${s.choice.amount}`,
      }));
    }
    if (s.startingBlight) {
      bits.push(game.i18n.format('MARROW.Creation.BlightSummary', { n: s.startingBlight }));
    }
    return bits.join(' · ');
  }

  /**
   * III: "To take an Expert Skill you must first hold one of its Trained prerequisites."
   * Held means granted by the Class or already chosen here, so the list re-evaluates as
   * the player picks -- taking Alchemy makes Apothecary available in the same pass.
   */
  #skillsByRank(chosen) {
    const held = new Set([...(chosen?.system.grantedSkills ?? []), ...this.chosenSkills]);

    const groups = { trained: [], expert: [], master: [] };
    for (const skill of this.skills) {
      const prereqs = skill.system.prerequisites ?? [];
      const met = !prereqs.length || prereqs.some(name => held.has(name));
      groups[skill.system.rank].push({
        name: skill.name,
        bonus: skill.system.bonus,
        prerequisites: prereqs,
        granted: chosen?.system.grantedSkills.includes(skill.name) ?? false,
        chosen: this.chosenSkills.has(skill.name),
        // A Skill you hold from the Class is not selectable again.
        locked: chosen?.system.grantedSkills.includes(skill.name) ?? false,
        available: met,
      });
    }
    for (const list of Object.values(groups)) list.sort((a, b) => a.name.localeCompare(b.name));
    return groups;
  }

  /** The sheet as it will be, so the player sees the Class land before committing. */
  #preview(chosen) {
    const zero = (group) => Object.fromEntries(
      CharacterCreation.NUMBERS.filter(n => n.group === group)
        .map(n => [n.key, this.rolls[group][n.key] ?? 0]));
    const stats = zero('stats');
    const saves = zero('saves');
    let wounds = 2;
    let blight = 0;

    if (chosen) {
      const adj = { ...chosen.system.adjustments };
      if (chosen.system.choice.amount && this.choice) {
        adj[this.choice] = (adj[this.choice] ?? 0) + chosen.system.choice.amount;
      }
      for (const [key, value] of Object.entries(adj)) {
        if (!value) continue;
        if (key === 'maxWounds') wounds += value;
        else if (key in stats) stats[key] += value;
        else if (key in saves) saves[key] += value;
      }
      blight = chosen.system.startingBlight;
    }

    // XVI.1: the Blight subtracts from what you roll under, so the preview shows both.
    const withPenalty = (o) => Object.fromEntries(
      Object.entries(o).map(([k, v]) => [k, { value: v, total: Math.max(0, v - blight) }]));

    return {
      stats: withPenalty(stats),
      saves: withPenalty(saves),
      health: this.rolls.health ?? 0,
      silver: this.rolls.silver ?? 0,
      wounds,
      blight,
      // XVI.1: Steeped and Consumed each add 1 to the Stress floor. At creation only the
      // Blighted can be affected, and only if they start Steeped.
      stress: 2 + (blight >= 4 ? 1 : 0) + (blight >= 7 ? 1 : 0),
    };
  }

  /* --- Actions --------------------------------------------------------------- */

  /** Roll one number. Once it is rolled the button goes: the number stands. */
  static async #onRollNumber(event, target) {
    const spec = CharacterCreation.NUMBERS.find(
      n => n.group === target.dataset.group && n.key === target.dataset.key);
    if (!spec || this.#valueOf(spec) !== null) return;

    const roll = await new Roll(spec.formula).evaluate();
    this.#setValue(spec, roll.total);
    this.render();
  }

  /** I.8: Loadout, Trinket, Crest. Drawn here so the player sees them before committing. */
  static async #onRollKit(event, target) {
    const slot = target.dataset.slot;
    if (this.kit[slot] !== null) return;

    const chosen = this.classes.find(c => c.id === this.classId);
    const table = await resolveTable(chosen?.system.tables[slot]);
    if (!table) {
      ui.notifications?.warn(game.i18n.format('MARROW.Table.Missing',
        { name: chosen?.system.tables[slot] ?? slot }));
      return;
    }

    const draw = await table.roll();
    const result = draw.results[0];
    this.kit[slot] = result?.description ?? result?.text ?? '';
    this.render();
  }

  static #onPickClass(event, target) {
    this.classId = target.dataset.classId;
    this.choice = null;
    // V's Loadout is the Class's own table, so a draw from the previous one no longer means
    // anything. The Trinket and Crest tables are shared, so those stand.
    this.kit.loadout = null;
    // The previous class's granted Skills may have been propping up an Expert choice.
    this.chosenSkills.clear();
    this.render();
  }

  static #onToggleSkill(event, target) {
    const name = target.dataset.skill;
    if (this.chosenSkills.has(name)) this.chosenSkills.delete(name);
    else this.chosenSkills.add(name);
    this.render();
  }

  _onChangeForm(formConfig, event) {
    if (event.target?.name === 'choice') {
      this.choice = event.target.value;
      this.render();
    }
  }

  /* --- Create ---------------------------------------------------------------- */

  static async #onSubmit(event, form, formData) {
    const data = formData.object;
    const chosen = this.classes.find(c => c.id === this.classId);
    if (!chosen) return;

    const name = (data.name || '').trim()
      || this.actor?.name
      || game.i18n.localize('MARROW.Unnamed');

    // I.1-I.5, I.9. The Class's adjustments are applied afterwards by applyClass, so what is
    // written here is the character before the Class touches them.
    const system = {
      pronouns: data.pronouns ?? '',
      stats: Object.fromEntries(
        Object.entries(this.rolls.stats).map(([k, v]) => [k, { value: v }])),
      saves: Object.fromEntries(
        Object.entries(this.rolls.saves).map(([k, v]) => [k, { value: v }])),
      health: { value: this.rolls.health, max: this.rolls.health },
      wounds: { value: 0, max: 2 },
      stress: { value: 2, base: 2, max: 20 },
      blight: { value: 0, marked: 0 },
      silver: this.rolls.silver,
      tally: 0,                                      // I.9
    };

    let actor = this.actor;

    if (actor) {
      // Regenerating replaces the character. Say so before doing it.
      if (actor.items.size) {
        const ok = await foundry.applications.api.DialogV2.confirm({
          window: { title: game.i18n.localize('MARROW.Creation.ReplaceTitle') },
          content: `<p>${game.i18n.format('MARROW.Creation.ReplaceBody', { name: actor.name })}</p>`,
        });
        if (!ok) return;
        await actor.deleteEmbeddedDocuments('Item', actor.items.map(i => i.id));
      }
      // Clear the record of the old Class's adjustments before writing fresh numbers, so
      // applyClass has nothing to subtract from a set of Stats that never had it added.
      await actor.update({ name, system, 'flags.marrow.-=classAdjustments': null });
    } else {
      actor = await Actor.create({ name, type: 'character', system });
    }

    // I.3 and I.7: the Class, its adjustments, and the Skills it grants.
    await chosen.applyClass(actor, { choice: this.choice });

    // I.7, the Skills the player chose on top.
    const extra = this.skills
      .filter(s => this.chosenSkills.has(s.name))
      .map(s => s.toObject());
    if (extra.length) await actor.createEmbeddedDocuments('Item', extra);

    // I.8: whatever was drawn on the way through, applied as items.
    await CharacterCreation.applyKit(actor, this.kit);

    actor.sheet.render(true);
    return actor;
  }

  /**
   * I.8. Turn the three draws already made in the wizard into items. Nothing is rolled here
   * -- the player has seen these results and accepted them.
   */
  static async applyKit(actor, kit) {
    if (kit.loadout) await CharacterCreation.applyLoadout(actor, kit.loadout);

    for (const [slot, category] of [['trinket', 'trinket'], ['crest', 'crest']]) {
      const text = kit[slot];
      if (!text) continue;
      await actor.createEmbeddedDocuments('Item', [{
        name: text,
        type: 'gear',
        img: category === 'trinket' ? 'icons/svg/chest.svg' : 'icons/svg/statue.svg',
        system: { description: `<p>${text}</p>`, quantity: 1, category },
      }]);
    }
  }

  /**
   * Turn a Loadout line into items.
   *
   * V's results are sentences: "Mail hauberk (AP 7), brace of javelins (x4), pack, camp
   * kit". Each part is matched against the compendiums by name; anything that does not
   * match becomes a plain gear item with that text, so a Loadout entry is never silently
   * dropped -- which is exactly what went wrong the last time this was written.
   */
  static async applyLoadout(actor, text) {
    if (!text) return [];

    const index = await CharacterCreation.#buildItemIndex();
    const created = [];

    for (const part of CharacterCreation.#splitLoadout(text)) {
      const { base, quantity, annotation } = CharacterCreation.#parseLoadoutPart(part);
      const match = CharacterCreation.#lookup(index, base);

      if (!match) {
        // Nothing in the packs answers to this -- "a knucklebone it likes", "a cat". It
        // becomes a gear item carrying its own text, so a Loadout entry is never lost.
        created.push({
          name: part,
          type: 'gear',
          img: 'icons/svg/item-bag.svg',
          system: { description: `<p>${part}</p>`, quantity: 1, category: 'gear' },
        });
        continue;
      }

      const data = match.toObject();

      // What "(xN)" means depends on what it is attached to, and getting this wrong is how
      // a player ends up with four braces of javelins or fifteen doses of blight-purge.
      if (quantity > 1) {
        const bundle = data.name.match(/\(x(\d+)\)/i);
        if (data.type === 'weapon') {
          // The count is the weapon's ammunition, not a number of weapons: "brace of
          // javelins (x4)" is one brace holding four.
          if (data.system.ammo.max > 0) {
            data.system.ammo = { value: quantity, max: quantity };
          }
        } else if (bundle) {
          // The pack entry is itself a bundle sold in a fixed size. The Loadout's count is
          // the true one, so keep the item and take its name from the table: three doses of
          // blight-purge, not three five-packs and not five doses.
          if (Number(bundle[1]) !== quantity) {
            data.name = data.name.replace(/\(x\d+\)/i, `(x${quantity})`);
          }
        } else {
          data.system.quantity = quantity;
        }
      }
      if (annotation) {
        data.system.notes = [data.system.notes, annotation].filter(Boolean).join(' ');
      }
      if (data.type === 'weapon' || data.type === 'armor') data.system.equipped = true;
      created.push(data);
    }

    return created.length ? actor.createEmbeddedDocuments('Item', created) : [];
  }

  /**
   * Split on commas that are not inside parentheses, then put back any clause that opens
   * with "and" -- V's entries end in asides like "a great house's signet ring, and no
   * explanation for it", which is one object and one joke, not two items.
   */
  static #splitLoadout(text) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const ch of text) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
      } else current += ch;
    }
    if (current.trim()) parts.push(current.trim());

    return parts.filter(Boolean).reduce((out, part) => {
      if (out.length && /^and\s/i.test(part)) out[out.length - 1] += `, ${part}`;
      else out.push(part);
      return out;
    }, []);
  }

  static #parseLoadoutPart(part) {
    const quantity = Number(part.match(/\(x(\d+)\)/i)?.[1] ?? 1);
    // Everything in brackets is annotation: "(AP 7)", "(x4)", "(60 arrows)", "(notched...)".
    const base = part.replace(/\([^)]*\)/g, '').trim();
    const annotation = part.match(/\(([^)]*)\)/g)?.join(' ') ?? '';
    return { base, quantity, annotation };
  }

  /**
   * Names in the Loadout tables and names in the packs describe the same things in slightly
   * different words: "&" against "and", "Signal rocket" against "signal rockets", "Rope,
   * 50m" against "rope". Normalising drops the joining words and the plural so those meet.
   */
  static #normalize(name) {
    return name
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter(word => word && !['and', 'of', 'the', 'a'].includes(word))
      .map(word => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')
        ? word.slice(0, -1) : word))
      .join(' ');
  }

  /**
   * Exact first, then a prefix: "bandage roll" finds "Bandage roll & needle", and "rope"
   * finds "Rope, 50m". A prefix match must cover the whole of the shorter name's words, so
   * "oil" does not quietly become "Flask of lamp oil".
   */
  static #lookup(index, base) {
    const key = CharacterCreation.#normalize(base);
    if (!key) return null;
    if (index.has(key)) return index.get(key);
    for (const [candidate, doc] of index) {
      if (candidate.startsWith(key + ' ')) return doc;
    }
    return null;
  }

  static async #buildItemIndex() {
    const index = new Map();
    for (const packName of ['armor', 'weapons', 'gear', 'treatments']) {
      const pack = game.packs.get(`marrow.${packName}`);
      if (!pack) continue;
      for (const doc of await pack.getDocuments()) {
        const key = CharacterCreation.#normalize(doc.name);
        if (!index.has(key)) index.set(key, doc);
        // "Torches (x5)" should also answer to "torches".
        const bare = CharacterCreation.#normalize(doc.name.replace(/\([^)]*\)/g, ''));
        if (bare && !index.has(bare)) index.set(bare, doc);
      }
    }
    return index;
  }
}

/** A button on the Actors directory, since creation makes the actor rather than editing one. */
export function registerCreationButton() {
  Hooks.on('renderActorDirectory', (app, html) => {
    if (!game.user.can('ACTOR_CREATE')) return;
    if (html.querySelector('.marrow-create-character')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'marrow-create-character';
    button.innerHTML = `<i class="fa-solid fa-feather"></i> ${
      game.i18n.localize('MARROW.Creation.Button')}`;
    button.addEventListener('click', () => new CharacterCreation().render(true));

    const header = html.querySelector('.directory-header') ?? html.firstElementChild;
    header?.prepend(button);
  });
}

export { resolveTable };
