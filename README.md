# MARROW

A Foundry VTT v13 system for **MARROW**, a sword-and-sorcery roleplaying game.

Roll d100 under your Stats and Saves. Track Health and Wounds, Stress and Panic. And carry
the Blight — a resource that only ever rises, subtracts from everything you roll, and is the
only source of sorcery in the world. Anyone carrying it may attempt a Working. Weapons beat
armor by *kind* rather than by number. One flat currency: the silver penny.

## Installing

In Foundry, **Game Systems → Install System**, and paste:

```
https://github.com/bhall-sre/marrow/releases/latest/download/system.json
```

## What is where

| Path | What it holds |
|---|---|
| `MARROW.md` | The game. The single source of truth for every rule, table, and name. |
| `module/config.mjs` | Every constant, each traceable to a section of `MARROW.md`. |
| `module/data/` | The data models. Stored values are what a character *has*; derived values are what they *roll*. |
| `module/dice/` | Resolution: `roll.mjs` (the dice), `check.mjs` (Checks and their cost), `damage.mjs` (armor, Wounds, death). |
| `module/documents/` | Actor and Item behaviour. |
| `module/sheets/`, `templates/` | ApplicationV2 sheets. |
| `tools/` | Pure-Python LevelDB and pack tooling, plus `validate.py`. |

## Working on it

There is no Node toolchain here and none is needed — the CSS is hand-written and the packs
are built by the Python tools. Before committing:

```bash
python tools/validate.py
```

It checks language-key collisions, missing template files, manifest consistency, and — the
one that matters most — that every compendium pack is actually *openable* by Foundry. A
LevelDB directory holding only a `.log` reads fine from Python and shows up empty in
Foundry; `validate.py` fails on that.

## Licensing

Two licences, and the split matters.

**The game — all rights reserved.** `MARROW.md` and everything generated from it (the whole
of `packs/`, and `lang/en.json`) is copyright and may not be copied, redistributed, adapted,
or included in anything else without written permission. Play with it freely; do not
republish it. Its presence in a public repository grants no licence.

**The code — MIT.** Everything under `module/`, `css/`, `templates/`, `tools/`, and
`system.json`. Fork it, build on it, ship it.

See `LICENSE` for both in full.
