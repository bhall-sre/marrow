import { MARROW } from './config.mjs';
import { CharacterData } from './data/character.mjs';
import { CompanionData } from './data/companion.mjs';
import { CreatureData } from './data/creature.mjs';
import {
  SkillData, WeaponData, ArmorData, GearData, ClassData, WorkingData, ConditionData,
} from './data/items.mjs';
import { MarrowActor } from './documents/actor.mjs';
import { MarrowItem } from './documents/item.mjs';
import { MarrowCharacterSheet } from './sheets/character-sheet.mjs';
import { MarrowCompanionSheet } from './sheets/companion-sheet.mjs';
import { MarrowCreatureSheet } from './sheets/creature-sheet.mjs';
import { MarrowItemSheet } from './sheets/item-sheet.mjs';
import { registerHelpers, preloadTemplates } from './helpers.mjs';
import { registerSettings } from './settings.mjs';
import {
  applyDamageFromChat, applyHealingFromChat, undoDamageApplication,
  checkTheBody, stabilizeDeathClock, tickDeathClock,
} from './dice/damage.mjs';
import { CharacterCreation, registerCreationButton } from './apps/creation.mjs';

Hooks.once('init', () => {
  console.log('MARROW | The ground is working on you.');

  CONFIG.MARROW = MARROW;

  // A wheel broken at the hub (VII, Crest 03), turning while the table is away.
  CONFIG.controlIcons.pause = 'systems/marrow/images/ui/pause.svg';

  // XI.3, XIII.1: a Condition item is easy to miss on a sheet nobody has open. The token
  // itself carries the icon so it reads at a glance on the canvas.
  CONFIG.statusEffects.push(
    { id: 'marrow-bleeding', name: 'MARROW.Bleeding', img: 'icons/svg/blood.svg' },
    { id: 'marrow-condition', name: 'MARROW.ConditionStatus', img: 'icons/svg/daze.svg' },
  );

  // `@Check[key]{Label}` and `@Check[key|fail:Condition Name]{Label}`, anywhere Foundry
  // enriches text: a chat card, an actor's notes, a Condition's own description. Clicking
  // it rolls the Check directly (no dialog -- this is something happening TO the reader,
  // not a choice they are making) for whoever's own character is clicking.
  CONFIG.TextEditor.enrichers.push({
    pattern: /@Check\[(\w+)(?:\|fail:([^\]]+))?\]\{([^}]+)\}/g,
    enricher: async (match) => {
      const [, key, failCondition, label] = match;
      const a = document.createElement('a');
      a.className = 'marrow-check-link';
      a.dataset.key = key;
      if (failCondition) a.dataset.failCondition = failCondition;
      a.innerHTML = `<i class="fa-solid fa-dice-d10"></i> ${label}`;
      return a;
    },
  });

  CONFIG.Actor.documentClass = MarrowActor;
  CONFIG.Item.documentClass = MarrowItem;

  CONFIG.Actor.dataModels = {
    character: CharacterData,
    companion: CompanionData,
    creature: CreatureData,
  };
  CONFIG.Item.dataModels = {
    skill: SkillData,
    weapon: WeaponData,
    armor: ArmorData,
    gear: GearData,
    class: ClassData,
    working: WorkingData,
    condition: ConditionData,
  };

  // XI: Stress is the second bar because it is the one that decides how a scene ends.
  CONFIG.Actor.trackableAttributes = {
    character: { bar: ['health', 'stress'], value: ['wounds.value', 'blight.value', 'armor.points'] },
    companion: { bar: ['wounds'], value: ['combat.total', 'instinct.total', 'loyalty.total'] },
    creature: { bar: ['health', 'wounds'], value: ['combat.total', 'instinct.total', 'armor.points'] },
  };

  // I: character creation is its own application, reachable from the Actors directory.
  CONFIG.MARROW.CharacterCreation = CharacterCreation;
  registerCreationButton();

  registerSheets();
  registerSettings();
  registerHelpers();

  return preloadTemplates();
});

function registerSheets() {
  const actors = foundry.documents.collections.Actors;
  const items = foundry.documents.collections.Items;

  actors.unregisterSheet('core', foundry.appv1.sheets.ActorSheet);
  actors.registerSheet('marrow', MarrowCharacterSheet, {
    types: ['character'], makeDefault: true, label: 'MARROW.Sheet.Character',
  });
  actors.registerSheet('marrow', MarrowCompanionSheet, {
    types: ['companion'], makeDefault: true, label: 'MARROW.Sheet.Companion',
  });
  actors.registerSheet('marrow', MarrowCreatureSheet, {
    types: ['creature'], makeDefault: true, label: 'MARROW.Sheet.Creature',
  });

  items.unregisterSheet('core', foundry.appv1.sheets.ItemSheet);
  items.registerSheet('marrow', MarrowItemSheet, {
    makeDefault: true, label: 'MARROW.Sheet.Item',
  });
}

/* -------------------------------------------------------------------------- */

/**
 * XII.4/XII.5: damage is posted with buttons rather than applied on its own, because who it
 * lands on -- and whether their armour survives it -- is a decision the Warden makes.
 */
/**
 * The roll recorded who it actually landed on. Falling back to whatever is selected on the
 * canvas is only for older messages rolled before that was tracked -- otherwise applying
 * damage or healing after re-selecting your own token hits you, not the target.
 */
async function resolveApplyTargets(targetUuid) {
  if (targetUuid) {
    const target = await fromUuid(targetUuid);
    return target ? [target] : [];
  }
  return canvas.tokens.controlled.map(t => t.actor).filter(Boolean);
}

Hooks.on('renderChatMessageHTML', (message, html) => {
  for (const button of html.querySelectorAll('[data-action="applyDamage"]')) {
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      const { amount, damageType, antiArmor, ignoreArmor, targetUuid } = button.dataset;

      const targets = await resolveApplyTargets(targetUuid);
      if (!targets.length) {
        ui.notifications.warn(game.i18n.localize('MARROW.SelectATarget'));
        return;
      }

      button.disabled = true;
      for (const actor of targets) {
        await applyDamageFromChat(actor, Number(amount), {
          damageType,
          antiArmor: antiArmor === 'true',
          ignoreArmor: ignoreArmor === 'true',
        });
      }
    });
  }

  for (const button of html.querySelectorAll('[data-action="applyHealing"]')) {
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      const { amount, mendingSave, targetUuid } = button.dataset;

      const targets = await resolveApplyTargets(targetUuid);
      if (!targets.length) {
        ui.notifications.warn(game.i18n.localize('MARROW.SelectATarget'));
        return;
      }

      button.disabled = true;
      for (const actor of targets) {
        await applyHealingFromChat(actor, Number(amount), { mendingSave: mendingSave === 'true' });
      }
    });
  }

  for (const button of html.querySelectorAll('[data-action="undoDamage"]')) {
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      await undoDamageApplication(message);
    });
  }

  // XIII.2's "Check the Body", and the clock XIII's Lethal (and the Death Save table's own
  // "dying" result) put on an actor -- each button names its actor directly, since these can
  // sit in chat for many rounds and the token that was selected when they were posted may no
  // longer be.
  for (const button of html.querySelectorAll('[data-action="checkTheBody"]')) {
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      const actor = await fromUuid(button.dataset.actorUuid);
      if (!actor) return;
      button.disabled = true;
      await checkTheBody(actor);
    });
  }

  for (const button of html.querySelectorAll('[data-action="stabilizeDeathClock"]')) {
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      const actor = await fromUuid(button.dataset.actorUuid);
      if (!actor) return;
      button.disabled = true;
      await stabilizeDeathClock(actor);
    });
  }

  for (const button of html.querySelectorAll('[data-action="tickDeathClock"]')) {
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      const actor = await fromUuid(button.dataset.actorUuid);
      if (!actor) return;
      button.disabled = true;
      await tickDeathClock(actor);
    });
  }
});

/**
 * XI.3, XIII.1: a Condition item is easy to miss on a sheet nobody has open, so its token
 * carries a matching status icon too -- Bleeding gets its own so the running total's danger
 * is visible without opening the sheet, everything else shares one generic icon.
 */
async function syncConditionStatus(actor) {
  if (!actor) return;
  const bleeding = (actor.system.bleeding ?? 0) > 0;
  const other = actor.items.some(i => i.type === 'condition' && !(i.system.bleeding > 0));
  await actor.toggleStatusEffect('marrow-bleeding', { active: bleeding });
  await actor.toggleStatusEffect('marrow-condition', { active: other });
}

for (const hook of ['createItem', 'updateItem', 'deleteItem']) {
  Hooks.on(hook, (item) => {
    if (item.type === 'condition') syncConditionStatus(item.actor);
  });
}

/**
 * XVII: "Anyone with a Blight Level of 1 or higher may attempt a Working. You do not need
 * training." Unlike a Skill, a Working is not something you choose to learn -- every
 * Blighted actor can attempt all seven the moment they cross into Blight 1, so the sheet
 * grants them automatically rather than making anyone drag seven items over one at a time.
 * Losing every point of Blight (rare, but XVI.4 allows it) takes them back out again.
 */
async function syncWorkings(actor) {
  if (!actor || actor.system.blight === undefined) return;

  if (actor.system.blight.value >= 1) {
    const pack = game.packs.get('marrow.workings');
    if (!pack) return;
    await pack.getIndex();

    const held = new Set(actor.items.filter(i => i.type === 'working').map(i => i.name));
    const toAdd = [];
    for (const entry of pack.index) {
      if (held.has(entry.name)) continue;
      const doc = await pack.getDocument(entry._id);
      toAdd.push(doc.toObject());
    }
    if (toAdd.length) await actor.createEmbeddedDocuments('Item', toAdd);
  } else {
    const ids = actor.items.filter(i => i.type === 'working').map(i => i.id);
    if (ids.length) await actor.deleteEmbeddedDocuments('Item', ids);
  }
}

Hooks.on('updateActor', (actor, changes) => {
  if (foundry.utils.hasProperty(changes, 'system.blight.value')) syncWorkings(actor);
});
// The creation wizard can hand a Blighted class its starting Blight at creation itself
// (Actor.create with the value already in system data), which updateActor never sees.
Hooks.on('createActor', (actor) => syncWorkings(actor));

/**
 * XIII.1: "you take 1 damage every round until it is stopped." Bleeding is the one thing in
 * MARROW that happens to you without anybody rolling, so the tracker does it.
 */
Hooks.on('combatTurnChange', async (combat, prior, current) => {
  if (!game.user.isActiveGM) return;

  const combatant = combat.combatants.get(current.combatantId);
  const actor = combatant?.actor;
  if (!actor) return;

  if (game.settings.get('marrow', 'autoBleed') && actor.system.bleeding > 0) {
    await actor.tickBleeding();
  }
  // XIII's Lethal clock and the Death Save table's own "dying" clock tick once at the start
  // of the actor's own turn, the same timing autoBleed already uses -- a GM running without
  // a combat encounter ticks these by hand instead, from the clock card's own button.
  if (actor.getFlag('marrow', 'deathClock')) await tickDeathClock(actor);
});

/**
 * Resolve who clicked: their own assigned character first, falling back to a token they
 * have selected. Not the message's speaker -- the Keening's card is posted by the carcinid
 * that sang it, but it is the reader's own Sanity Save.
 */
function actingActor() {
  return game.user.character ?? canvas.tokens?.controlled.find(t => t.actor)?.actor ?? null;
}

/**
 * A Condition applied by name rather than by reference, so `@Check[...|fail:Name]` can
 * point at whatever the Warden already built -- a world item, or one sitting in any Item
 * compendium -- without the system needing to know which. Skips it if the actor already
 * has one by that name rather than stacking duplicates.
 */
async function applyConditionByName(actor, name) {
  if (actor.items.some(i => i.type === 'condition' && i.name === name)) return null;

  let template = game.items?.find(i => i.type === 'condition' && i.name === name) ?? null;
  for (const pack of game.packs) {
    if (template || pack.documentName !== 'Item') continue;
    await pack.getIndex();
    const entry = pack.index.find(e => e.name === name && (!e.type || e.type === 'condition'));
    if (entry) template = await pack.getDocument(entry._id);
  }
  if (!template) {
    ui.notifications?.warn(game.i18n.format('MARROW.Table.Missing', { name }));
    return null;
  }
  return actor.createEmbeddedDocuments('Item', [template.toObject()]);
}

async function onCheckLinkClick(event) {
  const link = event.target.closest('.marrow-check-link');
  if (!link) return;
  event.preventDefault();

  const actor = actingActor();
  if (!actor) {
    ui.notifications?.warn(game.i18n.localize('MARROW.NoActorToRoll'));
    return;
  }

  const result = await actor.rollCheck(link.dataset.key);
  if (!result.success && link.dataset.failCondition) {
    await applyConditionByName(actor, link.dataset.failCondition);
  }
}

Hooks.once('ready', () => {
  console.log(`MARROW | ${game.system.version} ready.`);
  // Delegated once on the document rather than per-message: @Check[] can land in a chat
  // card, an actor's notes, or a journal page, and re-binding a listener every place
  // enriched text gets inserted would mean finding every one of those places twice.
  document.body.addEventListener('click', onCheckLinkClick);
});
