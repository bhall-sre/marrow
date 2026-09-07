# Conversion notes

What is done, what is stubbed, what needs a ruling from you, and where I read `MARROW.md`
one way when it could reasonably be read another.

---

## Rulings I had to make, and would like you to confirm

These are places where `MARROW.md` is genuinely ambiguous. In each case I took the reading
that invents the least, and each is a small, isolated change if you rule the other way.

### 1. The Blighted's first three levels — *II, XVI.1* — **SETTLED**

II says the Blighted "begin play at **Blight 3**. The penalties for those first three levels
are **already accounted for in the adjustments above**."

Two readings:

- **(a)** The adjustments are the *net* numbers, so the Blight's −1 per level does not apply
  for levels 1–3. A Blighted at Blight 4 would take only −1.
- **(b)** The adjustments were *sized* knowing the −3 will land, so the penalty applies
  uniformly like everyone else's. A Blighted at Blight 4 takes −4.

**I implemented (b)**, because XVI.1 says "**Every** level of Blight is a permanent −1 to all
Stats and all Saves. Every one." with no exception, and (a) would require inventing an
exemption mechanic that appears nowhere in the text.

Reading (b) does leave the Blighted's Strength, Speed and Combat sitting at −3 with no
compensating bonus, which is what makes me want your confirmation.

**Settled by the working port**, which applied the −1 uniformly with no exemption
(`actor.js:81`, "Apply -1 per Blight Level directly to every Stat and Save"). This build
does the same, and additionally sets the Blight 3 that II specifies — the port never did,
so a Blighted character there started at Blight 0 unless someone typed it in.

### 2. Does the Blight penalty reach a Retainer? — *XVI.1, XX* — **SETTLED**

XX's hiring table gives Touched retainers Combat 20 / Instinct 35 alongside a starting
**Blight 4**. Same question as above, and the same answer: uniform, as the port did. The
table numbers are treated as written and the −4 applies on top. See
`module/data/companion.mjs`.

### 3. Thaumaturgy's prerequisite — *III.4 vs III.5*

III.4 and III.5 disagree about what *Thaumaturgy* requires. **Unresolved.** The Skill is
shipped with the prerequisites III.4 lists; nothing in code depends on which is right, so
this is a content fix whenever you decide.

### 4. Stress past 20 — *XI*

XI: "Maximum Stress is 20; anything past 20 instead reduces the most relevant Stat or Save by
that amount." *Which* Stat is a judgement call, so the system caps Stress at 20 and posts a
notification naming the overflow. It does not reduce anything on its own.

### 5. A Working's Critical Failure costs no Stress

XVII.1's ladder lists Critical Failure as "1d5 Blight and roll on the Panic Table" — no
Stress, unlike Failure directly above it. Implemented exactly as written, on the assumption
the omission is deliberate.

---

### 6. Armour has no hit points — *VIII.3, XII.5*

Asked for, and not in the text. XII.5 destroys armour outright: "if a single hit deals
damage **equal to or greater than** your AP, the armor is destroyed." There is no wearing
down, and a hit below AP does nothing at all. What VIII.3 *does* give is three states, so
that is what is implemented: **intact** → **destroyed** (AP 0, Damage Reduction still
working) → **patched** (AP 1, from a leatherworker's kit) → **intact** (a smith, for a
quarter of the armour's price and a week). Destruction is automatic; the two repairs are
purchases and stay manual.

### 7. A weapon's Wound column is not a Condition — *VIII.2, XIII, XIII.1*

A longsword's Wound column reads "Bleeding" because that is the column you roll on when it
takes you to zero Health. It is not a claim that every longsword hit makes you bleed.
Bleeding is applied when a Wound **result** says "Bleeding +N", and from nothing else.

`module/dice/effects.mjs` reads each Wound and Panic result and does what it says — Bleeding,
Minimum Stress, Stress gained or shed, Stats and Saves reduced, Maximum Health reduced,
Conditions, and Death Saves. 54 of the 70 rows carry a recognised effect; the rest are pure
description ("Rib broken"). Anything a row states that needs a Save or a ruling — "Body Save
or entangled" — is surfaced on the card rather than applied.

## Deliberate departures from the old system

This is a rebuild, not a port, so a few things that existed before are gone on purpose:

- **No XP, Rank, Level, or Resolve.** None of them appear in `MARROW.md`.
- **Retainers are the `companion` Actor type**, but labelled **"Companion"** everywhere the
  player reads it — by explicit request, overriding `MARROW.md` XX's own word ("Retainer").
  The type *key* was already `companion` before this, chosen only to avoid colliding with
  anything else in an existing world; now the label agrees with it too.
- **A `creature` Actor type exists for monsters, and MARROW.md defines none.** By request,
  its stat block is a straight port of the Mothership Foundry system's own `creature` type
  (`foundry-mothership-src/template.json`): Health, Wounds, Combat, Instinct. Mothership's
  creature also offers optional Speed/Loyalty/Sanity/Armor toggles and a "swarm" rule that
  rescales Combat by Wounds remaining — those are extensions on top of that base block, not
  part of it, and were left out rather than invented on your behalf. Armor is handled through
  MARROW's own Armor items (AP/DR/state) instead of Mothership's flat armor stat, since that
  is strictly more capable and already exists. Say the word if you want the toggles or the
  swarm rule too.
- **The Check dialog lets you check more than one Skill at once.** X.5 says "If you hold a
  Skill that genuinely applies, add its bonus" -- singular, and arguably one specialization
  at a time is what was meant. By request, the dialog does not enforce that reading: every
  Skill checked adds its own bonus. `MarrowCheck` sums `skills[]` rather than holding one.
- **All third-party art was removed.** Item and table artwork now uses Foundry's own bundled
  `icons/` set. The one image in this repo, `images/ui/pause.svg`, is ours.
- **The stylesheet was rewritten**, keyed to the new markup. It is hand-maintained; there is
  no SCSS pipeline and none is wanted.

---

## Done

- **Data models** — `character`, `companion`, `creature`, and all seven Item types, on
  `foundry.abstract.TypeDataModel`.
- **The Blight as a first-class attribute** (XVI) — reaches every Stat, every Save, the
  Stress floor, and the Body Save's Advantage state, entirely through derived data, so the
  penalty can never compound into a stored number.
- **The dice** (X) — d100 roll-under, Advantage/Disadvantage that cancel, criticals on
  doubles, 90–99 always fails.
- **Consequences** (X.1, X.2, X.4, XI) — 1 Stress on a failure, Panic on a Critical Failure,
  Rest shedding the ones digit.
- **Workings** (XVII) — the full cost ladder, `{B}` substitution, The Calling's private
  Warden table.
- **Damage and armour** (XII.5, XIII) — AP as a threshold rather than a pool, DR first,
  Anti-Armor, Wounds by damage type, carry-over across multiple Wounds, blind Death Saves.
- **Sheets** — ApplicationV2, same arrangement as before, rebuilt underneath.
- **`tools/validate.py`** — including a check that every pack is *openable* by Foundry, which
  is the specific failure that made the roll tables silently empty last time.

- **Compendium packs**, all twelve, generated from `MARROW.md` by `tools/build_packs.py`:
  47 Skills, 34 Weapons, 12 Armor & Shields, 40 Gear, 8 Treatments, 100 Trinkets, 100
  Crests, 4 Classes, 7 Workings, 9 Conditions, 14 tables and 2 Warden-only tables. Document
  ids are a hash of (pack, name), so rebuilding keeps every UUID stable.

- **Character creation** (I) — all nine steps, from the Actors directory. It enforces what
  MARROW.md states as a mechanic (the dice, the Class adjustments, III's prerequisite rule)
  and *shows* what it leaves to judgement (each Class's Skills allowance, which is prose).
  All 154 Loadout entries resolve to a compendium item; `validate.py` fails if any stops
  doing so.

## Not done yet

- **Macros** for the common rolls.
- **Blight triggers on scenes** (XVI.3) — ground types are in `config.mjs` and the Save is
  implemented, but nothing yet ties a Scene to a ground type. You said "fine for now".
