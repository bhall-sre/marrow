import { MarrowActorSheet } from './actor-sheet.mjs';

/**
 * The Retainer sheet (XX).
 *
 * Deliberately small. A retainer has four numbers and a wage, and the sheet is meant to
 * make that obvious at a glance -- the moment it grows a Health bar and five Saves it stops
 * being a retainer and starts being a second character nobody has time to run.
 */
export class MarrowCompanionSheet extends MarrowActorSheet {
  static DEFAULT_OPTIONS = {
    classes: ['marrow', 'sheet', 'actor', 'companion'],
    position: { width: 640, height: 700 },
  };

  static PARTS = {
    header:  { template: 'systems/marrow/templates/actor/companion-header.hbs' },
    numbers: { template: 'systems/marrow/templates/actor/companion-numbers.hbs' },
    nav:     { template: 'systems/marrow/templates/actor/nav.hbs' },
    body:    { template: 'systems/marrow/templates/actor/companion-body.hbs' },
  };

  static TABS = {
    hire:  { label: 'MARROW.Tab.Hire',  icon: 'fa-solid fa-coins' },
    kit:   { label: 'MARROW.Tab.Kit',   icon: 'fa-solid fa-hammer' },
    notes: { label: 'MARROW.Tab.Notes', icon: 'fa-solid fa-feather' },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const s = this.document.system;

    context.blightBand = {
      key: s.blight.band,
      label: game.i18n.localize(`MARROW.Blight.Band.${s.blight.band}`),
    };

    // XX: "A retainer with a Motivation always fails a Loyalty Save when the two are in
    // conflict. Always." The sheet warns rather than deciding, because only the Warden can
    // say whether this particular ask is in conflict with it.
    context.hasMotivation = !!s.motivation?.trim();

    context.enrichedBiography = await foundry.applications.ux.TextEditor.implementation
      .enrichHTML(s.biography, { relativeTo: this.document });
    context.enrichedNotes = await foundry.applications.ux.TextEditor.implementation
      .enrichHTML(s.notes, { relativeTo: this.document });

    return context;
  }
}
