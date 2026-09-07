"""Minimal pure-Python LevelDB write-ahead-log reader/writer.

Foundry v11+ compendium packs are LevelDB directories. The packs in this repo
have never been compacted, so every record still lives in the .log (WAL) file,
which makes a WAL-only reader sufficient to read them.
"""
import struct, os, glob

BLOCK = 32768
HEADER = 7  # crc32c(4) + length(2) + type(1)
FULL, FIRST, MIDDLE, LAST = 1, 2, 3, 4

# --- crc32c (Castagnoli), needed to write valid records -------------------
_POLY = 0x82F63B78
_TABLE = []
for _i in range(256):
    _c = _i
    for _ in range(8):
        _c = (_c >> 1) ^ (_POLY if _c & 1 else 0)
    _TABLE.append(_c)

def crc32c(data, crc=0):
    crc ^= 0xFFFFFFFF
    for b in data:
        crc = _TABLE[(crc ^ b) & 0xFF] ^ (crc >> 8)
    return crc ^ 0xFFFFFFFF

def mask_crc(c):
    return (((c >> 15) | (c << 17)) + 0xA282EAD8) & 0xFFFFFFFF

# --- varint ---------------------------------------------------------------
def read_varint(buf, i):
    result = shift = 0
    while True:
        b = buf[i]; i += 1
        result |= (b & 0x7F) << shift
        if not (b & 0x80):
            return result, i
        shift += 7

def write_varint(n):
    out = bytearray()
    while n >= 0x80:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    out.append(n)
    return bytes(out)

def record_crc_input(rtype, chunk):
    """LevelDB checksums the record type byte and the payload -- and not the length.

    Verified against untouched vendor packs: crc32c(type + data) matches, and
    crc32c(length + type + data) does not.
    """
    return bytes([rtype]) + chunk

# --- WAL record layer -----------------------------------------------------
def read_log_records(path, verify=True):
    """Yield reassembled WriteBatch payloads from a LevelDB .log file.

    `verify` checks each record's crc32c. LevelDB itself does this on open and, with
    paranoid_checks off (the default), silently DROPS any record that fails -- so a bad
    checksum does not raise, it just loses documents. Reading without verifying will
    therefore happily report a pack that Foundry sees as empty or truncated.
    """
    data = open(path, 'rb').read()
    pos = 0
    pending = bytearray()
    while pos + HEADER <= len(data):
        off = pos % BLOCK
        if BLOCK - off < HEADER:
            pos += BLOCK - off
            continue
        crc, length, rtype = struct.unpack('<IHB', data[pos:pos + HEADER])
        if rtype == 0 and length == 0:
            pos += BLOCK - off
            continue
        payload = data[pos + HEADER:pos + HEADER + length]
        if verify and mask_crc(crc32c(record_crc_input(rtype, payload))) != crc:
            raise ValueError(
                f'{path}: bad crc32c at offset {pos} -- LevelDB would drop this record')
        pos += HEADER + length
        if rtype == FULL:
            yield bytes(payload)
        elif rtype == FIRST:
            pending = bytearray(payload)
        elif rtype == MIDDLE:
            pending += payload
        elif rtype == LAST:
            pending += payload
            yield bytes(pending)
            pending = bytearray()

def parse_batch(batch):
    """Yield (key, value_or_None) from a WriteBatch payload."""
    i = 12  # sequence(8) + count(4)
    count = struct.unpack('<I', batch[8:12])[0]
    for _ in range(count):
        vtype = batch[i]; i += 1
        klen, i = read_varint(batch, i)
        key = batch[i:i + klen]; i += klen
        if vtype == 1:
            vlen, i = read_varint(batch, i)
            val = batch[i:i + vlen]; i += vlen
            yield key, val
        else:
            yield key, None

def read_pack(dirpath):
    """Return {key: value} for a LevelDB pack directory, honouring later writes."""
    out = {}
    for logf in sorted(glob.glob(os.path.join(dirpath, '*.log'))):
        for batch in read_log_records(logf):
            for k, v in parse_batch(batch):
                if v is None:
                    out.pop(k, None)
                else:
                    out[k] = v
    return out

# --- writing --------------------------------------------------------------
def build_batch(entries, seq):
    """entries: list of (key: bytes, value: bytes|None)."""
    out = bytearray(struct.pack('<QI', seq, len(entries)))
    for k, v in entries:
        if v is None:
            out += b'\x00' + write_varint(len(k)) + k
        else:
            out += b'\x01' + write_varint(len(k)) + k + write_varint(len(v)) + v
    return bytes(out)

def write_log(path, batches):
    """Write WriteBatch payloads into a LevelDB .log file, fragmenting per block."""
    out = bytearray()
    for payload in batches:
        p, first = payload, True
        while True:
            off = len(out) % BLOCK
            avail = BLOCK - off
            if avail < HEADER:
                out += b'\x00' * avail
                off, avail = 0, BLOCK
            space = avail - HEADER
            chunk, p = p[:space], p[space:]
            if first and not p:
                rtype = FULL
            elif first:
                rtype = FIRST
            elif not p:
                rtype = LAST
            else:
                rtype = MIDDLE
            crc = mask_crc(crc32c(record_crc_input(rtype, chunk)))
            out += struct.pack('<I', crc) + struct.pack('<HB', len(chunk), rtype) + chunk
            first = False
            if not p:
                break
    open(path, 'wb').write(bytes(out))
