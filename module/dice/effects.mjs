/**
 * Reading a table result and doing what it says.
 *
 * The Wound tables (XIII) and the Panic table (XI.3) do not merely describe what happened --
 * most rows state a mechanical consequence in plain words: "Bleeding +2", "Minimum Stress
 * +1", "-1d10 Strength", "Gain 1d5 Stress", "Death Save", "*Condition:* ...". Those are the
 * effects this file recognises and applies.
 *
 * Two rules govern what is in here:
 *
 *   1. Only what a row actually SAYS. A longsword's Wound column reads "Bleeding" because
 *      that is the column you roll on when it takes you to zero Health -- it is not a claim
 *      that every longsword hit makes you bleed. Bleeding comes from a Wound result that
 *      says "Bleeding +N", and from nothing else.
 *
 *   2. Nothing that needs a ruling. "Body Save or entangled" needs a Save, and whether a
 *      Motivation conflicts with an order is the Warden's call. Those are surfaced, not
 *      applied.
 *
 * Anything not recognised still reaches the player: the row's full text is kept on the
 * Condition item, so nothing is lost by not being parsed.
 */

const STAT_WORDS = {
  strength: 'strength', speed: 'speed', intellect: 'intellect', combat: 'combat',
  'sanity save': 'sanity', 'fear save': 'fear', 'body save': 'body',
  sanity: 'sanity', fear: 'fear', body: 'body',
};

/** Sentences about other people at the table are not this actor's to apply. */
const NOT_YOURS = /\b(companion|close friendly|others|everyone|all close)\b/i;

/**
 * Every row on the Panic table and both Wound and Panic's own Conditions lead with a short
 * label before the first period -- "RAGE.", "COWARD.", "Hand or foot severed." A real label
 * is a handful of words; a whole sentence is not one, so anything longer is left alone.
 */
function rowLabel(text) {
  const first = text.split('.')[0].trim();
  if (!first || first.split(/\s+/).length > 5) return null;
  // MARROW.md sets these in caps for emphasis ("RAGE.", "COWARD."); title case matches the
  // pre-built Condition items build_packs.py already makes from the same rows.
  return first.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Recognised patterns already handled above, stripped so what's left is purely narrative. */
function stripRecognized(plain) {
  return plain
    .replace(/^(Flesh Wound|Minor|Major|Lethal|Fatal)\.\s*/i, '')
    .replace(/Bleeding \+\d+\.?/gi, '')
    .replace(/Minimum Stress \+\d+\.?/gi, '')
    .replace(/Gain (\d+d\d+|\d+) Stress\.?/gi, '')
    .replace(/Reduce Stress by (\d+d\d+|\d+)\.?/gi, '')
    .replace(/-\s*(\d+d\d+|\d+)\s+(Strength|Speed|Intellect|Combat|Sanity Save|Fear Save|Body Save)\.?/gi, '')
    .replace(/Reduce your Maximum Health by (\d+d\d+|\d+)\.?/gi, '')
    .replace(/Death Save\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Apply everything a table result states, and return what was done so it can be reported.
 *
 * @param {Actor} actor
 * @param {string} text     the result's own words
 * @param {object} [opts]
 * @param {string} [opts.source]  what produced it, for the Condition's name
 * @param {boolean} [opts.recordInjury]  XIII: a Wound is permanent by definition, so any
 *   description left over once the mechanical part is parsed out -- "Hand or foot severed",
 *   not just its "Bleeding +4" -- gets its own Condition even with no number attached to it.
 * @returns {Promise<{applied: string[], unhandled: string[], deathSave: boolean}>}
 */
export async function applyResultEffects(actor, text, { source = '', recordInjury = false } = {}) {
  const done = { applied: [], unhandled: [], deathSave: false };
  if (!text) return done;

  const plain = String(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const update = {};
  const s = actor.system;

  // --- XIII.1 Bleeding ------------------------------------------------------
  // "Bleeding +2", and it is cumulative, so it adds to whatever is already running.
  const bleeding = [...plain.matchAll(/Bleeding \+(\d+)/gi)]
    .reduce((sum, m) => sum + Number(m[1]), 0);
  if (bleeding > 0) {
    await addBleeding(actor, bleeding, source || plain);
    done.applied.push(`Bleeding +${bleeding}`);
  }

  // --- XI, Minimum Stress ---------------------------------------------------
  const minStress = [...plain.matchAll(/Minimum Stress \+(\d+)/gi)]
    .reduce((sum, m) => sum + Number(m[1]), 0);
  if (minStress > 0 && s.stress) {
    update['system.stress.base'] = s.stress.base + minStress;
    done.applied.push(`Minimum Stress +${minStress}`);
  }

  // --- Stress gained and shed ----------------------------------------------
  for (const sentence of plain.split(/(?<=[.!])\s+/)) {
    if (NOT_YOURS.test(sentence)) continue;

    const gain = sentence.match(/Gain (\d+d\d+|\d+) Stress/i);
    if (gain) {
      const n = await amount(gain[1]);
      update['system.stress.value'] = clampStress(s, (update['system.stress.value'] ?? s.stress.value) + n);
      done.applied.push(`+${n} Stress`);
    }

    const shed = sentence.match(/Reduce Stress by (\d+d\d+|\d+)/i);
    if (shed) {
      const n = await amount(shed[1]);
      update['system.stress.value'] = clampStress(s, (update['system.stress.value'] ?? s.stress.value) - n);
      done.applied.push(`-${n} Stress`);
    }
  }

  // --- Stats and Saves reduced ---------------------------------------------
  // "-1d10 Strength", "-2d10 Body Save". These are permanent, so they hit the stored value.
  for (const m of plain.matchAll(/-\s*(\d+d\d+|\d+)\s+(Strength|Speed|Intellect|Combat|Sanity Save|Fear Save|Body Save)/gi)) {
    const key = STAT_WORDS[m[2].toLowerCase()];
    const group = s.stats && key in s.stats ? 'stats' : 'saves';
    if (!s[group]?.[key]) continue;
    const n = await amount(m[1]);
    const path = `system.${group}.${key}.value`;
    const current = update[path] ?? s[group][key].value;
    update[path] = Math.max(0, current - n);
    done.applied.push(`-${n} ${m[2]}`);
  }

  // --- Maximum Health reduced (XIII.2's Unconscious) ------------------------
  const maxHealth = plain.match(/Reduce your Maximum Health by (\d+d\d+|\d+)/i);
  if (maxHealth && s.health) {
    const n = await amount(maxHealth[1]);
    update['system.health.max'] = Math.max(1, s.health.max - n);
    done.applied.push(`Maximum Health -${n}`);
  }

  if (!foundry.utils.isEmpty(update)) await actor.update(update);

  // --- Conditions -----------------------------------------------------------
  // XI.3: "Some Panic results leave a Condition, which is permanent until treated."
  // A Wound that hands you a lasting [+] or [-] is the same thing by another name.
  const conditionText = plain.match(/Condition:\s*(.+)$/i)?.[1];
  // A lasting [+]/[-], or damage that keeps coming ("2d10 DMG per round" for a limb on
  // fire), is a Condition by another name. The dice stay in the text: unlike Bleeding, XIII
  // gives these no per-round rule the system can run on its own, so the Warden rolls them.
  const lasting = !conditionText && /\[[-+]\]|\d+d\d+ DMG per round/i.test(plain)
    ? plain : null;

  if (conditionText || lasting) {
    await addCondition(actor, rowLabel(plain) ?? source ?? 'Condition', conditionText ?? lasting);
    done.applied.push('Condition');
  } else if (recordInjury && done.applied.length) {
    // A row like "Hand or foot severed. Bleeding +4." already had its Bleeding tracked above;
    // the injury itself is not a number and would otherwise vanish once that match consumed
    // the row. Gated on something else already having applied, so a purely descriptive miss
    // like "Rib broken." with no number attached at all is left as flavor in the chat log
    // rather than every Wound minting a permanent Condition for it.
    const injury = stripRecognized(plain);
    if (/[A-Za-z]{3,}/.test(injury)) {
      await addCondition(actor, rowLabel(injury) ?? rowLabel(plain) ?? source ?? 'Condition', injury);
      done.applied.push('Injury');
    }
  }

  // --- XIII: Fatal --------------------------------------------------------
  if (/Death Save/i.test(plain)) done.deathSave = true;

  // Things a row states that only a person can resolve.
  for (const m of plain.matchAll(/((?:Body|Fear|Sanity) Save[^.]*)/gi)) {
    done.unhandled.push(m[1].trim());
  }

  return done;
}

/* -------------------------------------------------------------------------- */

async function amount(expression) {
  if (/^\d+$/.test(expression)) return Number(expression);
  return (await new Roll(expression).evaluate()).total;
}

function clampStress(system, value) {
  const floor = system.stress?.min ?? system.stress?.base ?? 0;
  return Math.clamp(value, floor, system.stress?.max ?? 20);
}

/**
 * XIII.1: Bleeding is cumulative. One Condition item carries the running total rather than
 * a pile of separate ones, because the rule is a single number per round.
 */
export async function addBleeding(actor, amount, reason = '') {
  const existing = actor.items.find(i => i.type === 'condition' && i.system.bleeding > 0);
  if (existing) {
    return existing.update({ 'system.bleeding': existing.system.bleeding + amount });
  }
  return actor.createEmbeddedDocuments('Item', [{
    name: game.i18n.localize('MARROW.Bleeding'),
    type: 'condition',
    img: 'icons/svg/blood.svg',
    system: {
      description: `<p>${reason}</p>`,
      bleeding: amount,
      permanent: false,
    },
  }]);
}

/** XI.3. The row's own words are kept, whether or not anything above understood them. */
export async function addCondition(actor, name, text) {
  return actor.createEmbeddedDocuments('Item', [{
    name,
    type: 'condition',
    img: 'icons/svg/blood.svg',
    system: { description: `<p>${text}</p>`, bleeding: 0, permanent: true },
  }]);
}
