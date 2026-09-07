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
import { applyDamageFromChat, undoDamageApplication } from './dice/damage.mjs';
import { CharacterCreation, registerCreationButton } from './apps/creation.mjs';

Hooks.once('init', () => {
  console.log('MARROW | The ground is working on you.');

  CONFIG.MARROW = MARROW;

  // A wheel broken at the hub (VII, Crest 03), turning while the table is away.
  CONFIG.controlIcons.pause = 'systems/marrow/images/ui/pause.svg';

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
Hooks.on('renderChatMessageHTML', (message, html) => {
  for (const button of html.querySelectorAll('[data-action="applyDamage"]')) {
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      const { amount, damageType, antiArmor, ignoreArmor, targetUuid } = button.dataset;

      // The attack roll recorded who it actually landed on. Falling back to whatever is
      // selected on the canvas is only for older messages rolled before that was tracked --
      // otherwise applying damage after re-selecting your own token hits you, not the target.
      let targets;
      if (targetUuid) {
        const target = await fromUuid(targetUuid);
        targets = target ? [target] : [];
      } else {
        targets = canvas.tokens.controlled.map(t => t.actor).filter(Boolean);
      }
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

  for (const button of html.querySelectorAll('[data-action="undoDamage"]')) {
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      await undoDamageApplication(message);
    });
  }
});

/**
 * XIII.1: "you take 1 damage every round until it is stopped." Bleeding is the one thing in
 * MARROW that happens to you without anybody rolling, so the tracker does it.
 */
Hooks.on('combatTurnChange', async (combat, prior, current) => {
  if (!game.user.isActiveGM) return;
  if (!game.settings.get('marrow', 'autoBleed')) return;

  const combatant = combat.combatants.get(current.combatantId);
  const actor = combatant?.actor;
  if (!actor || !(actor.system.bleeding > 0)) return;

  await actor.tickBleeding();
});

Hooks.once('ready', () => {
  console.log(`MARROW | ${game.system.version} ready.`);
});
