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
Conditions, and Death Saves. 54 of the 70 rows carry a recognised mechanical effect on top of
that; the rest are pure description ("Rib broken"). A Wound's description becomes a Condition
either way — "a Wound is permanent by definition" (XIII) does not stop applying just because
the row had no number attached, so "Paralyzed from the waist down" gets recorded exactly like
"Flesh torn away. -1d10 Strength" does, once the mechanical part is stripped out of the
latter. What applied is also posted to chat as its own follow-up card, since a silent
`actor.update` behind a Wound draw is otherwise invisible until someone opens the sheet.
Anything a row states that needs a Save or a ruling — "Body Save or entangled" — is surfaced
on the card rather than applied.

### 8. The Marks table rolls once per band, not once per point — *XVI.1, XVI.2*

Not in `MARROW.md` at all; by request. XVI.1 says "every time your Blight Level rises, roll
1d10 on the Marks table," which read literally means a jump from Blight 2 to 6 rolls Marks
four times. `rollMarks` (`module/dice/check.mjs`) now rolls once only when the Blight *band*
changes (Clean/Touched/Steeped/Consumed/Undone), using the same breakpoints
`character.mjs`/`companion.mjs` derive `blight.band` from. `blight.marked` still remembers
the highest level reached, so dropping and regaining Blight within the same band does not
roll Marks again.

## Deliberate departures from the old system

This is a rebuild, not a port, so a few things that existed before are gone on purpose:

- **Identification.** Not in `MARROW.md` at all; by request. Every Item type but Working
  carries `identified` (default `true`), `unidentifiedName`, and `unidentifiedDescription`.
  A sword is a sword and needs nothing set; a mystery potion, an unlabeled flask, or a
  Condition applied from an unexplained cause sets `identified: false` and supplies a cover
  name and description. `MarrowItem#displayName`/`#displayDescription` resolve which one a
  given viewer sees -- the Warden always sees the real thing, since there is nothing to hide
  from the person running the mystery. The GM-only reveal button lives on the item row
  (`identifyItem` on `MarrowActorSheet`) for the common case of ending a mystery mid-session,
  and the full authoring fields (the checkbox, the cover name, the cover description) live on
  the item sheet itself, under Identification, for setting one up. Working is excluded: a
  Working is a player's own ability, never a mystery to them.

  The swap happens in the template layer (`isHiddenMystery` in `helpers.mjs`), not by
  editing what `Item#name` returns -- overriding the real document name would have been
  simpler to render but would have broken anything in the codebase that compares by name
  (`grantedSkills`, `castWorking`'s `working.name === 'RUIN'`, `findConditionSource`'s
  lookups), and would have meant the GM's own `item.name` lied to them too. The real name is
  always the real name; only what a template chooses to print changes.

- **`@Check[key]{Label}` and `@Check[key|fail:Condition Name]{Label}`.** Also not in
  `MARROW.md`; also by request. A TextEditor enricher (`marrow.mjs`) turns that markup into
  a clickable Save wherever Foundry enriches text -- a chat card's rider-note, an actor's
  notes, a Condition's own description, even a journal page. Clicking it rolls the Check
  directly for whoever clicked (`game.user.character`, falling back to a selected token's
  actor) with no dialog, since this is a Save something is putting on the reader, not an
  action they are choosing to take. `|fail:Name` applies a Condition by that name on a
  failure, sourced from the first match found among world items and every Item compendium,
  and skipped if the actor already holds one by that name rather than stacking duplicates.
  This is how a monster ability like the Keening (Silence at Greta Outpost) gets to roll
  itself and hand out its own aftermath, without the system needing to know what a "Keening"
  is.

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
- **Character and Companion Actors link their prototype token; Creature does not.** A
  Character or Companion is one specific someone followed across scenes, so their token
  should always read the one Actor's real numbers. A Creature is routinely dropped onto a
  scene two or three times as separate monsters ("Goblin" x3), and linking those would make
  one goblin's Health everyone's. This is a judgement call MARROW.md has no opinion on,
  flagged in case it's wrong for how you actually run things.
- **The Check dialog lets you check more than one Skill at once.** X.5 says "If you hold a
  Skill that genuinely applies, add its bonus" -- singular, and arguably one specialization
  at a time is what was meant. By request, the dialog does not enforce that reading: every
  Skill checked adds its own bonus. `MarrowCheck` sums `skills[]` rather than holding one.
- **The creation wizard enforces each Class's Skills allowance**, not just the named Skills
  a Class grants outright. II's Bonus line is prose ("one Expert Skill, or two Trained
  Skills") that was originally left to the player to self-police; by request it is now a
  real cap, `MARROW.classSkillAllowance` in `config.mjs`, per Class:
  - Soldier and Blighted: one Expert Skill *or* two Trained -- picking into one locks the
    other until cleared back to zero.
  - Laborer: exactly one Trained *and* one Expert, independently.
  - Scholar: the odd one out. "One Master Skill together with one Expert and one Trained
    Skill drawn from its chain of prerequisites" is not a count of any rank -- it names a
    specific Master, whose own listed prerequisites are the only Expert choices, whose own
    prerequisites are the only Trained choices. `#scholarChain` in `creation.mjs` walks that
    chain instead of counting against a table.
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
