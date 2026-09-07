import { MARROW } from '../config.mjs';
import { drawSystemTable, resolveTable, applyConsequences } from './check.mjs';
import { applyResultEffects } from './effects.mjs';

/**
 * Damage, armour, Wounds and death.
 *
 * XII.5 is unusual enough to be worth restating, because it is not the subtraction most
 * systems use:
 *
 *   "You ignore all damage LESS THAN your Armor Points. If a single hit deals damage EQUAL
 *    TO OR GREATER THAN your AP, the armor is destroyed and the remainder goes into you."
 *
 * So armour is a threshold, not a pool. A hit under it does nothing at all; a hit over it
 * gets through *and* costs you the armour. Damage Reduction is the ordinary kind of
 * subtraction, and it "always subtracts first, before armor is considered."
 */

/**
 * Resolve a raw damage number against a defender's protection.
 *
 * @param {number} amount
 * @param {object} protection  {points, damageReduction}
 * @param {object} [opts]
 * @param {boolean} [opts.antiArmor]  VIII.2 AA: ignores and destroys armour on any hit
 * @param {boolean} [opts.ignoreArmor] XIII.1 Bleeding, and Wounds dealt directly
 * @returns {{applied: number, absorbed: number, armorDestroyed: boolean,
 *            afterDR: number, ignored: boolean}}
 */
export function resolveDamage(amount, protection, { antiArmor = false, ignoreArmor = false } = {}) {
  const ap = protection?.points ?? 0;
  const dr = protection?.damageReduction ?? 0;

  if (ignoreArmor) {
    // XIII.1: "Bleeding ignores armor and Damage Reduction."
    return { applied: amount, absorbed: 0, armorDestroyed: false, afterDR: amount, ignored: true };
  }

  // XII.5: "Damage Reduction always subtracts first ... and keeps working after the armor
  // is gone and against Anti-Armor."
  const afterDR = Math.max(0, amount - dr);

  if (antiArmor) {
    return { applied: afterDR, absorbed: amount - afterDR, armorDestroyed: ap > 0, afterDR, ignored: false };
  }

  if (afterDR < ap) {
    // "You ignore all damage less than your Armor Points."
    return { applied: 0, absorbed: amount, armorDestroyed: false, afterDR, ignored: false };
  }

  const applied = afterDR - ap;
  return { applied, absorbed: amount - applied, armorDestroyed: ap > 0, afterDR, ignored: false };
}

/* -------------------------------------------------------------------------- */

/**
 * Apply damage to an actor, taking Wounds and Death Saves as they fall out of it.
 *
 * XIII: "When your Health reaches zero you take a Wound. Roll 1d10 on the column matching
 * the damage that did it, apply the result, then reset your Health to its Maximum and
 * subtract any damage that carried over." A single very large hit can therefore cost more
 * than one Wound, which is why this loops.
 */
export async function applyDamage(actor, amount, {
  damageType = 'bluntForce',
  antiArmor = false,
  ignoreArmor = false,
  directWounds = 0,
} = {}) {
  const s = actor.system;
  const outcome = { rolledWounds: 0, deathSave: false, armorDestroyed: false, applied: 0 };

  // XIII: "Some attacks deal Wounds directly, bypassing armor and Damage Reduction entirely."
  if (directWounds > 0) {
    for (let i = 0; i < directWounds; i++) await takeWound(actor, damageType, outcome);
    return outcome;
  }

  const resolved = resolveDamage(amount, s.armor, { antiArmor, ignoreArmor });
  outcome.applied = resolved.applied;
  outcome.armorDestroyed = resolved.armorDestroyed;
  if (resolved.armorDestroyed) await destroyArmor(actor);

  // XX: a retainer does not track Health. "Any damage they take is one Wound."
  if (!s.health) {
    if (resolved.applied > 0) await takeWound(actor, damageType, outcome);
    return outcome;
  }

  let remaining = resolved.applied;
  let health = s.health.value;

  while (remaining > 0) {
    if (remaining < health) {
      health -= remaining;
      remaining = 0;
      break;
    }
    // Health has reached zero. The overflow carries into the fresh Health total.
    remaining -= health;
    health = s.health.max;
    await takeWound(actor, damageType, outcome);
    if (outcome.deathSave) break;
  }

  await actor.update({ 'system.health.value': Math.max(0, health - remaining) });
  return outcome;
}

/**
 * One Wound: roll its column, then check whether it was the last one you had.
 * XIII: "When you have taken Wounds equal to your Maximum, you make a Death Save."
 */
export async function takeWound(actor, damageType, outcome = {}) {
  const wounds = actor.system.wounds;
  const next = wounds.value + 1;
  await actor.update({ 'system.wounds.value': Math.min(next, wounds.max) });
  outcome.rolledWounds = (outcome.rolledWounds ?? 0) + 1;

  const tableName = MARROW.tables.wounds[damageType] ?? MARROW.tables.wounds.bluntForce;
  const draw = await drawSystemTable(tableName, actor);

  // XIII's rows state their consequences in words -- "Bleeding +2", "Minimum Stress +1",
  // "-1d10 Strength". Do what the row says rather than leaving it for someone to notice.
  const text = draw?.results?.[0]?.description ?? draw?.results?.[0]?.text ?? '';
  const effects = await applyResultEffects(actor, text, { source: tableName, recordInjury: true });
  outcome.effects = effects;

  if (next >= wounds.max || effects.deathSave) {
    outcome.deathSave = true;
    await deathSave(actor);
  }
  return outcome;
}

/**
 * XIII.2. The Warden rolls it face down and it "is revealed only when somebody spends a
 * turn checking your body, and not before" -- so the draw is made blind, to the GM only.
 */
export async function deathSave(actor) {
  const table = await resolveTable(MARROW.tables.death);
  if (!table) {
    ui.notifications?.warn(game.i18n.format('MARROW.Table.Missing', { name: MARROW.tables.death }));
    return null;
  }
  const draw = await table.roll();
  const result = draw.results[0];

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: await foundry.applications.handlebars.renderTemplate(
      'systems/marrow/templates/chat/death.hbs',
      { actor, text: result?.description ?? result?.text ?? '' },
    ),
    rolls: [draw.roll],
    whisper: ChatMessage.getWhisperRecipients('GM'),
    blind: true,
    flags: { marrow: { deathSave: true } },
  });

  // The players are told a Death Save happened, and nothing else.
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="marrow chat-card death-pending">${
      game.i18n.format('MARROW.Death.FaceDown', { name: actor.name })}</div>`,
  });

  return result;
}

/**
 * XII.5, XII.6: armour, shield and cover are all destroyed the same way -- outright, by one
 * hit that meets or beats their Armor Points. There is no wearing-down and no hit points;
 * VIII.3's Repair paragraph is what brings it back, in two steps.
 */
export async function destroyArmor(actor) {
  const updates = actor.items
    .filter(i => i.type === 'armor' && i.system.equipped
                 && i.system.state !== 'destroyed' && i.system.effectiveAP > 0)
    .map(i => ({ _id: i.id, 'system.state': 'destroyed' }));
  if (updates.length) {
    await actor.updateEmbeddedDocuments('Item', updates);
    ui.notifications?.info(game.i18n.format('MARROW.Armor.Destroyed', {
      name: actor.name, n: updates.length,
    }));
  }
  return updates.length;
}

/**
 * XIII.1. Called once per round for each actor that is Bleeding. Bleeding is cumulative and
 * ignores armour and DR, so it goes straight into Health.
 */
export async function tickBleeding(actor) {
  const bleeding = actor.system.bleeding ?? 0;
  if (bleeding <= 0) return null;
  return applyDamage(actor, bleeding, { damageType: 'bleeding', ignoreArmor: true });
}

/* -------------------------------------------------------------------------- */
/*  Applying damage from the chat card, with an Undo                          */
/* -------------------------------------------------------------------------- */

/** Everything applyDamage (and the Wound/Condition effects it triggers) can change. */
function snapshotVitals(actor) {
  const s = actor.system;
  const vitals = {};
  if (s.health) vitals.health = { value: s.health.value, max: s.health.max };
  if (s.wounds) vitals.wounds = { value: s.wounds.value };
  if (s.stress) vitals.stress = { value: s.stress.value, base: s.stress.base };
  if (s.stats) vitals.stats = Object.fromEntries(Object.entries(s.stats).map(([k, v]) => [k, v.value]));
  if (s.saves) vitals.saves = Object.fromEntries(Object.entries(s.saves).map(([k, v]) => [k, v.value]));
  if (s.blight) vitals.blight = { value: s.blight.value, marked: s.blight.marked };

  return {
    vitals,
    armor: actor.items.filter(i => i.type === 'armor').map(i => ({ id: i.id, state: i.system.state })),
    conditions: actor.items.filter(i => i.type === 'condition')
      .map(i => ({ id: i.id, bleeding: i.system.bleeding })),
  };
}

/**
 * Put an actor back exactly how a snapshot found it: the scalar numbers, each armor's state,
 * each surviving Condition's Bleeding total, and delete whatever Conditions did not exist yet.
 */
async function restoreSnapshot(actor, { vitals, armor, conditions }) {
  const update = {};
  if (vitals.health) Object.assign(update, {
    'system.health.value': vitals.health.value, 'system.health.max': vitals.health.max,
  });
  if (vitals.wounds) update['system.wounds.value'] = vitals.wounds.value;
  if (vitals.stress) Object.assign(update, {
    'system.stress.value': vitals.stress.value, 'system.stress.base': vitals.stress.base,
  });
  for (const [k, v] of Object.entries(vitals.stats ?? {})) update[`system.stats.${k}.value`] = v;
  for (const [k, v] of Object.entries(vitals.saves ?? {})) update[`system.saves.${k}.value`] = v;
  if (vitals.blight) Object.assign(update, {
    'system.blight.value': vitals.blight.value, 'system.blight.marked': vitals.blight.marked,
  });
  if (!foundry.utils.isEmpty(update)) await actor.update(update);

  const armorUpdates = armor
    .filter(a => actor.items.get(a.id)?.system.state !== a.state)
    .map(a => ({ _id: a.id, 'system.state': a.state }));
  if (armorUpdates.length) await actor.updateEmbeddedDocuments('Item', armorUpdates);

  const keptIds = new Set(conditions.map(c => c.id));
  const conditionUpdates = conditions
    .filter(c => actor.items.get(c.id) && actor.items.get(c.id).system.bleeding !== c.bleeding)
    .map(c => ({ _id: c.id, 'system.bleeding': c.bleeding }));
  if (conditionUpdates.length) await actor.updateEmbeddedDocuments('Item', conditionUpdates);

  const createdIds = actor.items.filter(i => i.type === 'condition' && !keptIds.has(i.id)).map(i => i.id);
  if (createdIds.length) await actor.deleteEmbeddedDocuments('Item', createdIds);
}

/**
 * XII.4/XII.5's Apply button: snapshot the actor first, so a misclick -- or damage landing on
 * the wrong token -- has a way back that doesn't require reconstructing it by hand.
 */
export async function applyDamageFromChat(actor, amount, options = {}) {
  const snapshot = snapshotVitals(actor);
  const outcome = await applyDamage(actor, amount, options);

  const notes = [];
  if (outcome.armorDestroyed) notes.push(game.i18n.localize('MARROW.DamageApplied.ArmorNote'));
  if (outcome.rolledWounds > 0) {
    notes.push(game.i18n.format('MARROW.DamageApplied.WoundNote', { n: outcome.rolledWounds }));
  }

  const html = await foundry.applications.handlebars.renderTemplate(
    'systems/marrow/templates/chat/damage-applied.hbs',
    { message: game.i18n.format('MARROW.DamageApplied.Applied', { amount: outcome.applied, name: actor.name }), notes },
  );

  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: html,
    flags: { marrow: { undo: { actorUuid: actor.uuid, snapshot } } },
  });
}

/**
 * XVII.2's Mending. Health only -- "you may instead close one Wound" at Blight 5+ is a
 * choice XVII.2 leaves to the caster, not something to decide on their behalf, so closing a
 * Wound stays a manual edit on the sheet.
 */
export async function applyHealing(actor, amount) {
  const s = actor.system;
  if (!s.health) return { healed: 0 };
  const healed = Math.min(amount, s.health.max - s.health.value);
  if (healed > 0) await actor.update({ 'system.health.value': s.health.value + healed });
  return { healed };
}

/** Mending's Apply button: heals, then charges the Blight XVII.2 asks of the patient. */
export async function applyHealingFromChat(actor, amount, { blightOnApply = 0 } = {}) {
  const snapshot = snapshotVitals(actor);
  const { healed } = await applyHealing(actor, amount);
  if (blightOnApply > 0 && actor.system.blight) {
    await applyConsequences(actor, { stress: 0, blight: blightOnApply, panic: false, notes: [] });
  }

  const html = await foundry.applications.handlebars.renderTemplate(
    'systems/marrow/templates/chat/damage-applied.hbs',
    { message: game.i18n.format('MARROW.DamageApplied.Healed', { amount: healed, name: actor.name }) },
  );

  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: html,
    flags: { marrow: { undo: { actorUuid: actor.uuid, snapshot } } },
  });
}

/** Reverses one applyDamageFromChat or applyHealingFromChat, from the snapshot its own message carries. */
export async function undoDamageApplication(message) {
  const data = message.getFlag('marrow', 'undo');
  if (!data || data.undone) return;

  const actor = await fromUuid(data.actorUuid);
  if (!actor) {
    ui.notifications?.warn(game.i18n.localize('MARROW.DamageApplied.UndoMissingActor'));
    return;
  }
  await restoreSnapshot(actor, data.snapshot);

  const html = await foundry.applications.handlebars.renderTemplate(
    'systems/marrow/templates/chat/damage-applied.hbs',
    { message: game.i18n.format('MARROW.DamageApplied.UndoneNote', { name: actor.name }), undone: true },
  );
  await message.update({ content: html, 'flags.marrow.undo.undone': true });
}
