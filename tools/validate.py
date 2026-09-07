#!/usr/bin/env python3
"""Checks that hold the system together, run before every commit.

Three of these exist because I shipped the bug they catch:

  * `lang_collisions` -- Foundry flattens nested language objects to dotted paths, so a
    literal key "A.B" sitting beside a nested object {"A": {"B": ...}} silently shadows one
    of them. JSON also allows duplicate keys in one object, and the last one quietly wins.

  * `pack_openable` -- a LevelDB directory holding only a .log reads fine from Python and
    shows up EMPTY in Foundry. A pack is only openable with CURRENT and a MANIFEST.

  * `check_part_roots` -- an ApplicationV2 PARTS template must render exactly one root
    element. resources.hbs rendered fine as a single <section> until Bleeding actually went
    above 0, at which point a sibling {{#if}} banner after </section> gave it two roots and
    crashed the character sheet the instant it re-rendered.

None of this can tell you whether the JavaScript parses. A syntax error anywhere in the
module graph leaves the system silently unloaded -- Foundry logs it and falls back to its
own default sheets, so documents render and nothing the system defines does. Open
tools/smoke.html through tools/serve.py to check that; it is the only thing here that does.

Usage:  python tools/validate.py
Exit code is 1 if anything failed.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LANG = ROOT / "lang" / "en.json"

problems: list[str] = []


def fail(msg: str) -> None:
    problems.append(msg)


# --------------------------------------------------------------------------- #
#  Language keys                                                               #
# --------------------------------------------------------------------------- #

def flatten(obj, prefix="", out=None, seen=None):
    """Flatten nested JSON the way Foundry does, recording every path it produces."""
    if out is None:
        out, seen = {}, {}
    for key, value in obj.items():
        path = f"{prefix}{key}"
        if isinstance(value, dict):
            flatten(value, path + ".", out, seen)
        else:
            if path in out:
                fail(f"lang: duplicate flattened key {path!r}")
            out[path] = value
    return out


def duplicate_json_keys(text: str) -> list[str]:
    """JSON silently keeps the last of two identical keys in one object. Catch it."""
    dupes = []

    def hook(pairs):
        seen = set()
        for key, _ in pairs:
            if key in seen:
                dupes.append(key)
            seen.add(key)
        return dict(pairs)

    json.loads(text, object_pairs_hook=hook)
    return dupes


def check_lang():
    text = LANG.read_text(encoding="utf-8")

    for key in duplicate_json_keys(text):
        fail(f"lang: key {key!r} appears twice in the same object -- one of them is lost")

    data = json.loads(text)
    flat = flatten(data)

    # A path that is both a leaf and a prefix of another path collides once flattened.
    for path in flat:
        for other in flat:
            if other != path and other.startswith(path + "."):
                fail(f"lang: {path!r} is both a value and a prefix of {other!r}")

    return flat


KEY_RE = re.compile(r"['\"`](MARROW\.[A-Za-z0-9_.]+)['\"`]")
HBS_RE = re.compile(r"localize\s+['\"](MARROW\.[A-Za-z0-9_.]+)['\"]")
HBS_ATTR_RE = re.compile(r"\{\{localize\s+['\"](MARROW\.[A-Za-z0-9_.]+)['\"]\}\}")


def check_referenced_keys(flat):
    referenced: dict[str, set[str]] = {}

    for path in list(ROOT.glob("module/**/*.mjs")):
        for key in KEY_RE.findall(path.read_text(encoding="utf-8")):
            referenced.setdefault(key, set()).add(str(path.relative_to(ROOT)))

    for path in list(ROOT.glob("templates/**/*.hbs")):
        text = path.read_text(encoding="utf-8")
        for key in set(HBS_RE.findall(text)) | set(HBS_ATTR_RE.findall(text)):
            referenced.setdefault(key, set()).add(str(path.relative_to(ROOT)))

    # Keys built at runtime, e.g. `MARROW.Blight.Band.${band}` -- check the prefix exists.
    prefixes = {"MARROW.Blight.Band", "MARROW.Blight.Note", "MARROW.Working.Outcome",
                "MARROW.Outcome", "MARROW.Save", "MARROW.Adjust", "MARROW.Category"}

    for key, where in sorted(referenced.items()):
        if key in flat:
            continue
        if any(key.startswith(p + ".") for p in prefixes):
            continue
        fail(f"lang: {key} referenced in {', '.join(sorted(where))} but not defined")


# --------------------------------------------------------------------------- #
#  Compendium packs                                                            #
# --------------------------------------------------------------------------- #

def check_packs():
    """Three ways a pack can look fine to Python and be broken in Foundry.

    1. No CURRENT/MANIFEST. LevelDB cannot open the database at all, and the compendium
       shows up EMPTY with no error anywhere.
    2. Bad record checksums. LevelDB with paranoid_checks off -- the default -- silently
       DROPS records that fail crc32c, so documents vanish without a message.
    3. An empty pack that should not be.

    ldb.read_pack verifies checksums, so opening each pack here covers (2).
    """
    sys.path.insert(0, str(ROOT / "tools"))
    import ldb  # noqa: PLC0415 -- deliberately late, after the path is set

    system = json.loads((ROOT / "system.json").read_text(encoding="utf-8"))
    for pack in system.get("packs", []):
        directory = ROOT / pack["path"]
        if not directory.is_dir():
            fail(f"pack {pack['name']}: {pack['path']} does not exist")
            continue

        names = {p.name for p in directory.iterdir()}
        if "CURRENT" not in names:
            fail(f"pack {pack['name']}: no CURRENT -- Foundry will show it EMPTY")
        if not any(n.startswith("MANIFEST-") for n in names):
            fail(f"pack {pack['name']}: no MANIFEST -- Foundry will show it EMPTY")
        if not any(n.endswith(".log") or n.endswith(".ldb") for n in names):
            fail(f"pack {pack['name']}: no data files")
            continue

        try:
            docs = ldb.read_pack(str(directory))
        except ValueError as exc:
            fail(f"pack {pack['name']}: {exc}")
            continue

        if not docs:
            fail(f"pack {pack['name']}: opens, but holds no documents")


def check_table_results():
    """A roll table lists its result ids in `results`; the results live under their own keys.

    Left as an empty array the table opens in Foundry with no rows at all -- which is what
    it did. Nothing else notices, because the result documents are all present and correct.
    """
    sys.path.insert(0, str(ROOT / "tools"))
    import ldb  # noqa: PLC0415

    for pack in ("tables", "tables_warden"):
        directory = ROOT / "packs" / pack
        if not directory.is_dir():
            continue
        try:
            raw = ldb.read_pack(str(directory))
        except ValueError:
            continue

        tables, results = {}, {}
        for key, value in raw.items():
            k = key.decode("utf-8")
            doc = json.loads(value.decode("utf-8"))
            if k.startswith("!tables!"):
                tables[doc["_id"]] = doc
            elif k.startswith("!tables.results!"):
                results.setdefault(k.split("!")[2].split(".")[0], set()).add(doc["_id"])

        for tid, doc in tables.items():
            listed = set(doc.get("results") or [])
            stored = results.get(tid, set())
            if not listed and stored:
                fail(f"table {doc['name']!r}: {len(stored)} results exist but `results` is "
                     f"empty -- it will open with no rows")
            elif listed != stored:
                fail(f"table {doc['name']!r}: `results` does not match the stored results "
                     f"({len(listed)} listed, {len(stored)} stored)")


def check_loadout_coverage():
    """Every V. Loadout entry should resolve to a compendium item.

    Anything that does not still works -- creation makes a gear item from the text -- but a
    miss means the packs and the tables have drifted, and the player gets an item with no
    stats where there should have been one.
    """
    sys.path.insert(0, str(ROOT / "tools"))
    try:
        import check_loadouts  # noqa: PLC0415
    except Exception as exc:  # noqa: BLE001
        fail(f"loadout check could not run: {exc}")
        return

    try:
        index = check_loadouts.build_index()
    except Exception:  # noqa: BLE001
        return                                       # packs already reported

    import ldb  # noqa: PLC0415
    directory = ROOT / "packs" / "tables"
    if not directory.is_dir():
        return
    try:
        raw = ldb.read_pack(str(directory))
    except ValueError:
        return

    tables, results = {}, []
    for key, value in raw.items():
        k = key.decode("utf-8")
        doc = json.loads(value.decode("utf-8"))
        if k.startswith("!tables!"):
            tables[doc["_id"]] = doc["name"]
        elif k.startswith("!tables.results!"):
            doc["_table"] = k.split("!")[2].split(".")[0]
            results.append(doc)

    misses = []
    for result in results:
        if not tables.get(result["_table"], "").startswith("Loadout:"):
            continue
        for part in check_loadouts.split_loadout(result.get("description", "")):
            base = re.sub(r"\([^)]*\)", "", part).strip()
            if not check_loadouts.lookup(index, base):
                misses.append(part)

    if misses:
        fail(f"{len(misses)} loadout entries resolve to no compendium item: "
             + ", ".join(sorted(set(misses))[:5]) + ("..." if len(set(misses)) > 5 else ""))


def check_table_references():
    """Every roll table the code or a Class asks for by name must exist in a pack.

    This is the check that would have caught the dead roll buttons: the code looked up a
    table by name, the name was right, and the pack it lived in could not be opened -- so
    the lookup returned nothing and the button did nothing, silently.

    It also verifies each table's ranges actually cover its formula. A `1d100-1` table with
    a gap at 37 rolls a blank result and says nothing about why.
    """
    sys.path.insert(0, str(ROOT / "tools"))
    import ldb  # noqa: PLC0415

    available: dict[str, dict] = {}
    for pack in ("tables", "tables_warden"):
        directory = ROOT / "packs" / pack
        if not directory.is_dir():
            return                                   # check_packs already reported this
        try:
            raw = ldb.read_pack(str(directory))
        except ValueError:
            return                                   # ditto
        for key, value in raw.items():
            k = key.decode("utf-8")
            if k.startswith("!tables!"):
                doc = json.loads(value.decode("utf-8"))
                available[doc["name"]] = doc
            elif k.startswith("!tables.results!"):
                table_id = k.split("!")[2].split(".")[0]
                available.setdefault("_results", {}).setdefault(table_id, []).append(
                    json.loads(value.decode("utf-8")))

    results_by_table = available.pop("_results", {})

    # Names the system looks up at runtime, out of config.mjs.
    config = (ROOT / "module" / "config.mjs").read_text(encoding="utf-8")
    wanted = set(re.findall(r"^\s*(?:panic|death|marks|bluntForce|bleeding|piercing|"
                            r"fireBlast|goreMassive):\s*'([^']+)'", config, re.M))

    # Names the Classes point at for their starting rolls.
    builder = (ROOT / "tools" / "build_packs.py").read_text(encoding="utf-8")
    wanted |= set(re.findall(r'"(Loadout: \w+)"', builder))
    wanted |= {"Trinkets", "Crests"}

    for name in sorted(wanted):
        if name not in available:
            fail(f"table {name!r} is looked up by name but is in no pack")

    # Formula coverage.
    for name, doc in sorted(available.items()):
        m = re.fullmatch(r"1d(\d+)(-1)?", doc.get("formula", ""))
        if not m:
            continue
        sides, shifted = int(m.group(1)), bool(m.group(2))
        low, high = (0, sides - 1) if shifted else (1, sides)
        covered = set()
        for result in results_by_table.get(doc["_id"], []):
            a, b = result["range"]
            covered |= set(range(a, b + 1))
        gaps = sorted(set(range(low, high + 1)) - covered)
        if gaps:
            fail(f"table {name!r} ({doc['formula']}) has no result for {gaps}")


# --------------------------------------------------------------------------- #
#  system.json                                                                 #
# --------------------------------------------------------------------------- #

def check_manifest():
    system = json.loads((ROOT / "system.json").read_text(encoding="utf-8"))

    for entry in system.get("esmodules", []):
        if not (ROOT / entry).exists():
            fail(f"system.json: esmodule {entry} is missing")
    for entry in system.get("styles", []):
        if not (ROOT / entry).exists():
            fail(f"system.json: style {entry} is missing")
    for lang in system.get("languages", []):
        if not (ROOT / lang["path"]).exists():
            fail(f"system.json: language file {lang['path']} is missing")

    # Every declared document type needs a data model registered for it.
    entry_point = (ROOT / system["esmodules"][0]).read_text(encoding="utf-8")
    for kind in ("Actor", "Item"):
        for type_name in system["documentTypes"].get(kind, {}):
            if not re.search(rf"\b{re.escape(type_name)}\s*:", entry_point):
                fail(f"system.json: {kind} type {type_name!r} has no data model in the entry point")

    # And the reverse: a data model registered in JS with no matching documentTypes entry is
    # a legal-looking type that Foundry will never actually offer -- CONFIG.Actor.dataModels
    # controls what code exists for a type, but system.json's documentTypes is what makes
    # Foundry's document schema accept the type at all. This is exactly the gap that shipped
    # 0.1.8 with a Creature type nothing could create.
    for kind in ("Actor", "Item"):
        block = re.search(rf"CONFIG\.{kind}\.dataModels\s*=\s*\{{(.*?)\}};", entry_point, re.S)
        declared_types = set(system["documentTypes"].get(kind, {}))
        for type_name in re.findall(r"(\w+):\s*\w+Data", block.group(1)) if block else []:
            if type_name not in declared_types:
                fail(f"module/marrow.mjs: {kind} data model {type_name!r} is registered in JS "
                     f"but missing from system.json's documentTypes -- Foundry will never offer it")

    declared = {p["name"] for p in system.get("packs", [])}
    for folder in system.get("packFolders", []):
        for name in folder.get("packs", []):
            if name not in declared:
                fail(f"system.json: packFolders references undeclared pack {name!r}")


# --------------------------------------------------------------------------- #
#  Templates                                                                   #
# --------------------------------------------------------------------------- #

TEMPLATE_RE = re.compile(r"['\"](systems/marrow/templates/[^'\"]+)['\"]")


def check_templates():
    for path in ROOT.glob("module/**/*.mjs"):
        for ref in TEMPLATE_RE.findall(path.read_text(encoding="utf-8")):
            target = ROOT / ref.replace("systems/marrow/", "")
            if not target.exists():
                fail(f"{path.relative_to(ROOT)}: template {ref} does not exist")


# ApplicationV2 requires every PARTS template to render exactly one root HTML element --
# resources.hbs shipped a <section> followed by a sibling {{#if}} banner, which rendered fine
# until Bleeding actually went above 0 and crashed the sheet the moment it tried to re-render.
# Handlebars itself enforces no such thing, and tools/smoke.html only compiles and renders
# templates through raw Handlebars, so neither one would have caught it.
PARTS_RE = re.compile(r"static\s+PARTS\s*=\s*\{(.*?)\n\s*\};", re.S)
PART_TEMPLATE_RE = re.compile(r"template:\s*['\"]systems/marrow/(templates/[^'\"]+)['\"]")
VOID_TAGS = {"input", "img", "br", "hr", "prose-mirror"}


def _strip_handlebars(text: str) -> str:
    text = re.sub(r"\{\{!--.*?--\}\}", "", text, flags=re.S)
    text = re.sub(r"\{\{[^}]*\}\}", "", text)
    return text


def _root_element_count(html: str) -> int:
    depth = 0
    roots = 0
    for match in re.finditer(r"<(/?)([a-zA-Z][\w-]*)\b[^>]*?(/?)>", html):
        closing, tag, self_closed = match.groups()
        tag = tag.lower()
        if self_closed or tag in VOID_TAGS:
            if depth == 0 and not closing:
                roots += 1
            continue
        if closing:
            depth -= 1
        else:
            if depth == 0:
                roots += 1
            depth += 1
    return roots


def check_part_roots():
    part_templates: set[str] = set()
    for path in list(ROOT.glob("module/sheets/*.mjs")) + [ROOT / "module/apps/creation.mjs"]:
        text = path.read_text(encoding="utf-8")
        for block in PARTS_RE.findall(text):
            part_templates.update(PART_TEMPLATE_RE.findall(block))

    for ref in sorted(part_templates):
        target = ROOT / ref
        if not target.exists():
            continue  # already reported by check_templates
        html = _strip_handlebars(target.read_text(encoding="utf-8"))
        roots = _root_element_count(html)
        if roots != 1:
            fail(f"{ref}: PARTS template must render exactly one root element, found {roots} "
                 f"-- a conditional sibling at the top level (like a banner after </section>) "
                 f"crashes ApplicationV2 the moment that branch turns on")


def main() -> int:
    flat = check_lang()
    check_referenced_keys(flat)
    check_manifest()
    check_templates()
    check_part_roots()
    check_packs()
    check_table_results()
    check_table_references()
    check_loadout_coverage()

    if problems:
        print(f"{len(problems)} problem(s):\n")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("No problems.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
