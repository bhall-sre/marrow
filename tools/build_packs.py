#!/usr/bin/env python3
"""Build every compendium pack from MARROW.md.

Nothing here invents content. Every name, number, cost and table row is read out of
MARROW.md by marrowdoc.py; this file only decides which Foundry document each row becomes.
Where MARROW.md says something this system has no field for, it goes into `notes` or the
description verbatim rather than being dropped or approximated.

Document ids are a hash of (pack, name), so regenerating a pack keeps every UUID stable and
anything referencing it -- a class's granted skills, a loadout entry -- keeps working.

Roll tables use a `1dN-1` formula wherever MARROW.md prints results from zero (all the d10
and d100 tables), so the number Foundry rolls is the number on the page.

Usage:  python tools/build_packs.py [pack-name ...]
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import packtool  # noqa: E402
from marrowdoc import Marrow  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PACKS = ROOT / "packs"

ms = Marrow()

# Foundry's own bundled icon set -- present in every install, and ours to point at.
ICON = {
    "skill": "icons/svg/book.svg",
    "weapon": "icons/svg/sword.svg",
    "armor": "icons/svg/shield.svg",
    "gear": "icons/svg/item-bag.svg",
    "treatment": "icons/svg/heal.svg",
    "trinket": "icons/svg/chest.svg",
    "crest": "icons/svg/statue.svg",
    "class": "icons/svg/mystery-man.svg",
    "working": "icons/svg/daze.svg",
    "condition": "icons/svg/blood.svg",
    "table": "icons/svg/d20.svg",
}


def doc_id(pack: str, name: str) -> str:
    """A stable 16-character id, so regenerating a pack does not break references."""
    return hashlib.sha1(f"{pack}:{name}".encode()).hexdigest()[:16]


def item(pack: str, name: str, type_: str, system: dict, img: str | None = None) -> dict:
    return {
        "_id": doc_id(pack, name),
        "name": name,
        "type": type_,
        "img": img or ICON.get(type_, ICON["gear"]),
        "system": system,
        "effects": [],
        "folder": None,
        "sort": 0,
        "ownership": {"default": 0},
        "flags": {},
        "_stats": {"systemId": "marrow", "systemVersion": "0.1.0"},
    }


# --------------------------------------------------------------------------- #
#  III. Skills                                                                 #
# --------------------------------------------------------------------------- #

def parse_prerequisites(cell: str) -> list[str]:
    """III: "Alchemy or Herbalism", "Herbalism, Hunting, or Beast-Lore". Any ONE of them
    satisfies the requirement, so the separator carries no meaning beyond listing."""
    text = Marrow.plain(cell)
    if not text or text == "—":
        return []
    return [p.strip() for p in re.split(r",\s*or\s+|\s+or\s+|,\s*", text) if p.strip()]


def build_skills() -> dict:
    docs = {}
    for rank, heading in (("trained", "III.2 TRAINED"),
                          ("expert", "III.3 EXPERT"),
                          ("master", "III.4 MASTER")):
        for row in ms.table(heading):
            name = Marrow.plain(row[0])
            docs[name] = item("skills", name, "skill", {
                "description": Marrow.html(row[1]),
                "cost": 0,
                "rank": rank,
                "prerequisites": parse_prerequisites(row[2]) if len(row) > 2 else [],
            })
    return docs


# --------------------------------------------------------------------------- #
#  VIII.2 Weapons                                                              #
# --------------------------------------------------------------------------- #

WOUND_COLUMN = {
    "blunt force": "bluntForce",
    "bleeding": "bleeding",
    "piercing": "piercing",
    "fire & blast": "fireBlast",
    "gore": "goreMassive",
    "gore & massive": "goreMassive",
}

RANGE_WORD = {"adjacent": "adjacent", "close": "close", "long": "long", "extreme": "extreme"}


def parse_wound(cell: str) -> tuple[str, str, str]:
    """The Wound column names the damage type and sometimes carries the weapon's own
    [+] or [-]. A few entries name two columns ("Blunt Force + Piercing") or offer a
    choice ("Bleeding [+] or Gore [+]"); the first is used and the full text is kept."""
    text = Marrow.plain(cell)
    innate = "advantage" if "[+]" in text else "disadvantage" if "[-]" in text else ""
    stripped = text.replace("[+]", "").replace("[-]", "").strip()

    first = re.split(r"\s+or\s+|\s*\+\s*", stripped)[0].strip().lower()
    damage_type = WOUND_COLUMN.get(first, "")

    # Anything beyond a single plain column is worth saying out loud on the item.
    extra = text if (" or " in stripped or "+" in stripped) else ""
    return damage_type, innate, extra


def parse_damage(cell: str) -> tuple[str, str]:
    """Returns (formula, leftover-note). MARROW.md's damage column is mostly dice, with a
    handful of entries that say more than a formula can."""
    text = Marrow.plain(cell)
    if text in ("—", ""):
        return "", ""
    # VIII.2 Fists: "Str/10".
    if text.lower() == "str/10":
        return "floor(@stats.strength.value / 10)", "Str/10"
    # "3d10 (AA)" -- the AA is picked up separately as a tag.
    formula = re.sub(r"\s*\(AA\)", "", text).strip()
    # "1d10, +2d10 when drawn out" -- roll the first, keep the rest as a note.
    if "," in formula:
        head, tail = formula.split(",", 1)
        return head.strip(), text
    return formula, ""


def build_weapons() -> dict:
    docs = {}
    for row in ms.table("VIII.2 WEAPONS"):
        name, cost, rng, dmg, ammo, wound, notes = (row + [""] * 7)[:7]
        name = Marrow.plain(name)

        damage, damage_note = parse_damage(dmg)
        damage_type, innate, wound_note = parse_wound(wound)

        ammo_text = Marrow.plain(ammo)
        ammo_max = int(ammo_text) if ammo_text.isdigit() else 0

        note_bits = [b for b in (Marrow.plain(notes), damage_note, wound_note) if b]
        if ammo_text == "∞":
            note_bits.insert(0, "Ammo: unlimited")

        docs[name] = item("weapons", name, "weapon", {
            "description": Marrow.html(notes),
            "cost": Marrow.silver(cost),
            "damage": damage,
            "damageType": damage_type or "bluntForce",
            "range": RANGE_WORD.get(Marrow.plain(rng).lower(), ""),
            "ammo": {"value": ammo_max, "max": ammo_max},
            "antiArmor": "(AA)" in Marrow.plain(dmg),
            "reload": "Reload" in notes,
            "heavy": "Heavy" in notes,
            "reach": "Reach" in notes,
            "twoHanded": "Two-handed" in notes,
            "innate": innate,
            "equipped": False,
            "notes": " ".join(note_bits),
        })
    return docs


# --------------------------------------------------------------------------- #
#  VIII.3 Armor and VIII.4 Shields                                             #
# --------------------------------------------------------------------------- #

def build_armor() -> dict:
    docs = {}

    for row in ms.table("VIII.3 ARMOR"):
        name, cost, ap, kind, notes = (row + [""] * 5)[:5]
        name = Marrow.plain(name)
        dr = re.search(r"Damage Reduction (\d+)", notes)
        docs[name] = item("armor", name, "armor", {
            "description": Marrow.html(notes),
            "cost": Marrow.silver(cost),
            "armorPoints": int(Marrow.plain(ap) or 0),
            "damageReduction": int(dr.group(1)) if dr else 0,
            "kind": Marrow.plain(kind).lower(),
            "isShield": False,
            # VIII.3: "Removes the Disadvantage on Blight Saves."
            "warded": "Disadvantage on Blight Saves" in notes,
            "heavy": "Heavy" in notes,
            "destroyed": False,
            "equipped": False,
            "notes": "",
        })

    # VIII.4: "A shield is cover you carry."
    for row in ms.table("VIII.4 SHIELDS"):
        name, cost, ap, notes = (row + [""] * 4)[:4]
        name = Marrow.plain(name)
        docs[name] = item("armor", name, "armor", {
            "description": Marrow.html(notes),
            "cost": Marrow.silver(cost),
            "armorPoints": int(Marrow.plain(ap) or 0),
            "damageReduction": 0,
            "kind": "",
            "isShield": True,
            "warded": False,
            "heavy": False,
            "destroyed": False,
            "equipped": False,
            "notes": "",
        })

    return docs


# --------------------------------------------------------------------------- #
#  IX Gear, XVIII.2 Treatments, VI Trinkets, VII Crests                        #
# --------------------------------------------------------------------------- #

def build_gear() -> dict:
    docs = {}
    for row in ms.table("IX. GEAR"):
        name, cost, desc = (row + [""] * 3)[:3]
        name = Marrow.plain(name)
        docs[name] = item("gear", name, "gear", {
            "description": Marrow.html(desc),
            "cost": Marrow.silver(cost),
            "quantity": 1,
            "category": "gear",
        })
    return docs


def build_treatments() -> dict:
    docs = {}
    for row in ms.table("XVIII.2 REAL"):
        name, cost, desc = (row + [""] * 3)[:3]
        name = Marrow.plain(name)
        docs[name] = item("treatments", name, "gear", {
            "description": Marrow.html(desc),
            "cost": Marrow.silver(cost),
            "quantity": 1,
            "category": "treatment",
        }, img=ICON["treatment"])
    return docs


def split_hundred(heading: str) -> list[tuple[int, str]]:
    """VI and VII print their 1d100 tables in two side-by-side halves:
    `| 00 | left | 50 | right |`. Returns [(roll, text)] in roll order."""
    out = []
    for row in ms.table(heading):
        for i in range(0, len(row) - 1, 2):
            roll, text = row[i].strip(), row[i + 1].strip()
            if not roll:
                continue
            out.append((int(re.sub(r"\D", "", roll)), Marrow.plain(text)))
    return sorted(out)


def build_hundred_items(heading: str, pack: str, category: str) -> dict:
    entries = split_hundred(heading)
    assert len(entries) == 100, f"{heading}: expected 100 entries, parsed {len(entries)}"
    docs = {}
    for roll, text in entries:
        # The roll is part of the name so the compendium sorts the way the book prints.
        name = f"{roll:02d} {text}"
        docs[name] = item(pack, name, "gear", {
            "description": f"<p>{text}</p>",
            "cost": 0,
            "quantity": 1,
            "category": category,
        }, img=ICON[category])
    return docs


# --------------------------------------------------------------------------- #
#  II. Classes                                                                 #
# --------------------------------------------------------------------------- #

ADJUSTMENT_TARGET = {
    "combat": "combat", "strength": "strength", "speed": "speed", "intellect": "intellect",
    "sanity save": "sanity", "fear save": "fear", "body save": "body",
    "maximum wound": "maxWounds", "maximum wounds": "maxWounds",
}

CLASS_TABLES = {
    "The Soldier": "Loadout: Soldier",
    "The Blighted": "Loadout: Blighted",
    "The Scholar": "Loadout: Scholar",
    "The Laborer": "Loadout: Laborer",
}


def parse_adjustments(line: str) -> tuple[dict, dict]:
    """II's Adjustments line into a fixed part and a player-chosen part."""
    adjustments = {k: 0 for k in
                   ("strength", "speed", "intellect", "combat",
                    "sanity", "fear", "body", "maxWounds")}
    choice = {"amount": 0, "from": ["strength", "speed", "intellect", "combat"]}

    for amount, target in re.findall(r"([+-]\d+)\s+(?:to\s+)?([A-Za-z ]+?)(?=[,.]|$)", line):
        value, key = int(amount), target.strip().lower()

        if key == "one stat of your choice":
            choice["amount"] = value
        elif key == "all stats":
            for k in ("strength", "speed", "intellect", "combat"):
                adjustments[k] += value
        elif key == "all saves":
            for k in ("sanity", "fear", "body"):
                adjustments[k] += value
        elif key in ADJUSTMENT_TARGET:
            adjustments[ADJUSTMENT_TARGET[key]] += value

    return adjustments, choice


def build_classes() -> dict:
    docs = {}
    for heading in ("THE SOLDIER", "THE BLIGHTED", "THE SCHOLAR", "THE LABORER"):
        lines = ms.section(heading)
        text = "\n".join(lines)
        name = "The " + heading.split()[-1].capitalize()

        adj_line = next(l for l in lines if l.startswith("**Adjustments:**"))
        adjustments, choice = parse_adjustments(adj_line)

        skills_line = next(l for l in lines if l.startswith("**Skills:**"))
        # Named skills are the italicised ones; "one Expert Skill" and the like are choices
        # the player makes and cannot be granted automatically.
        # Single asterisks only: `**Skills:**` is a label, `*Soldiering*` is a skill.
        granted = re.findall(r"(?<!\*)\*([^*]+?)\*(?!\*)",
                             skills_line.split("**Bonus:**")[0])

        trauma = next((l for l in lines if l.startswith("**Trauma Response:**")), "")
        blight = re.search(r"begin play at \*\*Blight (\d+)\*\*", text)

        # The prose above the Adjustments line is what the class actually is.
        blurb = [l for l in lines
                 if l.strip() and not l.startswith("**") and not l.startswith("|")]

        docs[name] = item("classes", name, "class", {
            "description": "".join(f"<p>{Marrow.plain(p)}</p>" for p in blurb),
            "cost": 0,
            "traumaResponse": Marrow.html(trauma.replace("**Trauma Response:**", "").strip()),
            "adjustments": adjustments,
            "choice": choice,
            "startingBlight": int(blight.group(1)) if blight else 0,
            "grantedSkills": granted,
            "tables": {
                "loadout": CLASS_TABLES[name],
                "trinket": "Trinkets",
                "crest": "Crests",
            },
        })
    return docs


# --------------------------------------------------------------------------- #
#  XVII.2 Workings                                                             #
# --------------------------------------------------------------------------- #

# XVII.2 states a dice expression scaled by B for exactly two Workings. The rest scale a
# duration or a count, which is in the description; inventing formulas for them would be
# inventing mechanics.
WORKING_FORMULA = {
    "RUIN": "{B}d10",
    "THE MENDING": "{B}d10",
}


def build_workings() -> dict:
    docs = {}
    lines = ms.section("XVII.2 THE SEVEN WORKINGS")
    for line in lines:
        m = re.match(r"^\*\*([A-Z][A-Z '&]+)\.\*\*\s+(.*)$", line.strip())
        if not m:
            continue
        name, body = m.group(1).strip(), m.group(2).strip()
        docs[name] = item("workings", name, "working", {
            "description": Marrow.html(body),
            "formula": WORKING_FORMULA.get(name, ""),
            "notes": "",
            # XVII.2: only The Calling has a table, and the Warden rolls it in private.
            "wardenTable": "The Calling" if name == "THE CALLING" else "",
        })
    assert len(docs) == 7, f"XVII.2 names seven Workings; parsed {len(docs)}"
    return docs


# --------------------------------------------------------------------------- #
#  XI.3 Conditions                                                             #
# --------------------------------------------------------------------------- #

def build_conditions() -> dict:
    """XI.3: "Some Panic results leave a Condition, which is permanent until treated."
    The Conditions in MARROW.md are exactly those Panic results."""
    docs = {}
    for row in ms.table("THE PANIC TABLE"):
        text = row[1]
        if "*Condition:*" not in text:
            continue
        m = re.match(r"\*\*(.+?)\.\*\*\s*(.*)$", Marrow.plain(text).replace("Condition:", "").strip()) \
            or re.match(r"(.+?)\.\s*(.*)$", Marrow.plain(text))
        name = Marrow.plain(text).split(".")[0].strip().title()
        body = text.split("*Condition:*", 1)[1].strip()
        docs[name] = item("conditions", name, "condition", {
            "description": Marrow.html(body),
            "bleeding": 0,
            "permanent": True,
        })

    # XIII.1: Bleeding is a Condition in everything but name -- it is what the Wound tables
    # hand out, it is cumulative, and it ignores armour. One item, quantity in the field.
    name = "Bleeding"
    docs[name] = item("conditions", name, "condition", {
        "description": "<p>You take 1 damage every round until it is stopped. It is "
                       "cumulative. <strong>Bleeding ignores armor and Damage "
                       "Reduction.</strong></p>",
        "bleeding": 1,
        "permanent": False,
    })
    return docs


# --------------------------------------------------------------------------- #
#  Roll tables                                                                 #
# --------------------------------------------------------------------------- #

def table_doc(pack: str, name: str, formula: str, rows: list[tuple[int, int, str]],
              description: str = "") -> tuple[dict, list[dict]]:
    tid = doc_id(pack, name)
    results = []
    for i, (low, high, text) in enumerate(rows):
        results.append({
            "_id": doc_id(pack, f"{name}#{low}-{high}#{i}"),
            "type": "text",
            "text": text,
            "description": text,
            "img": None,
            "weight": 1,
            "range": [low, high],
            "drawn": False,
            "documentCollection": None,
            "documentId": None,
            "flags": {},
        })

    doc = {
        "_id": tid,
        "name": name,
        "img": ICON["table"],
        "description": description,
        "formula": formula,
        "replacement": True,
        "displayRoll": True,
        "folder": None,
        "sort": 0,
        "ownership": {"default": 0},
        "flags": {},
        "_stats": {"systemId": "marrow", "systemVersion": "0.1.0"},
        "results": [],
    }
    return doc, results


def add_table(docs: dict, pack: str, name: str, formula: str,
              rows: list[tuple[int, int, str]], description: str = "") -> None:
    """Roll tables store their results as separate LevelDB keys."""
    doc, results = table_doc(pack, name, formula, rows, description)
    docs[f"!tables!{doc['_id']}"] = doc
    for r in results:
        docs[f"!tables.results!{doc['_id']}.{r['_id']}"] = r


def rows_from(table: list[list[str]], text_index: int = 1) -> list[tuple[int, int, str]]:
    out = []
    for row in table:
        low, high = Marrow.roll_range(row[0])
        out.append((low, high, Marrow.plain(row[text_index])))
    return out


def build_tables() -> dict:
    docs: dict = {}

    # XI.2's Panic Table is the one d20 in the game, and it prints 01-20, so no shift.
    add_table(docs, "tables", "Panic", "1d20", rows_from(ms.table("THE PANIC TABLE")),
              "<p>Roll 1d20 and try to roll higher than your current Stress. "
              "Roll equal or under and you fail: consult this table.</p>")

    # Everything else prints from zero, so `1dN-1` makes Foundry roll the printed number.
    add_table(docs, "tables", "Marks of the Blight", "1d10-1",
              rows_from(ms.table("XVI.2 MARKS")),
              "<p>Every time your Blight Level rises, roll here and describe the change "
              "aloud. The others are watching it happen to you.</p>")

    # XIII's Wounds table is one table with five columns; each column is its own d10 table.
    wounds = ms.table("XIII. WOUNDS")
    columns = [("Blunt Force", 2), ("Bleeding", 3), ("Piercing", 4),
               ("Fire & Blast", 5), ("Gore & Massive", 6)]
    for label, index in columns:
        rows = []
        for row in wounds:
            low, high = Marrow.roll_range(row[0])
            severity = Marrow.plain(row[1])
            rows.append((low, high, f"{severity}. {Marrow.plain(row[index])}"))
        add_table(docs, "tables", f"Wounds: {label}", "1d10-1", rows,
                  f"<p>Roll 1d10 on the {label} column when Health reaches zero.</p>")

    # V. Loadouts, one table per class.
    for heading, name in (("SOLDIER", "Loadout: Soldier"), ("BLIGHTED", "Loadout: Blighted"),
                          ("SCHOLAR", "Loadout: Scholar"), ("LABORER", "Loadout: Laborer")):
        add_table(docs, "tables", name, "1d10-1", rows_from(ms.table(heading)),
                  "<p>Roll 1d10 on your class table. This is what you own.</p>")

    for heading, name, blurb in (
        ("VI. TRINKETS", "Trinkets", "Everyone carries one useless thing. "
                                     "It is how you tell them from a corpse."),
        ("VII. CRESTS", "Crests", "A mark on the shoulder, so that whoever loots the body "
                                  "knows what they are burying."),
    ):
        rows = [(roll, roll, text) for roll, text in split_hundred(heading)]
        add_table(docs, "tables", name, "1d100-1", rows, f"<p>{blurb}</p>")

    # XX's hiring table carries a retainer's whole statblock, so the row keeps every column.
    rows = []
    for row in ms.table("XX. RETAINERS"):
        low, high = Marrow.roll_range(row[0])
        occupation, wage, combat, instinct, wounds, motivation = row[1:7]
        rows.append((low, high,
                     f"{Marrow.plain(occupation)} — wage {Marrow.plain(wage)} sp, "
                     f"Combat {Marrow.plain(combat)}, Instinct {Marrow.plain(instinct)}, "
                     f"Wounds {Marrow.plain(wounds)}. {Marrow.plain(motivation)}"))
    add_table(docs, "tables", "Retainers", "1d100-1", rows,
              "<p>At any holdfast you can find people broke enough to come with you. "
              "Be careful. Most of them have a reason to be broke.</p>")

    return docs


def build_warden_tables() -> dict:
    """XIII.2 and XVII.2's Calling are both rolled by the Warden and not shown."""
    docs: dict = {}

    add_table(docs, "tables_warden", "Death", "1d10-1",
              rows_from(ms.table("XIII.2 DEATH")),
              "<p>The Warden puts 1d10 in a cup, shakes it, and sets it face down on the "
              "table without looking. It is revealed only when somebody spends a turn "
              "checking the body, and not before.</p>")

    # The Calling's table is the last one in XVII.2.
    calling = ms.tables(ms.section("XVII.2 THE SEVEN WORKINGS"))[-1]
    add_table(docs, "tables_warden", "The Calling", "1d10-1", rows_from(calling),
              "<p>The Warden rolls 1d10 in private and does not say what it was.</p>")

    return docs


# --------------------------------------------------------------------------- #
#  Wiring                                                                      #
# --------------------------------------------------------------------------- #

def as_item_pack(docs: dict) -> dict:
    return {f"!items!{d['_id']}": d for d in docs.values()}


BUILDERS = {
    "skills": lambda: as_item_pack(build_skills()),
    "weapons": lambda: as_item_pack(build_weapons()),
    "armor": lambda: as_item_pack(build_armor()),
    "gear": lambda: as_item_pack(build_gear()),
    "treatments": lambda: as_item_pack(build_treatments()),
    "trinkets": lambda: as_item_pack(build_hundred_items("VI. TRINKETS", "trinkets", "trinket")),
    "crests": lambda: as_item_pack(build_hundred_items("VII. CRESTS", "crests", "crest")),
    "classes": lambda: as_item_pack(build_classes()),
    "workings": lambda: as_item_pack(build_workings()),
    "conditions": lambda: as_item_pack(build_conditions()),
    "tables": build_tables,
    "tables_warden": build_warden_tables,
}


def build(names: list[str] | None = None) -> None:
    wanted = names or list(BUILDERS)
    for name in wanted:
        if name not in BUILDERS:
            raise SystemExit(f"unknown pack {name!r}; known: {', '.join(BUILDERS)}")

        docs = BUILDERS[name]()
        pack_dir = PACKS / name

        # Rebuild from scratch: a stale .log left beside a new one would be replayed too.
        if pack_dir.exists():
            shutil.rmtree(pack_dir)
        pack_dir.mkdir(parents=True)

        tmp = pack_dir / "_build.json"
        tmp.write_text(json.dumps(docs, indent=1, ensure_ascii=False), encoding="utf-8")
        packtool.load(str(pack_dir), str(tmp))
        tmp.unlink()


if __name__ == "__main__":
    build(sys.argv[1:] or None)
