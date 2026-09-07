#!/usr/bin/env python3
"""Build the release zip Foundry installs.

Foundry expects system.json at the root of the archive, so paths are stored relative to the
repository root with no wrapping folder. The build tools and the conversion notes are left
out -- they are for working on the system, not for running it.

Usage:  python tools/package.py [output.zip]
"""
from __future__ import annotations

import fnmatch
import json
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

EXCLUDE_DIRS = {".git", "__pycache__", "tools", ".github"}
EXCLUDE_FILES = ["*.pyc", "*.zip", "_build.json", ".gitignore", "CONVERSION_NOTES.md"]


def main() -> int:
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "marrow.zip")
    if os.path.exists(out):
        os.remove(out)

    written = []
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(ROOT):
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
            for name in sorted(files):
                if any(fnmatch.fnmatch(name, pattern) for pattern in EXCLUDE_FILES):
                    continue
                path = os.path.join(root, name)
                arc = os.path.relpath(path, ROOT).replace(os.sep, "/")
                z.write(path, arc)
                written.append(arc)

    # The three things that make the archive installable at all.
    problems = []
    if "system.json" not in written:
        problems.append("system.json is not at the archive root")

    manifest = json.load(open(os.path.join(ROOT, "system.json"), encoding="utf-8"))
    for entry in manifest.get("esmodules", []) + manifest.get("styles", []):
        if entry not in written:
            problems.append(f"{entry} declared in system.json but not in the archive")
    for pack in manifest.get("packs", []):
        if f"{pack['path']}/CURRENT" not in written:
            problems.append(f"pack {pack['name']} has no CURRENT in the archive")

    if problems:
        for p in problems:
            print(f"  PROBLEM: {p}")
        return 1

    size = os.path.getsize(out)
    print(f"{out}: {len(written)} files, {size // 1024} KiB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
