import { MARROW } from '../config.mjs';
import { MarrowCheck } from '../dice/check.mjs';
import { ADVANTAGE, DISADVANTAGE } from '../dice/roll.mjs';

const { DialogV2 } = foundry.applications.api;

/**
 * The dialog between clicking a number and rolling it.
 *
 * It asks the only two questions MARROW ever needs before a Check:
 *   - does a Skill you hold genuinely apply?      (X.5)
 *   - is the situation [+] or [-]?                (X.3)
 *
 * Nothing else. There is no modifier field, because MARROW has no arbitrary modifiers --
 * a bonus is either a Skill or it is Advantage, and inventing a third would be inventing a
 * mechanic. Shift-clicking a number skips this entirely.
 */
export class CheckDialog {
  /**
   * @param {Actor} actor
   * @param {object} options
   * @param {string} options.key       the Stat or Save being rolled
   * @param {Item}   [options.skill]   a Skill to pre-select
   * @param {string} [options.kind]
   * @param {string} [options.flavor]
   * @returns {Promise<object|null>} the Check result, or null if cancelled
   */
  static async prompt(actor, { key = null, skill = null, kind = 'check', flavor = '' } = {}) {
    const applicable = actor.items
      .filter(i => i.type === 'skill')
      .sort((a, b) => b.system.bonus - a.system.bonus || a.name.localeCompare(b.name));

    // MARROW.md never ties a Skill to a particular Stat -- III lists them as capabilities,
    // not as columns under a Stat. So when a Skill is what started the roll, the dialog asks
    // which Check it is being applied to instead of guessing one.
    const rollable = CheckDialog.#rollableKeys(actor);
    const title = key
      ? CheckDialog.#labelFor(actor, key)
      : (skill?.name ?? game.i18n.localize('MARROW.Dialog.Check'));

    const content = await foundry.applications.handlebars.renderTemplate(
      'systems/marrow/templates/dialog/check.hbs',
      {
        actor,
        key,
        rollable,
        label: key ? CheckDialog.#labelFor(actor, key) : '',
        base: key ? actor.system.rollTarget(key) : null,
        skills: applicable,
        selectedSkill: skill?.id ?? '',
        // Shown, not chosen: the player cannot switch these off (XVI.1, XX).
        innate: key ? (actor.system.hasDisadvantageOn?.(key) ?? false) : false,
        MARROW,
      },
    );

    const answer = await DialogV2.wait({
      window: { title: game.i18n.format('MARROW.Dialog.CheckTitle', { name: title }) },
      classes: ['marrow', 'dialog', 'check-dialog'],
      content,
      buttons: [
        { action: 'roll', label: 'MARROW.Dialog.Roll', default: true, callback: (e, b, d) => new FormData(d.form) },
      ],
      rejectClose: false,
    });
    if (!answer) return null;

    const chosenSkill = actor.items.get(answer.get('skill')) ?? null;
    const situational = answer.get('situational');
    const chosenKey = key ?? answer.get('key');
    if (!chosenKey) return null;

    const sources = [];
    if (situational === ADVANTAGE || situational === DISADVANTAGE) {
      sources.push({ source: game.i18n.localize('MARROW.Reason.Situational'), effect: situational });
    }

    return new MarrowCheck(actor, { key: chosenKey, kind, flavor, skill: chosenSkill, sources }).evaluate();
  }

  /** Every number on this actor that can be rolled under. */
  static #rollableKeys(actor) {
    const s = actor.system;
    const groups = [];
    if (s.stats) groups.push({ label: 'MARROW.Stats', keys: Object.keys(s.stats), source: s.stats });
    if (s.saves) groups.push({ label: 'MARROW.Saves', keys: Object.keys(s.saves), source: s.saves });
    // XX: a retainer has Combat, Instinct and Loyalty and nothing else.
    if (!s.stats) groups.push({ label: 'MARROW.Numbers', keys: ['combat', 'instinct', 'loyalty'], source: s });
    return groups.map(g => ({
      label: game.i18n.localize(g.label),
      options: g.keys.map(k => ({ key: k, label: g.source[k].label, total: g.source[k].total })),
    }));
  }

  static #labelFor(actor, key) {
    const s = actor.system;
    return s.stats?.[key]?.label ?? s.saves?.[key]?.label ?? s[key]?.label ?? key;
  }
}
