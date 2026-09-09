import { MARROW } from './config.mjs';

/**
 * Handlebars helpers.
 *
 * These are registered under plain names rather than prefixed ones because the templates
 * read better for it, and Handlebars lets a later registration win -- so if Foundry already
 * supplies `eq` or `concat`, these are equivalent and the templates behave the same either
 * way. The MARROW-specific ones (`scaled`, `armorLine`, `pad2`) have no core equivalent.
 */
/**
 * TextEditor.enrichHTML, but a bad match can never blank the whole field. `@Check[]` (or any
 * future custom enricher) throwing on one document's text should not cost that document its
 * entire Notes or Biography tab -- every enricher's own upstream examples (dnd5e's own
 * enrichers.mjs, for one) are explicit that a custom enricher must never let an exception
 * escape for exactly this reason, but nothing stopped the SHEET's own call to enrichHTML from
 * doing it anyway if one did. Falls back to the raw text, so the words are still there even
 * unlinked, rather than nothing at all.
 */
export async function safeEnrich(text, options) {
  try {
    return await foundry.applications.ux.TextEditor.implementation.enrichHTML(text, options);
  } catch (err) {
    console.error('MARROW | enrichHTML failed, showing raw text instead', err);
    return text ?? '';
  }
}

export function registerHelpers() {
  const H = Handlebars;

  H.registerHelper('eq', (a, b) => a === b);
  H.registerHelper('gt', (a, b) => Number(a) > Number(b));

  /**
   * Whether an unidentified item's reveal button belongs in the DOM. A helper rather than a
   * context property: item-row.hbs is invoked from inside {{#each}} loops at several
   * different nesting depths across four sheet templates, and a value handed down through
   * context would need a different number of `../` at every call site to still be reachable.
   * game.user is always there to ask, so nothing needs to be threaded through at all.
   */
  H.registerHelper('isGM', () => game.user.isGM);

  /** Whether an item's real mechanical detail should stay off the row -- true only for a
      mystery item, and only for someone who is not the Warden. */
  H.registerHelper('isHiddenMystery', (item) => !!item?.isMystery && !game.user.isGM);

  /** Foundry core supplies `checked` for checkboxes/radios but nothing for `<option>`. */
  H.registerHelper('selected', (v) => (v ? 'selected' : ''));

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

  /** A weapon's line: damage, Wound type, Range, and Ammo remaining when it uses any. */
  H.registerHelper('weaponLine', (item) => {
    const s = item?.system;
    if (!s) return '';
    const parts = [s.damage, s.damageTypeLabel, s.rangeLabel];
    if (s.usesAmmo) parts.push(`${s.ammo.value}/${s.ammo.max}`);
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
