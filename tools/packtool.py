"""Read and write Foundry LevelDB compendium packs without a Node toolchain.

Usage:
    python tools/packtool.py dump  <pack-dir> [out.json]
    python tools/packtool.py load  <pack-dir> <in.json>
    python tools/packtool.py list  [packs-dir]

The JSON interchange format is a single object mapping LevelDB key -> document,
e.g. {"!items!AbCdEf0123456789": {"_id": "AbCdEf0123456789", ...}, ...}

Packs are rewritten as a single fresh write-ahead log. The MANIFEST/CURRENT
control files are preserved, which is what lets LevelDB replay the log on open.
"""
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ldb

CONTROL_FILES = ('CURRENT', 'MANIFEST-000002', 'LOG', 'LOCK')
LOG_NAME = '000003.log'


def dump(pack_dir, out_path=None):
    recs = ldb.read_pack(pack_dir)
    docs = {k.decode('utf8'): json.loads(v.decode('utf8')) for k, v in recs.items()}
    docs = dict(sorted(docs.items()))
    text = json.dumps(docs, indent=1, ensure_ascii=False)
    if out_path:
        with open(out_path, 'w', encoding='utf8') as f:
            f.write(text)
        print(f'{pack_dir}: dumped {len(docs)} documents -> {out_path}')
    else:
        print(text)
    return docs


def load(pack_dir, in_path):
    with open(in_path, encoding='utf8') as f:
        docs = json.load(f)
    entries = sorted(
        (k.encode('utf8'), json.dumps(v, ensure_ascii=False, separators=(',', ':')).encode('utf8'))
        for k, v in docs.items()
    )
    os.makedirs(pack_dir, exist_ok=True)
    # A fresh single-batch log fully describes the pack contents.
    ldb.write_log(os.path.join(pack_dir, LOG_NAME), [ldb.build_batch(entries, 1)])
    _ensure_control_files(pack_dir)
    print(f'{in_path}: wrote {len(entries)} documents -> {pack_dir}')


def _ensure_control_files(pack_dir):
    """Copy MANIFEST/CURRENT from a sibling pack if this one has none yet."""
    if os.path.exists(os.path.join(pack_dir, 'CURRENT')):
        return
    parent = os.path.dirname(os.path.abspath(pack_dir))
    for sibling in sorted(os.listdir(parent)):
        spath = os.path.join(parent, sibling)
        if spath == os.path.abspath(pack_dir) or not os.path.isdir(spath):
            continue
        if os.path.exists(os.path.join(spath, 'CURRENT')):
            for f in CONTROL_FILES:
                src = os.path.join(spath, f)
                if os.path.exists(src):
                    shutil.copy(src, pack_dir)
            return
    raise SystemExit(f'no sibling pack to take control files from for {pack_dir}')


def list_packs(packs_dir='packs'):
    for name in sorted(os.listdir(packs_dir)):
        p = os.path.join(packs_dir, name)
        if os.path.isdir(p):
            try:
                n = len(ldb.read_pack(p))
            except Exception as exc:  # noqa: BLE001 - report and continue
                n = f'ERROR: {exc}'
            print(f'{name:<24} {n}')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    cmd = sys.argv[1]
    if cmd == 'dump':
        dump(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
    elif cmd == 'load':
        load(sys.argv[2], sys.argv[3])
    elif cmd == 'list':
        list_packs(sys.argv[2] if len(sys.argv) > 2 else 'packs')
    else:
        raise SystemExit(__doc__)
