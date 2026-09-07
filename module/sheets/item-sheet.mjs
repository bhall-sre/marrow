import { MARROW } from '../config.mjs';

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * One sheet for all seven Item types.
 *
 * Every MARROW item is a short list of numbers plus a description, so seven near-identical
 * sheet classes would be seven places to fix the same bug. The body template branches on
 * type instead.
 */
export class MarrowItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ['marrow', 'sheet', 'item'],
    position: { width: 560, height: 620 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      rollTable: MarrowItemSheet.#onRollTable,
    },
  };

  static PARTS = {
    header: { template: 'systems/marrow/templates/item/header.hbs' },
    body:   { template: 'systems/marrow/templates/item/body.hbs' },
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.document;

    Object.assign(context, {
      item,
      system: item.system,
      MARROW,
      editable: this.isEditable,
      // The template needs a cheap way to ask "is this a weapon?" without a helper per type.
      is: Object.fromEntries(
        ['skill', 'weapon', 'armor', 'gear', 'class', 'working', 'condition']
          .map(t => [t, item.type === t]),
      ),
      matchup: item.matchupSummary,
      enrichedDescription: await foundry.applications.ux.TextEditor.implementation
        .enrichHTML(item.system.description, { relativeTo: item }),
    });

    // XVII.2: show a Working's formula with the owner's current Blight substituted in, so
    // the number on the sheet is the number the player is about to get.
    if (item.type === 'working') {
      const blight = item.actor?.system.blight?.value ?? 0;
      context.scaledFormula = item.system.scaled(blight);
      context.blight = blight;
    }

    if (item.type === 'class') {
      context.enrichedTrauma = await foundry.applications.ux.TextEditor.implementation
        .enrichHTML(item.system.traumaResponse, { relativeTo: item });
    }

    return context;
  }

  /** V, VI, VII: a Class names the tables you roll for Loadout, Trinket and Crest. */
  static async #onRollTable(event, target) {
    const { drawSystemTable } = await import('../dice/check.mjs');
    return drawSystemTable(target.dataset.table, this.document.actor);
  }
}
