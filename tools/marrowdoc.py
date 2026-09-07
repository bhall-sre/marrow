#!/usr/bin/env python3
"""Read MARROW.md as structured data.

MARROW.md is the single source of truth, so nothing downstream of this file is allowed to
invent a name, a number, or a table row. Everything the packs contain comes through here.

The one thing worth knowing about the parsing: a table separator row is `|---|---|`, and
some real content rows in MARROW.md are empty in their first cell -- the trinket and crest
tables begin `| | | | |`. Filtering separators with a loose "row of dashes and pipes" test
silently ate two of the hundred trinkets last time, so `is_separator` is strict: every cell
must be non-empty and made only of dashes and colons.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = ROOT / "MARROW.md"


class Marrow:
    def __init__(self, path: Path | str = DEFAULT_SOURCE):
        self.path = Path(path)
        self.lines = self.path.read_text(encoding="utf-8").split("\n")

    # -- sections ----------------------------------------------------------- #

    def section(self, title: str) -> list[str]:
        """Lines under the heading whose text starts with `title`, up to the next heading
        of the same or a higher level."""
        start = level = None
        for i, line in enumerate(self.lines):
            m = re.match(r"^(#{1,6})\s+(.*)$", line)
            if not m:
                continue
            if start is None:
                if m.group(2).strip().upper().startswith(title.upper()):
                    start, level = i, len(m.group(1))
            elif len(m.group(1)) <= level:
                return self.lines[start + 1:i]
        if start is None:
            raise KeyError(f"no section starting {title!r} in {self.path.name}")
        return self.lines[start + 1:]

    # -- tables ------------------------------------------------------------- #

    @staticmethod
    def is_separator(line: str) -> bool:
        cells = Marrow.cells(line)
        return bool(cells) and all(c and set(c) <= set("-:") for c in cells)

    @staticmethod
    def cells(line: str) -> list[str]:
        s = line.strip()
        if not s.startswith("|"):
            return []
        return [c.strip() for c in s.strip("|").split("|")]

    @staticmethod
    def tables(lines: list[str]) -> list[list[list[str]]]:
        """Split lines into markdown tables, each a list of rows of cells.

        The header row and the separator are dropped; what comes back is body rows only.
        """
        out, current, seen_separator = [], [], False
        for line in lines:
            if line.strip().startswith("|"):
                if Marrow.is_separator(line):
                    # Everything gathered before the separator was the header.
                    current, seen_separator = [], True
                    continue
                if seen_separator:
                    current.append(Marrow.cells(line))
                continue
            if seen_separator and current:
                out.append(current)
            current, seen_separator = [], False
        if seen_separator and current:
            out.append(current)
        return out

    def table(self, title: str, index: int = 0) -> list[list[str]]:
        tables = self.tables(self.section(title))
        if index >= len(tables):
            raise KeyError(f"section {title!r} has no table at index {index}")
        return tables[index]

    # -- cell helpers ------------------------------------------------------- #

    @staticmethod
    def plain(cell: str) -> str:
        """Strip markdown emphasis, leaving the text as it reads on the page."""
        s = re.sub(r"\*\*(.+?)\*\*", r"\1", cell)
        s = re.sub(r"\*(.+?)\*", r"\1", s)
        return s.strip()

    @staticmethod
    def html(cell: str) -> str:
        """Markdown emphasis to HTML, for anything going into a description field."""
        s = cell.strip()
        s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
        s = re.sub(r"(?<!\*)\*([^*]+?)\*(?!\*)", r"<em>\1</em>", s)
        return f"<p>{s}</p>" if s else ""

    @staticmethod
    def silver(cell: str) -> int:
        """IV: one flat currency. '1,200 sp' -> 1200, and an em dash -> 0."""
        m = re.search(r"([\d,]+)", cell.replace("—", ""))
        return int(m.group(1).replace(",", "")) if m else 0

    @staticmethod
    def roll_range(cell: str) -> tuple[int, int]:
        """'00' -> (0, 0); '01-09' -> (1, 9). The book prints d10 and d100 results from
        zero, so the tables built from these use a `1dN-1` formula to match."""
        text = Marrow.plain(cell)
        nums = [int(n) for n in re.findall(r"\d+", text)]
        if not nums:
            raise ValueError(f"no roll range in {cell!r}")
        return (nums[0], nums[-1])


if __name__ == "__main__":
    import sys

    ms = Marrow()
    which = sys.argv[1] if len(sys.argv) > 1 else "III.2"
    for row in ms.table(which):
        print(row)
