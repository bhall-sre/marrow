import { MARROW } from '../config.mjs';

/**
 * The Item document.
 *
 * Items in MARROW mostly hold numbers and get read by the Actor. The one exception is the
 * Class (II), which is the only Item that changes an Actor's stored values -- so that is
 * where nearly all of this file goes.
 */
export class MarrowItem extends Item {
  /** What clicking an item's name in the sheet does. */
  async roll() {
    switch (this.type) {
      case 'weapon':  return this.actor?.rollAttack(this);
      case 'working': return this.actor?.castWorking(this);
      case 'skill':   return this.rollWithSkill();
      default:        return this.toChat();
    }
  }

  /**
   * X.5: a Skill has no roll of its own -- it raises the number you roll under on some other
   * Check. Rolling one asks which Check it is being applied to.
   */
  async rollWithSkill() {
    if (!this.actor) return this.toChat();
    const { CheckDialog } = await import('../apps/check-dialog.mjs');
    // MARROW.md never says which Stat a given Skill hangs off, so the dialog asks rather
    // than picking one on the player's behalf.
    return CheckDialog.prompt(this.actor, { skill: this });
  }

  async toChat() {
    const html = await foundry.applications.handlebars.renderTemplate(
      'systems/marrow/templates/chat/item.hbs',
      {
        item: this,
        // XVII.2: `{B}` in a Working's formula is the caster's Blight Level.
        formula: this.type === 'working'
          ? this.system.scaled(this.actor?.system.blight?.value ?? 0)
          : null,
      },
    );
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: html,
    });
  }

  /* --- Classes (II) ---------------------------------------------------------- */

  /**
   * Apply this Class to an actor: II's adjustments, its extra Maximum Wound, its starting
   * Blight, and its Skills.
   *
   * A character has exactly one Class, so applying a second removes the first. The
   * adjustments are folded into the stored Stat values rather than kept as a live modifier,
   * because I.3 says to "apply its adjustments" during creation -- the number on the sheet
   * afterwards is the character's real number. `system.classAdjustments` remembers what was
   * added so that swapping a Class can take it back out again.
   *
   * @param {Actor} actor
   * @param {object} [opts]
   * @param {string} [opts.choice]  the Stat the class lets you pick (II: "+5 to one Stat of
   *                                your choice", "-10 to one Stat of your choice")
   */
  async applyClass(actor, { choice = null } = {}) {
    if (this.type !== 'class') return null;

    // Take the previous class back out first, so swapping never compounds.
    await MarrowItem.removeClassFrom(actor);

    const adj = foundry.utils.deepClone(this.system.adjustments);
    if (this.system.choice.amount && choice) {
      adj[choice] = (adj[choice] ?? 0) + this.system.choice.amount;
    }

    const update = { 'system.className': this.name };
    const applied = {};

    for (const [key, delta] of Object.entries(adj)) {
      if (!delta) continue;
      if (key === 'maxWounds') {
        update['system.wounds.max'] = actor.system.wounds.max + delta;
      } else if (key in actor.system.stats) {
        update[`system.stats.${key}.value`] = actor.system.stats[key].value + delta;
      } else if (key in actor.system.saves) {
        update[`system.saves.${key}.value`] = actor.system.saves[key].value + delta;
      } else continue;
      applied[key] = delta;
    }

    // II, the Blighted: "You begin play at Blight 3."
    if (this.system.startingBlight > 0) {
      update['system.blight.value'] = this.system.startingBlight;
      // Those levels are part of who the character already is, so they do not each ask for
      // a Mark at creation the way a level gained in play does (XVI.1).
      update['system.blight.marked'] = this.system.startingBlight;
      applied.startingBlight = this.system.startingBlight;
    }

    update['flags.marrow.classAdjustments'] = applied;
    await actor.update(update);

    const created = await actor.createEmbeddedDocuments('Item', [this.toObject()]);
    await this.grantSkills(actor);
    return created[0];
  }

  /** II: each class hands you named Skills before you choose any bonus ones. */
  async grantSkills(actor) {
    const names = this.system.grantedSkills ?? [];
    if (!names.length) return [];

    const pack = game.packs.get('marrow.skills');
    if (!pack) return [];
    await pack.getIndex();

    const held = new Set(actor.items.filter(i => i.type === 'skill').map(i => i.name));
    const toAdd = [];
    for (const name of names) {
      if (held.has(name)) continue;
      const entry = pack.index.find(e => e.name === name);
      if (!entry) {
        ui.notifications?.warn(game.i18n.format('MARROW.Class.MissingSkill', { name }));
        continue;
      }
      const doc = await pack.getDocument(entry._id);
      toAdd.push(doc.toObject());
    }
    return toAdd.length ? actor.createEmbeddedDocuments('Item', toAdd) : [];
  }

  /** Undo whatever a previously applied Class added. */
  static async removeClassFrom(actor) {
    const applied = actor.flags?.marrow?.classAdjustments;
    const existing = actor.items.filter(i => i.type === 'class');
    if (!applied && !existing.length) return;

    const update = { 'system.className': '', 'flags.marrow.-=classAdjustments': null };
    for (const [key, delta] of Object.entries(applied ?? {})) {
      if (key === 'maxWounds') {
        update['system.wounds.max'] = Math.max(1, actor.system.wounds.max - delta);
      } else if (key === 'startingBlight') {
        // The Blight only ever rises in play (XVI.1), but a class applied and then swapped
        // during creation never happened, so its starting level comes back off.
        update['system.blight.value'] = Math.max(0, actor.system.blight.value - delta);
        update['system.blight.marked'] = Math.max(0, actor.system.blight.marked - delta);
      } else if (key in actor.system.stats) {
        update[`system.stats.${key}.value`] = actor.system.stats[key].value - delta;
      } else if (key in actor.system.saves) {
        update[`system.saves.${key}.value`] = actor.system.saves[key].value - delta;
      }
    }
    await actor.update(update);
    if (existing.length) {
      await actor.deleteEmbeddedDocuments('Item', existing.map(i => i.id));
    }
  }

  /* --- Skills (III) ---------------------------------------------------------- */

  /**
   * III: "To take an Expert Skill you must first hold one of its Trained prerequisites. To
   * take a Master Skill you must first hold one of its Expert prerequisites." Any one of
   * them satisfies it -- the list is alternatives, not a set to be completed.
   */
  prerequisitesMet(actor) {
    const prereqs = this.system.prerequisites ?? [];
    if (!prereqs.length) return true;
    const held = new Set(actor.items.filter(i => i.type === 'skill').map(i => i.name));
    return prereqs.some(name => held.has(name));
  }

  get isEquippable() {
    return this.type === 'weapon' || this.type === 'armor';
  }

  /** VIII.1, for display on the item sheet. */
  get matchupSummary() {
    if (this.type !== 'weapon') return null;
    const attack = MARROW.damageTypes[this.system.damageType]?.attack;
    if (!attack) return null;
    const m = MARROW.matchup[attack];
    return {
      beats: MARROW.armorKinds[m.beats].label,
      losesTo: MARROW.armorKinds[m.losesTo].label,
    };
  }
}
