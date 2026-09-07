import { MARROW } from '../config.mjs';
import { MarrowCheck, panicCheck, drawSystemTable, applyConsequences } from '../dice/check.mjs';
import { applyDamage, tickBleeding } from '../dice/damage.mjs';
import { armorMatchupSource, ADVANTAGE, DISADVANTAGE } from '../dice/roll.mjs';

/**
 * The Actor document.
 *
 * Almost nothing lives here. Numbers belong to the data models, dice belong to module/dice,
 * and this class exists only to give the sheets and macros one obvious place to call.
 */
export class MarrowActor extends Actor {
  /* --- Checks ---------------------------------------------------------------- */

  /** X.1, X.2. Any Stat or Save, with an optional Skill and situational [+]/[-]. */
  async rollCheck(key, options = {}) {
    return new MarrowCheck(this, { key, ...options }).evaluate();
  }

  /**
   * XI.1 Rest. "Make a Rest Save using your worst Save." Worst means the lowest number to
   * roll under, so the Blight is taken into account before choosing.
   */
  async rollRest(options = {}) {
    const key = this.worstSave();
    return new MarrowCheck(this, {
      key,
      kind: 'rest',
      flavor: game.i18n.localize('MARROW.Roll.Rest'),
      ...options,
    }).evaluate();
  }

  worstSave() {
    const saves = this.system.saves;
    if (!saves) return 'instinct';
    return Object.keys(saves).reduce((worst, key) =>
      saves[key].total < saves[worst].total ? key : worst, Object.keys(saves)[0]);
  }

  /** XI.2. */
  async rollPanic(options = {}) {
    return panicCheck(this, options);
  }

  /* --- Violence -------------------------------------------------------------- */

  /**
   * XII.4. "Make a Combat Check, applying [+] or [-] from the kind of armor your target is
   * wearing." The matchup is VIII.1's, and it is the only thing the target contributes.
   */
  async rollAttack(weapon, options = {}) {
    const target = options.target ?? game.user.targets.first()?.actor ?? null;
    const sources = [...(options.sources ?? [])];

    const matchup = armorMatchupSource(weapon, target?.system.armor?.kind);
    if (matchup) sources.push(matchup);

    // A few weapons carry their own [+]/[-] independent of the matchup (VIII.2).
    if (weapon.system.innate) {
      sources.push({ source: weapon.name, effect: weapon.system.innate });
    }

    const result = await new MarrowCheck(this, {
      key: 'combat',
      sources,
      flavor: game.i18n.format('MARROW.Roll.AttackWith', { weapon: weapon.name }),
    }).evaluate();

    if (result.success) await this.rollWeaponDamage(weapon, { target, critical: result.critical });
    return result;
  }

  /** The damage half of XII.4, posted with a button rather than applied behind the Warden. */
  async rollWeaponDamage(weapon, { target = null, critical = false } = {}) {
    const roll = await new Roll(weapon.system.damage, this.getRollData()).evaluate();

    const html = await foundry.applications.handlebars.renderTemplate(
      'systems/marrow/templates/chat/damage.hbs',
      {
        actor: this,
        weapon,
        roll,
        total: roll.total,
        critical,
        damageType: weapon.system.damageType,
        damageTypeLabel: weapon.system.damageTypeLabel,
        antiArmor: weapon.system.antiArmor,
        targetName: target?.name ?? null,
      },
    );

    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: html,
      rolls: [roll],
      flags: {
        marrow: {
          damage: {
            amount: roll.total,
            damageType: weapon.system.damageType,
            antiArmor: weapon.system.antiArmor,
          },
        },
      },
    });
  }

  /** XII.5, XIII. */
  async applyDamage(amount, options = {}) {
    return applyDamage(this, amount, options);
  }

  /** XIII.1, once per round. */
  async tickBleeding() {
    return tickBleeding(this);
  }

  /* --- The Blight ------------------------------------------------------------ */

  /**
   * XVI.3. "At the stated interval, make a Body Save at Disadvantage. On a failure, gain 1
   * Blight." Warded gear removes the Disadvantage; nothing removes the Save.
   */
  async rollBlightExposure(ground = 'tainted') {
    const sources = [{ source: game.i18n.localize('MARROW.Blight.Exposure'), effect: DISADVANTAGE }];

    // XVI.3: "Warded gear removes the Disadvantage." Cancelling it with a matching [+] keeps
    // the reason visible in the chat card instead of silently dropping a source.
    if (this.isWarded) {
      sources.push({ source: game.i18n.localize('MARROW.Blight.Warded'), effect: ADVANTAGE });
    }

    const key = this.system.saves ? 'body' : 'instinct';
    const result = await new MarrowCheck(this, {
      key,
      sources,
      flavor: game.i18n.format('MARROW.Blight.GroundSave', {
        ground: MARROW.groundTypes[ground]?.label ?? ground,
      }),
    }).evaluate();

    if (!result.success) {
      await applyConsequences(this, { stress: 0, blight: 1, panic: false, notes: [] });
    }
    return result;
  }

  get isWarded() {
    return this.items.some(i => i.type === 'armor' && i.system.equipped && i.system.warded);
  }

  /**
   * XVI.1, Steeped: "Each dawn, make a Body Save or take 1d10 damage."
   */
  async rollDawn() {
    if (!this.system.blight?.steeped) return null;
    const key = this.system.saves ? 'body' : 'instinct';
    const result = await new MarrowCheck(this, {
      key,
      flavor: game.i18n.localize('MARROW.Blight.Dawn'),
    }).evaluate();

    if (!result.success) {
      const roll = await new Roll('1d10').evaluate();
      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: this }),
        flavor: game.i18n.localize('MARROW.Blight.Dawn'),
      });
      await this.applyDamage(roll.total, { damageType: 'bluntForce', ignoreArmor: true });
    }
    return result;
  }

  /* --- Workings -------------------------------------------------------------- */

  /**
   * XVII.1. "Make a Sanity Save, adding Thaumaturgy if you hold it." The Working always
   * happens -- the Save decides only the price, which MarrowCheck's 'working' kind handles.
   */
  async castWorking(working, options = {}) {
    if ((this.system.blight?.value ?? 0) < 1) {
      // XVII: "Anyone with a Blight Level of 1 or higher may attempt a Working."
      ui.notifications?.warn(game.i18n.localize('MARROW.Working.NeedsBlight'));
      return null;
    }

    const result = await new MarrowCheck(this, {
      key: this.system.saves ? 'sanity' : 'instinct',
      kind: 'working',
      working,
      skill: this.thaumaturgy,
      flavor: game.i18n.format('MARROW.Working.Attempt', { name: working.name }),
      ...options,
    }).evaluate();

    // The Calling's own table is rolled by the Warden in private, after the Working.
    if (working.system.wardenTable) {
      await drawSystemTable(working.system.wardenTable, this);
    }
    return result;
  }

  /** XVII: training does not make the Working stronger, only survivable. */
  get thaumaturgy() {
    return this.items.find(i => i.type === 'skill' && i.name === 'Thaumaturgy') ?? null;
  }

  /* --- Roll data ------------------------------------------------------------- */

  getRollData() {
    const data = { ...this.system };
    // `@B` is MARROW.md's own notation for the caster's Blight Level (XVII.2).
    data.B = this.system.blight?.value ?? 0;
    return data;
  }
}
