/**
 * World settings.
 *
 * Kept deliberately short. Every setting is a place where two tables could play the same
 * rule differently, and MARROW.md leaves very few of those open -- so anything that is not
 * a genuine table-level choice is a constant in config.mjs instead.
 */
export function registerSettings() {
  // XIII.1 happens without anybody rolling, which makes it exactly the sort of thing a
  // table either wants automated or wants to keep in their own hands.
  game.settings.register('marrow', 'autoBleed', {
    name: 'MARROW.Settings.AutoBleed',
    hint: 'MARROW.Settings.AutoBleedHint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });

  // XI.2: "You must make a Panic Check whenever you roll a Critical Failure." Some Wardens
  // would rather call for it themselves than have it fire off the back of a Check.
  game.settings.register('marrow', 'autoPanic', {
    name: 'MARROW.Settings.AutoPanic',
    hint: 'MARROW.Settings.AutoPanicHint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });

  // X.1/X.2: "Otherwise you fail and gain 1 Stress." Automating this keeps the ledger
  // honest; turning it off suits tables who narrate first and bookkeep after.
  game.settings.register('marrow', 'autoStress', {
    name: 'MARROW.Settings.AutoStress',
    hint: 'MARROW.Settings.AutoStressHint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });
}
