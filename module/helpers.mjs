import { MARROW } from './config.mjs';

/**
 * Handlebars helpers.
 *
 * These are registered under plain names rather than prefixed ones because the templates
 * read better for it, and Handlebars lets a later registration win -- so if Foundry already
 * supplies `eq` or `concat`, these are equivalent and the templates behave the same either
 * way. The MARROW-specific ones (`scaled`, `armorLine`, `pad2`) have no core equivalent.
 */
export function registerHelpers() {
  const H = Handlebars;

  H.registerHelper('eq', (a, b) => a === b);
  H.registerHelper('gt', (a, b) => Number(a) > Number(b));

  H.registerHelper('concat', (...args) => {
    args.pop();                                   // the Handlebars options object
    return new H.SafeString(args.join(''));
  });

  /** A ternary, because Handlebars' `if` is a block helper and cannot be a subexpression. */
  H.registerHelper('pick', (condition, whenTrue, whenFalse) =>
    new H.SafeString(condition ? whenTrue : (whenFalse ?? '')));

  H.registerHelper('join', (list, separator) =>
    Array.isArray(list) ? list.join(` ${separator} `) : '');

  /** X: the dice read 00-99, so 7 is "07". */
  H.registerHelper('pad2', total => String(total ?? 0).padStart(2, '0'));

  /** XVII.2: substitute the caster's Blight Level into a Working's formula. */
  H.registerHelper('scaled', (item, blight) => item?.system?.scaled?.(blight ?? 0) ?? '');

  /** The one-line summary of a piece of armour: AP, DR, kind, and whether it survived. */
  H.registerHelper('armorLine', (item) => {
    const s = item?.system;
    if (!s) return '';
    const parts = [`AP ${s.effectiveAP}`];
    if (s.damageReduction) parts.push(`DR ${s.damageReduction}`);
    parts.push(s.kindLabel);
    if (s.state !== 'intact') parts.push(s.stateLabel);
    return new H.SafeString(parts.join(' &middot; '));
  });

  /** VIII.2's tags, paired with whether this weapon has each. */
  H.registerHelper('weaponTags', (system) =>
    MARROW.weaponTags.map(tag => ({ ...tag, on: !!system?.[tag.key] })));

  /** XX: a retainer's three rollable numbers, in the order XX lists them. */
  H.registerHelper('companionScores', (system) =>
    ['combat', 'instinct', 'loyalty'].map(key => ({
      key,
      label: system[key].label,
      value: system[key].value,
      total: system[key].total,
      penalty: system[key].penalty,
    })));
}

/** Templates that are used as partials rather than as a sheet's own parts. */
export async function preloadTemplates() {
  return foundry.applications.handlebars.loadTemplates({
    'marrow.item-row': 'systems/marrow/templates/actor/parts/item-row.hbs',
  });
}
