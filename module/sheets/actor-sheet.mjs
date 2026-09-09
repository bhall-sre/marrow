import { MARROW } from '../config.mjs';

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/**
 * What the character and retainer sheets have in common: rolling a number, opening and
 * deleting owned items, equipping things, and the drag-and-drop that puts them there.
 *
 * Both sheets are the same shape -- a header, a strip of resources, the numbers you roll
 * under, and a tabbed body -- so the arrangement lives here and each subclass supplies only
 * its own parts and its own context.
 */
export class MarrowActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ['marrow', 'sheet', 'actor'],
    position: { width: 780, height: 860 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      roll: MarrowActorSheet.#onRoll,
      rollItem: MarrowActorSheet.#onRollItem,
      editItem: MarrowActorSheet.#onEditItem,
      deleteItem: MarrowActorSheet.#onDeleteItem,
      createItem: MarrowActorSheet.#onCreateItem,
      toggleEquipped: MarrowActorSheet.#onToggleEquipped,
      identifyItem: MarrowActorSheet.#onIdentifyItem,
      rest: MarrowActorSheet.#onRest,
      panic: MarrowActorSheet.#onPanic,
      blightExposure: MarrowActorSheet.#onBlightExposure,
      adjust: MarrowActorSheet.#onAdjust,
      selectTab: MarrowActorSheet.#onSelectTab,
      generate: MarrowActorSheet.#onGenerate,
    },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.document;

    Object.assign(context, {
      actor,
      system: actor.system,
      MARROW,
      editable: this.isEditable,
      // Item lists, sorted once here so the templates stay declarative.
      items: this.#partitionItems(actor),
      tabs: this.#tabs(),
      activeTab: this.activeTab,
    });
    return context;
  }

  /** Group owned items by the section of the sheet they belong on. */
  #partitionItems(actor) {
    const out = { skill: [], weapon: [], armor: [], gear: [], working: [], condition: [], class: [] };
    for (const item of actor.items) {
      if (out[item.type]) out[item.type].push(item);
    }
    for (const list of Object.values(out)) list.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));

    // IX vs XVIII.2 vs VI vs VII: gear is one Item type with four faces on the sheet.
    out.gearByCategory = {
      gear: out.gear.filter(i => i.system.category === 'gear'),
      treatment: out.gear.filter(i => i.system.category === 'treatment'),
      trinket: out.gear.filter(i => i.system.category === 'trinket'),
      crest: out.gear.filter(i => i.system.category === 'crest'),
    };
    return out;
  }

  /**
   * Tabs are handled here rather than through the framework's own tab support, so that the
   * sheet keeps working unchanged across Foundry's revisions of that API. It is a single
   * string and one re-render.
   */
  get activeTab() {
    return this.#activeTab ??= Object.keys(this.constructor.TABS ?? {})[0];
  }

  #activeTab;

  #tabs() {
    const active = this.activeTab;
    return Object.entries(this.constructor.TABS ?? {}).map(([id, tab]) => ({
      ...tab, id, active: id === active,
    }));
  }

  /** I, the nine steps, run against this character rather than a new one. */
  static async #onGenerate() {
    const { CharacterCreation } = await import('../apps/creation.mjs');
    return new CharacterCreation({ actor: this.document }).render(true);
  }

  static async #onSelectTab(event, target) {
    this.#activeTab = target.dataset.tab;
    await this.render({ parts: ['nav', 'body'] });
  }

  /* --- Actions --------------------------------------------------------------- */

  /**
   * Every rollable label on the sheet routes here; `data-key` says which number.
   * Shift-clicking rolls it straight, without asking about Skills or [+]/[-].
   */
  static async #onRoll(event, target) {
    const key = target.dataset.key;
    if (!key) return;
    if (event.shiftKey) return this.document.rollCheck(key);
    const { CheckDialog } = await import('../apps/check-dialog.mjs');
    return CheckDialog.prompt(this.document, { key });
  }

  static async #onRollItem(event, target) {
    return this.#item(target)?.roll();
  }

  static async #onEditItem(event, target) {
    return this.#item(target)?.sheet.render(true);
  }

  static async #onDeleteItem(event, target) {
    const item = this.#item(target);
    if (!item) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.format('MARROW.Dialog.DeleteTitle', { name: item.name }) },
      content: `<p>${game.i18n.format('MARROW.Dialog.DeleteBody', { name: item.name })}</p>`,
    });
    if (confirmed) await item.delete();
  }

  static async #onCreateItem(event, target) {
    const type = target.dataset.type;
    const data = { name: game.i18n.format('MARROW.New', {
      type: game.i18n.localize(`TYPES.Item.${type}`),
    }), type };
    if (target.dataset.category) data.system = { category: target.dataset.category };
    return this.document.createEmbeddedDocuments('Item', [data]);
  }

  static async #onToggleEquipped(event, target) {
    const item = this.#item(target);
    if (!item) return;
    return item.update({ 'system.equipped': !item.system.equipped });
  }

  /** The Warden's one-click reveal, without opening the item's own sheet for it. */
  static async #onIdentifyItem(event, target) {
    const item = this.#item(target);
    if (!item) return;
    return item.update({ 'system.identified': true });
  }

  /** XI.1 */
  static async #onRest() {
    return this.document.rollRest();
  }

  /** XI.2 */
  static async #onPanic() {
    return this.document.rollPanic();
  }

  /** XVI.3 */
  static async #onBlightExposure(event, target) {
    return this.document.rollBlightExposure(target.dataset.ground ?? 'tainted');
  }

  /** The +/- buttons beside Health, Stress, Wounds and the Blight. */
  static async #onAdjust(event, target) {
    const path = target.dataset.path;
    const by = Number(target.dataset.by ?? 1);
    const current = foundry.utils.getProperty(this.document, path) ?? 0;
    return this.document.update({ [path]: current + by });
  }

  #item(target) {
    const id = target.closest('[data-item-id]')?.dataset.itemId;
    return id ? this.document.items.get(id) : null;
  }

  /* --- Drop handling --------------------------------------------------------- */

  /**
   * II.3: dropping a Class onto a character applies its adjustments rather than merely
   * filing the Item away, which is the whole reason a Class is an Item at all.
   */
  async _onDropItem(event, data) {
    const item = await Item.implementation.fromDropData(data);
    if (item?.type === 'class' && this.document.type === 'character') {
      const { ClassChoiceDialog } = await import('../apps/class-choice-dialog.mjs');
      return ClassChoiceDialog.apply(this.document, item);
    }
    return super._onDropItem(event, data);
  }
}
