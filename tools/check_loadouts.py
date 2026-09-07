#!/usr/bin/env python3
"""Report how every V. Loadout entry resolves against the compendiums.

The Loadout tables are sentences -- "Mail hauberk (AP 7), brace of javelins (x4), pack,
camp kit" -- and character creation turns each part into an item. Anything that does not
match a compendium entry becomes a plain gear item with that text, so nothing is lost; but
a low match rate means the tables and the packs have drifted apart, and that is worth
seeing rather than discovering in play.

This mirrors the splitting and normalising rules in module/apps/creation.mjs. It is a
report, not a gate: run it after changing either the Loadout tables or the item packs.

Usage:  python tools/check_loadouts.py [--verbose]
"""
from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ldb  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


STOPWORDS = {"and", "of", "the", "a"}


def normalize(name: str) -> str:
    """Mirrors CharacterCreation.#normalize in module/apps/creation.mjs. The two must agree;
    this file is only useful if it is measuring what the system actually does."""
    words = re.sub(r"[^a-z0-9]+", " ", name.lower().replace("&", " and ")).split()
    out = []
    for word in words:
        if word in STOPWORDS:
            continue
        if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
            word = word[:-1]
        out.append(word)
    return " ".join(out)


def lookup(index: dict, base: str):
    """Mirrors CharacterCreation.#lookup: exact, then whole-word prefix."""
    key = normalize(base)
    if not key:
        return None
    if key in index:
        return index[key]
    for candidate, doc in index.items():
        if candidate.startswith(key + " "):
            return doc
    return None


def describe(part: str, hit: dict) -> str:
    """Mirrors the "(xN)" rules in CharacterCreation.applyLoadout."""
    m = re.search(r"\(x(\d+)\)", part, re.I)
    name, kind = hit["name"], hit["type"]
    if not m:
        return f"{name} [{kind}]"
    n = int(m.group(1))
    bundle = re.search(r"\(x(\d+)\)", name, re.I)
    if kind == "weapon":
        if hit["system"]["ammo"]["max"] > 0:
            return f"{name} [{kind}]  ammo {n}"
        return f"{name} [{kind}]  (x{n} ignored -- weapon carries no ammo)"
    if bundle:
        if int(bundle.group(1)) != n:
            renamed = re.sub(r"\(x\d+\)", f"(x{n})", name, flags=re.I)
            return f"{renamed} [{kind}]  (bundle resized from {bundle.group(1)})"
        return f"{name} [{kind}]"
    return f"{name} [{kind}]  quantity {n}"


def split_loadout(text: str) -> list[str]:
    """Split on commas that are not inside parentheses."""
    parts, depth, current = [], 0, ""
    for ch in text:
        if ch == "(":
            depth += 1
        if ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(current.strip())
            current = ""
        else:
            current += ch
    if current.strip():
        parts.append(current.strip())

    # Mirrors creation.mjs: a clause opening with "and" belongs to the part before it.
    out: list[str] = []
    for part in (p for p in parts if p):
        if out and re.match(r"^and\s", part, re.I):
            out[-1] += f", {part}"
        else:
            out.append(part)
    return out


def build_index() -> dict[str, dict]:
    index: dict[str, dict] = {}
    for pack in ("armor", "weapons", "gear", "treatments"):
        directory = os.path.join(ROOT, "packs", pack)
        if not os.path.isdir(directory):
            continue
        for value in ldb.read_pack(directory).values():
            doc = json.loads(value.decode("utf-8"))
            for key in (normalize(doc["name"]),
                        normalize(re.sub(r"\([^)]*\)", "", doc["name"]))):
                if key and key not in index:
                    index[key] = doc
    return index


def main() -> int:
    verbose = "--verbose" in sys.argv
    index = build_index()

    tables_dir = os.path.join(ROOT, "packs", "tables")
    rows: list[tuple[str, str]] = []
    tables: dict[str, str] = {}
    results: list[dict] = []

    for key, value in ldb.read_pack(tables_dir).items():
        k = key.decode("utf-8")
        doc = json.loads(value.decode("utf-8"))
        if k.startswith("!tables!"):
            tables[doc["_id"]] = doc["name"]
        elif k.startswith("!tables.results!"):
            doc["_table"] = k.split("!")[2].split(".")[0]
            results.append(doc)

    for result in results:
        name = tables.get(result["_table"], "")
        if name.startswith("Loadout:"):
            rows.append((name, result.get("description") or result.get("text", "")))

    matched = unmatched = 0
    misses: dict[str, list[str]] = {}

    for table, text in sorted(rows):
        for part in split_loadout(text):
            base = re.sub(r"\([^)]*\)", "", part).strip()
            hit = lookup(index, base)
            if not hit:
                unmatched += 1
                misses.setdefault(part, []).append(table)
                continue
            matched += 1
            if verbose:
                print(f"  ok    {part:<44} -> {describe(part, hit)}")

    total = matched + unmatched
    print(f"\n{matched}/{total} loadout entries resolve to a compendium item "
          f"({100 * matched // total if total else 0}%)")

    if misses:
        print("\nNot in any pack -- these become plain gear items carrying their own text:")
        for base, where in sorted(misses.items()):
            print(f"  {base:<46} ({len(where)}x)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
