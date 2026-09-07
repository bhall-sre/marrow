#!/usr/bin/env python3
"""Checks that hold the system together, run before every commit.

Two of these exist because I shipped the bug they catch:

  * `lang_collisions` -- Foundry flattens nested language objects to dotted paths, so a
    literal key "A.B" sitting beside a nested object {"A": {"B": ...}} silently shadows one
    of them. JSON also allows duplicate keys in one object, and the last one quietly wins.

  * `pack_openable` -- a LevelDB directory holding only a .log reads fine from Python and
    shows up EMPTY in Foundry. A pack is only openable with CURRENT and a MANIFEST.

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
    """A pack Foundry can actually open needs CURRENT and a MANIFEST, not just a .log."""
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


def main() -> int:
    flat = check_lang()
    check_referenced_keys(flat)
    check_manifest()
    check_templates()
    check_packs()

    if problems:
        print(f"{len(problems)} problem(s):\n")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("No problems.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
