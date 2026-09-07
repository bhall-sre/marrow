import { MARROW } from '../config.mjs';
import { drawSystemTable, resolveTable } from './check.mjs';

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
  await drawSystemTable(tableName, actor);

  if (next >= wounds.max) {
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

/** XII.5, XII.6: armour, shield and cover are all destroyed the same way. */
export async function destroyArmor(actor) {
  const updates = actor.items
    .filter(i => i.type === 'armor' && i.system.equipped && !i.system.destroyed && i.system.armorPoints > 0)
    .map(i => ({ _id: i.id, 'system.destroyed': true }));
  if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
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
