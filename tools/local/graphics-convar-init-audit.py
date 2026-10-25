#!/usr/bin/env python3
r"""Read-only, SHA-pinned P2/P3 *constructor* value verifier (Demon's Souls v1.07).

It verifies ELF64 PT_LOAD mappings, R_X86_64_RELATIVE relocations, constructor
call targets and selected instruction/data bytes independently of runtime.
It then extracts constructor-write values; it DOES NOT infer effective
configuration after profile overrides, enum labels, pass execution, or GPU ms.

    py -3 tools/local/graphics-convar-init-audit.py --self-test
    py -3 tools/local/graphics-convar-init-audit.py --elf "C:\Games\PS5\DMSR\PPSA01341-1.07\PPSA01341-app0\eboot_ps5rs.elf"

No game process is launched and no files are written. Fail closed on other ELF
versions; investigate/revalidate a changed binary instead of bypassing the SHA.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

PINNED_SHA256 = "f81e414defc06fbca78b40eaec3e80f6631c0e77519b03110952a7efde1b0654"
BASE_POINTER_SLOT = 0x26D22F0
BACKING_BASE = 0x2F13B40
CTOR_TABLE_SLOT = 0x26D6308
CTOR_ENTRY = 0x940040
PHDR = struct.Struct("<IIQQQQQQ")
RELA = struct.Struct("<QQq")
CODE_SIGNATURES = {
    # Constructor chain: 0x940040 (invoked through relocated constructor table).
    0x9400C7: "e8f44a0000",   # call 0x944bc0: lighting
    0x9400D3: "e898c30000",   # call 0x94c470: SSR
    0x9400DF: "e89cbd0100",   # call 0x95be80: particle
    0x944C26: "66c7475c0001",                 # word [rdi+0x5c]=0x100
    0x94C476: "c5f8100562abba01",             # read SSR method from 0x24f6fe0
    0x94C4AD: "c5f8114720",                   # vector [rdi+0x20]
    0x94C4B6: "e8e51a1300",                   # call 0xa7dfa0: SSR subgroup
    0xA7DFA0: "c4e2791805ff009001",           # vbroadcastss from 0x237e0a8
    0xA7DFA9: "c60700",                       # bool [rdi+0]=false
    0xA7DFAC: "c7470480000000",               # int [rdi+4]=128
    0xA7DFB3: "c5f8134708",                   # store duplicated float at [rdi+8]
    0x95BEAB: "48b80000803f05000000",        # immediate with 1.0f low dword
    0x95BF21: "48898780000000",               # qword [rdi+0x80]
    0x95BF28: "48b80200000002000000",        # enum numeric 2,2
    0x95BF32: "c6878800000001",               # bool [rdi+0x88]=true
    0x95BF39: "c7878c00000002000000",        # int [rdi+0x8c]=2
    0x95BF4B: "48898798000000",               # qword [rdi+0x98]
    0x95BEA3: "c5fb101da586b901",             # read 2 floats from 0x24f4550
    0x95BF52: "c5fb119fa0000000",            # store 2 floats [rdi+0xa0]
}


def ensure(condition: bool, description: str) -> None:
    if not condition:
        raise ValueError(f"Evidence gate failed: {description}")


def relative_call_target(address: int, raw: bytes) -> int:
    ensure(len(raw) == 5 and raw[0] == 0xE8, "expected call rel32")
    return address + 5 + struct.unpack_from("<i", raw, 1)[0]


def vma_to_file(vma: int, segments: list[tuple[int, int, int, int]]) -> int | None:
    for file_off, mem_vma, file_size, _mem_size in segments:
        if mem_vma <= vma < mem_vma + file_size:
            return file_off + vma - mem_vma
    return None


def load_elf(data: bytes) -> tuple[list[tuple[int, int, int, int]], dict[int, int]]:
    ensure(len(data) >= 64 and data[:6] == b"\x7fELF\x02\x01", "ELF64 little-endian")
    ensure(struct.unpack_from("<H", data, 18)[0] == 62, "x86-64 machine")
    phoff = struct.unpack_from("<Q", data, 32)[0]
    entsz, count = struct.unpack_from("<HH", data, 54)
    ensure(entsz >= PHDR.size and count > 0 and phoff + entsz * count <= len(data),
           "valid ELF program headers")
    segments: list[tuple[int, int, int, int]] = []
    dynamic = None
    for i in range(count):
        typ, _flags, off, vma, _phys, file_size, mem_size, _align = PHDR.unpack_from(
            data, phoff + i * entsz
        )
        if typ == 1:
            ensure(off + file_size <= len(data) and mem_size >= file_size, "load segment bounds")
            segments.append((off, vma, file_size, mem_size))
        if typ == 2:
            ensure(off + file_size <= len(data), "dynamic segment bounds")
            ensure(dynamic is None, "single PT_DYNAMIC")
            dynamic = (off, file_size)
    ensure(dynamic is not None, "PT_DYNAMIC present")
    tags: dict[int, int] = {}
    off, size = dynamic
    for pos in range(off, off + size, 16):
        ensure(pos + 16 <= len(data), "dynamic entry bounds")
        tag, val = struct.unpack_from("<QQ", data, pos)
        if tag == 0:
            break
        tags[tag] = val
    return segments, tags


def verify(data: bytes) -> dict:
    sha = hashlib.sha256(data).hexdigest()
    ensure(sha == PINNED_SHA256, f"v1.07 ELF SHA-256 pinned; observed {sha}")
    segments, tags = load_elf(data)

    def read_vma(vma: int, n: int) -> bytes:
        file_offset = vma_to_file(vma, segments)
        ensure(file_offset is not None, f"VMA {vma:#x} must be file-backed")
        ensure(vma_to_file(vma + n - 1, segments) == file_offset + n - 1,
               f"VMA {vma:#x} must be fully file-backed")
        return data[file_offset : file_offset + n]

    ensure(tags.get(12) == 0x10, "DT_INIT=0x10 static initializer walker")
    ensure(tags.get(7) is not None and tags.get(8) and tags.get(9) == RELA.size,
           "DT_RELA/DT_RELASZ/DT_RELAENT")
    reloc_start = vma_to_file(tags[7], segments)
    ensure(reloc_start is not None and vma_to_file(tags[7] + tags[8] - 1, segments) is not None,
           "relocation table file-backed")
    ensure(tags[8] % RELA.size == 0, "whole relocation records")
    relocations = {}
    for at in range(reloc_start, reloc_start + tags[8], RELA.size):
        dest, info, addend = RELA.unpack_from(data, at)
        if dest in (BASE_POINTER_SLOT, CTOR_TABLE_SLOT):
            relocations.setdefault(dest, []).append((info, addend))
    ensure(relocations.get(BASE_POINTER_SLOT) == [(8, BACKING_BASE)],
           "relative relocation of convar backing base")
    ensure(relocations.get(CTOR_TABLE_SLOT) == [(8, CTOR_ENTRY)],
           "relative relocation of executable static constructor")

    ensure(vma_to_file(BACKING_BASE, segments) is None,
           "backing data lives in zero-fill area, not disk data")
    ensure(any(v <= BACKING_BASE < v + mem for _o, v, _size, mem in segments),
           "backing data is inside PT_LOAD memory")

    for address, hexb in CODE_SIGNATURES.items():
        expected = bytes.fromhex(hexb)
        ensure(read_vma(address, len(expected)) == expected,
               f"checked constructor instruction at {address:#x}")
    ensure(relative_call_target(0x9400C7, read_vma(0x9400C7, 5)) == 0x944BC0,
           "lighting constructor call")
    ensure(relative_call_target(0x9400D3, read_vma(0x9400D3, 5)) == 0x94C470,
           "SSR constructor call")
    ensure(relative_call_target(0x9400DF, read_vma(0x9400DF, 5)) == 0x95BE80,
           "particle constructor call")
    ensure(relative_call_target(0x94C4B6, read_vma(0x94C4B6, 5)) == 0xA7DFA0,
           "nested SSR initializer call")
    # Constructor rdi: main +0x34 (lighting), +0x768 (SSR), +0x830 (particle).
    # Target field offsets have independently been matched to name registrations
    # in docs/GRAPHICS_OPTIMIZATION_AUDIT_2026-10-25.md.
    method = struct.unpack("<I", read_vma(0x24F6FE0, 4))[0]
    ssr_dist = struct.unpack("<f", read_vma(0x237E0A8, 4))[0]
    particle_budgets = struct.unpack("<ff", read_vma(0x24F4550, 8))
    ribbon_bits = struct.unpack_from("<Q", read_vma(0x95BEAB, 10), 2)[0]
    particle_resolution_pair = struct.unpack_from("<Q", read_vma(0x95BF28, 10), 2)[0]
    values = [
        ("particleResolution", 0x8C8, "enum numeric", particle_resolution_pair & 0xFFFFFFFF),
        ("particleLowResBudgetFactor", 0x8D4, "float32", round(particle_budgets[1], 7)),
        ("particleDistortionResolution", 0x8CC, "enum numeric", particle_resolution_pair >> 32),
        ("particleDistortionBudgetFactor", 0x8D0, "float32", particle_budgets[0]),
        ("particleRibbonTessDensity", 0x8B0, "float32",
         struct.unpack("<f", struct.pack("<I", ribbon_bits & 0xFFFFFFFF))[0]),
        ("particleEnableAsyncCompute", 0x8B8, "bool", bool(read_vma(0x95BF32, 7)[-1])),
        ("particleNumShadowCascades", 0x8BC, "int32",
         struct.unpack_from("<i", read_vma(0x95BF39, 10), 6)[0]),
        ("r_ssrMethod", 0x788, "enum numeric", method),
        ("r_ssrEnableOverrides", 0x798, "bool", bool(read_vma(0xA7DFA9, 3)[-1])),
        ("r_ssrMaxIterations", 0x79C, "int32",
         struct.unpack_from("<i", read_vma(0xA7DFAC, 7), 3)[0]),
        ("r_ssrCutoffDistance", 0x7A0, "float32", ssr_dist),
        ("r_ssrMaxRayLength", 0x7A4, "float32", ssr_dist),
        ("r_contactShadowsEnabled", 0x91, "bool",
         bool(read_vma(0x944C26, 6)[-1])),
    ]
    return {
        "elf_sha256": sha,
        "evidence_level": "ELF static constructor writes only, BEFORE runtime/profile changes",
        "backing_base_vma": f"0x{BACKING_BASE:x}",
        "relocated_pointer_slot": f"0x{BASE_POINTER_SLOT:x}",
        "constructor_entry": f"0x{CTOR_ENTRY:x}",
        "limitations": "Not effective defaults; enum labels, later writes, pass enablement, GPU cost unknown",
        "values": [
            {"name": name, "backing_offset": f"0x{offset:x}", "type": typ, "constructor_value": value}
            for name, offset, typ, value in values
        ],
    }


def self_test() -> None:
    assert relative_call_target(0x1000, b"\xe8\xfb\x00\x00\x00") == 0x1100
    assert vma_to_file(0x2101, [(0x100, 0x2100, 8, 32)]) == 0x101
    assert vma_to_file(0x2109, [(0x100, 0x2100, 8, 32)]) is None
    assert struct.unpack("<ff", bytes.fromhex("00008040cdcc4c3e"))[0] == 4.0
    print("PASS: relative-call math, ELF PT_LOAD file/BSS boundary and float32 decode")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--elf", type=Path)
    p.add_argument("--json", action="store_true")
    p.add_argument("--self-test", action="store_true")
    args = p.parse_args()
    if args.self_test:
        self_test()
        if not args.elf:
            return 0
    if not args.elf:
        p.error("--elf or --self-test is required")
    result = verify(args.elf.read_bytes())
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print("ELF SHA-256:", result["elf_sha256"])
        print("Evidence:", result["evidence_level"])
        for row in result["values"]:
            print(f'{row["name"]}: constructor={row["constructor_value"]!s}, '
                  f'type={row["type"]}, backing+{row["backing_offset"]}')
        print("LIMITATION:", result["limitations"])
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, struct.error) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(2)
