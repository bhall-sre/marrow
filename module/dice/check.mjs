import { MARROW } from '../config.mjs';
import { rollUnder, rollPanic, onesDigit, netAdvantage, ADVANTAGE, DISADVANTAGE } from './roll.mjs';

/**
 * One Check, from the reason for rolling through to what it cost you.
 *
 * MARROW has exactly one resolution mechanic and a short, closed list of consequences, so
 * a Check is a small object rather than a family of subclasses:
 *
 *   1. Work out the target      -- Stat or Save, minus Blight, plus any Skill (X.5).
 *   2. Work out [+] / [-]       -- from every source, kept as reasons so they can be shown.
 *   3. Roll under (X.1, X.2).
 *   4. Pay for it               -- 1 Stress on a failure, a Panic Check on a Critical
 *                                  Failure (X.1, X.2, X.4).
 *
 * Workings (XVII.1) are the one thing that replaces step 4 wholesale: there, the roll never
 * decides whether it worked, only what it took out of you.
 */
export class MarrowCheck {
  /**
   * @param {Actor} actor
   * @param {object} options
   * @param {string} options.key         a Stat, Save, or 'loyalty' / 'instinct'
   * @param {string} [options.kind]      'check' | 'working' | 'rest'
   * @param {Item}   [options.skill]     a Skill item whose bonus applies (X.5)
   * @param {Item}   [options.working]   the Working being attempted
   * @param {Array}  [options.sources]   [{source, effect}] for [+] / [-]
   * @param {string} [options.flavor]
   */
  constructor(actor, { key, kind = 'check', skill = null, working = null, sources = [], flavor = '' } = {}) {
    this.actor = actor;
    this.key = key;
    this.kind = kind;
    this.skill = skill;
    this.working = working;
    this.flavor = flavor;
    this.sources = sources.filter(s => s && s.effect);

    // XVI.1's [-] on Body Saves, and a shorted retainer's [-] on Loyalty, are properties of
    // the character rather than the situation, so they are collected here rather than asked
    // for by every caller.
    if (actor.system.hasDisadvantageOn?.(key)) {
      this.sources.push({ source: this.#innateReason(key), effect: DISADVANTAGE });
    }
  }

  #innateReason(key) {
    if (key === 'loyalty') return game.i18n.localize('MARROW.Reason.Shorted');
    return game.i18n.localize('MARROW.Reason.Consumed');
  }

  /** X.5: the Skill's bonus raises the number you roll under. */
  get skillBonus() {
    return this.skill?.system.bonus ?? 0;
  }

  get target() {
    return this.actor.system.rollTarget(this.key, this.skillBonus);
  }

  get advantage() {
    return netAdvantage(this.sources.map(s => s.effect));
  }

  /**
   * Roll it, apply what it costs, and post the result.
   * @param {object} [opts]
   * @param {boolean} [opts.apply]  write the consequences to the actor (default true)
   */
  async evaluate({ apply = true } = {}) {
    const result = await rollUnder(this.target, this.advantage);
    result.check = this;

    result.consequences = this.kind === 'working'
      ? this.#workingConsequences(result)
      : this.#standardConsequences(result);

    await this.toMessage(result);
    if (apply) await applyConsequences(this.actor, result.consequences);
    return result;
  }

  /** X.1/X.2: "Otherwise you fail and gain 1 Stress." X.4: a Critical Failure panics you. */
  #standardConsequences(result) {
    const c = { stress: 0, blight: 0, blightFormula: null, panic: false, notes: [] };
    if (!result.success) {
      c.stress = 1;
      c.notes.push(game.i18n.localize('MARROW.Consequence.FailStress'));
    }
    if (result.outcome === 'criticalFailure') {
      c.panic = true;
      c.notes.push(game.i18n.localize('MARROW.Consequence.CriticalPanic'));
    }
    // XI.1: a successful Rest sheds the ones digit of the roll; a failed one costs 1 Stress
    // like any other failed Save, which the branch above has already charged.
    if (this.kind === 'rest' && result.success) {
      c.stress = -onesDigit(result.total);
      c.notes.push(game.i18n.format('MARROW.Consequence.RestRelief', { n: Math.abs(c.stress) }));
    }
    return c;
  }

  /** XVII.1's ladder. The Working always happens; only the price changes. */
  #workingConsequences(result) {
    const ladder = MARROW.workingOutcomes[result.outcome];
    const c = { stress: ladder.stress, blight: 0, blightFormula: null, panic: ladder.panic, notes: [] };
    if (typeof ladder.blight === 'number') c.blight = ladder.blight;
    else if (typeof ladder.blight === 'string') c.blightFormula = ladder.blight;
    c.notes.push(game.i18n.localize(`MARROW.Working.Outcome.${result.outcome}`));
    return c;
  }

  async toMessage(result) {
    const html = await foundry.applications.handlebars.renderTemplate(
      'systems/marrow/templates/chat/check.hbs',
      {
        actor: this.actor,
        check: this,
        result,
        label: this.flavor || this.defaultLabel(),
        working: this.working
          ? { name: this.working.name, formula: this.working.system.scaled(this.actor.system.blight.value) }
          : null,
      },
    );

    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: html,
      rolls: [result.roll],
      flags: { marrow: { check: { key: this.key, kind: this.kind, outcome: result.outcome } } },
    });
  }

  defaultLabel() {
    const s = this.actor.system;
    return s.stats?.[this.key]?.rollLabel
      ?? s.saves?.[this.key]?.rollLabel
      ?? s[this.key]?.label
      ?? this.key;
  }
}

/* -------------------------------------------------------------------------- */

/**
 * Write a Check's consequences to an actor.
 *
 * Everything here targets the stored value, never the derived one. Stress has a floor the
 * Blight can raise (XVI.1) and a ceiling of 20 (XI); Blight only ever rises (XVI.1) and
 * asks for a Mark each time it does.
 */
export async function applyConsequences(actor, c) {
  const s = actor.system;
  const update = {};
  const after = [];

  // Both of these are settings because they are the two consequences that fire on their own,
  // without anybody choosing to roll for them (see settings.mjs).
  const autoStress = game.settings.get('marrow', 'autoStress');
  const autoPanic = game.settings.get('marrow', 'autoPanic');

  if (c.stress && s.stress && autoStress) {
    const floor = s.stress.min ?? s.stress.base ?? 0;
    const raw = s.stress.value + c.stress;
    const next = Math.clamp(raw, floor, s.stress.max);
    if (next !== s.stress.value) update['system.stress.value'] = next;
    // XI: "anything past 20 instead reduces the most relevant Stat or Save by that amount."
    // Which Stat is the Warden's call, so the overflow is reported rather than applied.
    if (raw > s.stress.max) after.push({ type: 'stressOverflow', amount: raw - s.stress.max });
  }

  let blightGain = c.blight ?? 0;
  if (c.blightFormula) {
    const roll = await new Roll(c.blightFormula).evaluate();
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: game.i18n.localize('MARROW.Blight.Gain'),
    });
    blightGain += roll.total;
  }
  if (blightGain > 0 && s.blight) {
    const next = Math.min(s.blight.value + blightGain, 10);
    if (next !== s.blight.value) {
      update['system.blight.value'] = next;
      // XVI.1: "Every time your Blight Level rises, roll 1d10 on the Marks table."
      after.push({ type: 'marks', from: s.blight.value, to: next });
    }
  }

  if (!foundry.utils.isEmpty(update)) await actor.update(update);

  for (const step of after) {
    if (step.type === 'marks') await rollMarks(actor, step.from, step.to);
    if (step.type === 'stressOverflow') {
      ui.notifications?.warn(game.i18n.format('MARROW.Consequence.StressOverflow', { n: step.amount }));
    }
  }

  // XI.2 last, so the Panic Check reads the Stress this Check just added.
  if (c.panic && autoPanic) await panicCheck(actor);
}

/* -------------------------------------------------------------------------- */

/** XI.2. Roll 1d20 over current Stress; failing consults the Panic Table. */
export async function panicCheck(actor, { sources = [] } = {}) {
  const stress = actor.system.stress?.value ?? 0;
  const result = await rollPanic(stress, netAdvantage(sources.map(s => s.effect)));

  const html = await foundry.applications.handlebars.renderTemplate(
    'systems/marrow/templates/chat/panic.hbs',
    { actor, result },
  );
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: html,
    rolls: [result.roll],
    flags: { marrow: { panic: { success: result.success } } },
  });

  if (!result.success) await drawSystemTable(MARROW.tables.panic, actor);
  return result;
}

/** XVI.1's Marks table, once per level gained, only for levels never marked before. */
export async function rollMarks(actor, from, to) {
  const alreadyMarked = actor.system.blight.marked ?? 0;
  const first = Math.max(from, alreadyMarked) + 1;
  for (let level = first; level <= to; level++) {
    await drawSystemTable(MARROW.tables.marks, actor);
  }
  if (to > alreadyMarked) await actor.update({ 'system.blight.marked': to });
}

/**
 * Draw from one of the system's own tables. Tables are looked up by name so a Warden can
 * drop a replacement into the world and have it used without touching code.
 */
export async function drawSystemTable(key, actor = null) {
  const table = await resolveTable(key);
  if (!table) {
    ui.notifications?.warn(game.i18n.format('MARROW.Table.Missing', { name: key }));
    return null;
  }
  return table.draw({ speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined });
}

/** Find a table by name in the world first, then in the system's packs. */
export async function resolveTable(name) {
  const inWorld = game.tables.getName(name);
  if (inWorld) return inWorld;

  for (const packName of ['marrow.tables', 'marrow.tables_warden']) {
    const pack = game.packs.get(packName);
    if (!pack) continue;
    const entry = pack.index.find(e => e.name === name);
    if (entry) return pack.getDocument(entry._id);
  }
  return null;
}

export { ADVANTAGE, DISADVANTAGE };
