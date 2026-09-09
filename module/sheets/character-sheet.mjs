import { MarrowActorSheet } from './actor-sheet.mjs';
import { MARROW } from '../config.mjs';
import { safeEnrich } from '../helpers.mjs';

/**
 * The character sheet.
 *
 * The arrangement, top to bottom:
 *   header     -- portrait, name, class, pronouns, silver, Tally (I.9)
 *   resources  -- Health, Wounds, Stress, the Blight, Armor (I.4, XI, XVI, XII.5)
 *   numbers    -- the four Stats and three Saves you roll under (I.1, I.2)
 *   body       -- tabbed: Skills, Arms, Gear, Workings, Notes
 */
export class MarrowCharacterSheet extends MarrowActorSheet {
  static DEFAULT_OPTIONS = {
    classes: ['marrow', 'sheet', 'actor', 'character'],
  };

  static PARTS = {
    header:    { template: 'systems/marrow/templates/actor/header.hbs' },
    resources: { template: 'systems/marrow/templates/actor/resources.hbs' },
    numbers:   { template: 'systems/marrow/templates/actor/numbers.hbs' },
    nav:       { template: 'systems/marrow/templates/actor/nav.hbs' },
    body:      { template: 'systems/marrow/templates/actor/body.hbs' },
  };

  static TABS = {
    skills:   { label: 'MARROW.Tab.Skills',   icon: 'fa-solid fa-scroll' },
    arms:     { label: 'MARROW.Tab.Arms',     icon: 'fa-solid fa-hammer' },
    gear:     { label: 'MARROW.Tab.Gear',     icon: 'fa-solid fa-sack' },
    workings: { label: 'MARROW.Tab.Workings', icon: 'fa-solid fa-eye' },
    notes:    { label: 'MARROW.Tab.Notes',    icon: 'fa-solid fa-feather' },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const s = this.document.system;

    // XVI.1's four bands, so the sheet can say which one you are in rather than making the
    // player compare a number against a table.
    context.blightBand = {
      key: s.blight.band,
      label: game.i18n.localize(`MARROW.Blight.Band.${s.blight.band}`),
      note: game.i18n.localize(`MARROW.Blight.Note.${s.blight.band}`),
    };

    // XVII: "Anyone with a Blight Level of 1 or higher may attempt a Working."
    context.canWork = s.blight.value >= 1;

    // XI.1: Rest uses your worst Save, which the Blight can change from session to session.
    context.worstSave = game.i18n.localize(
      `MARROW.Save.${this.document.worstSave().capitalize()}`,
    );

    context.armorKindLabel = MARROW.armorKinds[s.armor.kind]?.label ?? '';

    context.enrichedBiography = await safeEnrich(s.biography, { relativeTo: this.document });
    context.enrichedNotes = await safeEnrich(s.notes, { relativeTo: this.document });

    return context;
  }
}
