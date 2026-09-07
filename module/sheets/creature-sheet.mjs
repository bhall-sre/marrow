import { MarrowActorSheet } from './actor-sheet.mjs';
import { MARROW } from '../config.mjs';

/**
 * The Creature sheet: Health, Wounds, Combat, Instinct, whatever it carries, and a
 * description. See creature.mjs for why the stat block stops there.
 */
export class MarrowCreatureSheet extends MarrowActorSheet {
  static DEFAULT_OPTIONS = {
    classes: ['marrow', 'sheet', 'actor', 'creature'],
    position: { width: 640, height: 700 },
  };

  static PARTS = {
    header:    { template: 'systems/marrow/templates/actor/creature-header.hbs' },
    resources: { template: 'systems/marrow/templates/actor/creature-resources.hbs' },
    numbers:   { template: 'systems/marrow/templates/actor/creature-numbers.hbs' },
    nav:       { template: 'systems/marrow/templates/actor/nav.hbs' },
    body:      { template: 'systems/marrow/templates/actor/creature-body.hbs' },
  };

  static TABS = {
    arms:  { label: 'MARROW.Tab.Arms',  icon: 'fa-solid fa-hammer' },
    notes: { label: 'MARROW.Tab.Notes', icon: 'fa-solid fa-feather' },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const s = this.document.system;

    context.armorKindLabel = MARROW.armorKinds[s.armor.kind]?.label ?? '';

    context.enrichedBiography = await foundry.applications.ux.TextEditor.implementation
      .enrichHTML(s.biography, { relativeTo: this.document });
    context.enrichedNotes = await foundry.applications.ux.TextEditor.implementation
      .enrichHTML(s.notes, { relativeTo: this.document });

    return context;
  }
}
