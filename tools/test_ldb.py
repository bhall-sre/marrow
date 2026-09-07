#!/usr/bin/env python3
"""Tests for the LevelDB layer.

These exist because reading a pack back with the same code that wrote it proves nothing.
Both of the bugs below round-tripped perfectly through our own reader and were still broken
in Foundry:

  * The record checksum covers the type byte and the payload -- NOT the length. Our writer
    included the length, so every pack it produced had invalid checksums. LevelDB with
    paranoid_checks off (the default) silently DROPS records that fail crc32c: no error,
    no warning, documents simply gone.

  * A pack with no CURRENT/MANIFEST cannot be opened by LevelDB at all and shows up as an
    empty compendium.

So the checks here compare against bytes produced by a real Foundry pack, and assert that
corruption is rejected rather than tolerated.

Usage:  python tools/test_ldb.py [path-to-a-real-untouched-pack-dir]
"""
from __future__ import annotations

import json
import os
import shutil
import struct
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ldb        # noqa: E402
import packtool   # noqa: E402

failures = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}{f'  -- {detail}' if detail and not ok else ''}")
    if not ok:
        failures += 1


def test_roundtrip() -> None:
    """A document larger than one 32 KiB block must survive fragmentation."""
    print("round-trip")
    d = tempfile.mkdtemp()
    try:
        entries = sorted([
            (b"!items!aaaaaaaaaaaaaaaa", json.dumps({"_id": "a", "name": "x" * 50000}).encode()),
            (b"!items!bbbbbbbbbbbbbbbb", json.dumps({"_id": "b", "name": "short"}).encode()),
        ])
        ldb.write_log(os.path.join(d, "000003.log"), [ldb.build_batch(entries, 1)])
        packtool._ensure_control_files(d)
        check("multi-block document survives", ldb.read_pack(d) == dict(entries))
    finally:
        shutil.rmtree(d)


def test_deletes() -> None:
    """A later batch deleting a key must win over the earlier one that wrote it."""
    print("deletes")
    d = tempfile.mkdtemp()
    try:
        key = b"!items!aaaaaaaaaaaaaaaa"
        ldb.write_log(os.path.join(d, "000003.log"), [
            ldb.build_batch([(key, b'{"_id":"a"}')], 1),
            ldb.build_batch([(key, None)], 2),
        ])
        packtool._ensure_control_files(d)
        check("deleted key is gone", key not in ldb.read_pack(d))
    finally:
        shutil.rmtree(d)


def test_corruption_is_rejected() -> None:
    """The check that would have caught the checksum bug."""
    print("corruption")
    d = tempfile.mkdtemp()
    try:
        log = os.path.join(d, "000003.log")
        ldb.write_log(log, [ldb.build_batch(
            [(b"!items!aaaaaaaaaaaaaaaa", b'{"_id":"a","name":"Kept"}')], 1)])
        packtool._ensure_control_files(d)
        check("clean pack reads", len(ldb.read_pack(d)) == 1)

        raw = bytearray(open(log, "rb").read())
        raw[-3] ^= 0xFF                      # flip a payload byte, leaving a stale crc
        open(log, "wb").write(bytes(raw))

        try:
            ldb.read_pack(d)
        except ValueError:
            check("corrupted record is rejected", True)
        else:
            check("corrupted record is rejected", False, "read happily -- crc not verified")
    finally:
        shutil.rmtree(d)


def test_control_files() -> None:
    """CURRENT and MANIFEST must be generated, not copied from a sibling."""
    print("control files")
    d = tempfile.mkdtemp()
    try:
        packtool._ensure_control_files(d)
        current = open(os.path.join(d, "CURRENT"), "rb").read()
        check("CURRENT points at the manifest", current == b"MANIFEST-000002" + bytes([0x0A]))

        records = list(ldb.read_log_records(os.path.join(d, "MANIFEST-000002")))
        check("manifest has two records", len(records) == 2, f"got {len(records)}")
        check("first record names the comparator",
              records[0] == bytes([1, 26]) + b"leveldb.BytewiseComparator")
        # tag 2 log=3, tag 9 prev=0, tag 3 next-file=4, tag 4 last-seq=0
        check("second record carries the file state",
              records[1] == bytes([2, 3, 9, 0, 3, 4, 4, 0]))
    finally:
        shutil.rmtree(d)


def test_against_real_pack(path: str) -> None:
    """The only check that is not self-referential: bytes from a real Foundry pack."""
    print(f"real pack: {path}")
    logs = [f for f in os.listdir(path) if f.endswith(".log")]
    if not logs:
        check("has a log file", False)
        return

    data = open(os.path.join(path, logs[0]), "rb").read()
    pos = matched = total = 0
    while pos + ldb.HEADER <= len(data):
        off = pos % ldb.BLOCK
        if ldb.BLOCK - off < ldb.HEADER:
            pos += ldb.BLOCK - off
            continue
        crc, length, rtype = struct.unpack("<IHB", data[pos:pos + ldb.HEADER])
        if rtype == 0 and length == 0:
            pos += ldb.BLOCK - off
            continue
        chunk = data[pos + ldb.HEADER:pos + ldb.HEADER + length]
        total += 1
        matched += ldb.mask_crc(ldb.crc32c(ldb.record_crc_input(rtype, chunk))) == crc
        pos += ldb.HEADER + length

    check(f"our crc32c agrees on all {total} records", total > 0 and matched == total,
          f"{matched}/{total}")

    manifest = os.path.join(path, "MANIFEST-000002")
    if os.path.exists(manifest):
        d = tempfile.mkdtemp()
        try:
            packtool._ensure_control_files(d)
            ours = open(os.path.join(d, "MANIFEST-000002"), "rb").read()
            check("our manifest is byte-identical", ours == open(manifest, "rb").read())
        finally:
            shutil.rmtree(d)


def main() -> int:
    test_roundtrip()
    test_deletes()
    test_corruption_is_rejected()
    test_control_files()

    if len(sys.argv) > 1:
        test_against_real_pack(sys.argv[1])
    else:
        print("real pack: skipped (pass a pack directory to compare against real bytes)")

    print(f"\n{'all passed' if not failures else f'{failures} failed'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
