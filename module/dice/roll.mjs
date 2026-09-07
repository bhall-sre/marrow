import { MARROW } from '../config.mjs';

/**
 * MARROW's dice, in one place.
 *
 * Every resolution in the game is one of three things:
 *   - a d100 rolled UNDER a target        (Stat Checks, Saves, Combat Checks -- X.1, X.2)
 *   - a d20 rolled OVER current Stress    (Panic -- XI.2)
 *   - a damage or table roll              (XII.4, XIII)
 *
 * Advantage and Disadvantage are always "roll twice, keep the better/worse" and always
 * cancel (X.3). Criticals are always doubles (X.4).
 */

/** X.3 */
export const ADVANTAGE = 'advantage';
export const DISADVANTAGE = 'disadvantage';

/**
 * Net one Advantage/Disadvantage from any number of sources. X.3: "They cancel each
 * other out." Two sources of Advantage do not stack into anything more than Advantage --
 * MARROW has no stacking, so this reduces to a sign.
 * @param {Array<'advantage'|'disadvantage'|null|undefined>} sources
 */
export function netAdvantage(sources = []) {
  let n = 0;
  for (const s of sources) {
    if (s === ADVANTAGE) n += 1;
    else if (s === DISADVANTAGE) n -= 1;
  }
  return n > 0 ? ADVANTAGE : n < 0 ? DISADVANTAGE : null;
}

/**
 * X.4: "Roll doubles on 1d100 and the result is a Critical." 00 is always a Critical
 * Success, 99 always a Critical Failure -- both of which fall out of the doubles rule and
 * the 90-99 rule below, but are stated explicitly so the intent survives a refactor.
 */
export function isDoubles(total) {
  return total % 11 === 0;   // 00, 11, 22 ... 99
}

/**
 * X.1/X.2: "Roll under and you succeed. A roll of 90 to 99 always fails, however high
 * your Stat."
 */
export function isSuccess(total, target) {
  if (total >= 90) return false;
  return total < target;
}

/**
 * Roll a d100 under a target, honouring Advantage/Disadvantage.
 * @param {number} target
 * @param {'advantage'|'disadvantage'|null} advantage
 * @returns {Promise<{roll: Roll, total: number, success: boolean, critical: boolean,
 *                    outcome: string, kept: number[], target: number}>}
 */
export async function rollUnder(target, advantage = null) {
  // Rolling under means the LOWER die is the better one.
  const formula = advantage === ADVANTAGE ? '{1d100, 1d100}kl'
    : advantage === DISADVANTAGE ? '{1d100, 1d100}kh'
    : '1d100';

  const roll = await new Roll(formula).evaluate();
  // d100 in Foundry yields 1-100; MARROW reads 00-99, so 100 is 00.
  const total = roll.total % 100;

  const success = isSuccess(total, target);
  const critical = isDoubles(total);

  return {
    roll, total, target, success, critical, advantage,
    outcome: critical ? (success ? 'criticalSuccess' : 'criticalFailure')
                      : (success ? 'success' : 'failure'),
  };
}

/**
 * XI.2: "Roll 1d20 and try to roll higher than your current Stress. Roll equal or under
 * and you fail." Note this one is roll-OVER, and the only d20 in the game.
 */
export async function rollPanic(stress, advantage = null) {
  const formula = advantage === ADVANTAGE ? '{1d20, 1d20}kh'
    : advantage === DISADVANTAGE ? '{1d20, 1d20}kl'
    : '1d20';
  const roll = await new Roll(formula).evaluate();
  return {
    roll,
    total: roll.total,
    stress,
    // "Roll equal or under and you fail"
    success: roll.total > stress,
  };
}

/**
 * XI.1 Rest: "Make a Rest Save using your worst Save. On a success, reduce Stress by the
 * ones digit of the roll."
 */
export function onesDigit(total) {
  return total % 10;
}

/**
 * Assemble every source of Advantage/Disadvantage that applies to one Check, so the
 * reasons can be shown to the player rather than silently folded into a die.
 * @returns {{net: string|null, reasons: Array<{source: string, effect: string}>}}
 */
export function gatherAdvantage(sources) {
  const reasons = sources.filter(s => s && s.effect);
  return {
    net: netAdvantage(reasons.map(r => r.effect)),
    reasons,
  };
}

/**
 * VIII.1, as a source. The attacker's weapon type against the defender's armour kind.
 */
export function armorMatchupSource(weapon, defenderArmorKind) {
  if (!weapon || !defenderArmorKind) return null;
  const effect = MARROW.matchupFor(weapon.system.damageType, defenderArmorKind);
  if (!effect) return null;
  const kindLabel = MARROW.armorKinds[defenderArmorKind]?.label ?? defenderArmorKind;
  return {
    source: `${weapon.system.damageTypeLabel} vs ${kindLabel}`,
    effect,
  };
}
