#!/usr/bin/env python3
"""Read-only, version-specific ELF name/xref audit for Demon's Souls v1.07.

Reports file offsets and candidate x86-64 RIP-relative LEA byte-pattern references.
Candidate byte matches are NOT instruction-boundary-verified. Confirm with disassembly.
This is NOT a convar default/type decoder or a GPU workload measurement.
Never writes to the executable, game assets, cache, saves, or launcher settings.

Usage (Windows):
    py -3 tools/local/graphics-convar-xref.py --self-test
    py -3 tools/local/graphics-convar-xref.py --elf "C:\\Games\\PS5\\DMSR\\PPSA01341-1.07\\PPSA01341-app0\\eboot_ps5rs.elf"
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
import sys
from dataclasses import dataclass
from pathlib import Path

NAMES = (
    "particleResolution",
    "particleLowResBudgetFactor",
    "particleDistortionResolution",
    "particleDistortionBudgetFactor",
    "particleRibbonTessDensity",
    "particleEnableAsyncCompute",
    "particleNumShadowCascades",
    "r_ssrEnableOverrides",
    "r_ssrMaxIterations",
    "r_ssrMaxRayLength",
    "r_ssrCutoffDistance",
    "r_ssrMethod",
    "r_contactShadowsEnabled",
)

LOAD = 1
EXECUTABLE = 1
PHDR = struct.Struct("<IIQQQQQQ")
LEA_RAX_RIP = b"\x48\x8d\x05"  # verified encoding used by these 13 sites in v1.07


@dataclass(frozen=True)
class Segment:
    file_offset: int
    vaddr: int
    file_size: int
    flags: int

    def vma_of(self, file_offset: int) -> int | None:
        if self.file_offset <= file_offset < self.file_offset + self.file_size:
            return self.vaddr + file_offset - self.file_offset
        return None


def load_segments(data: bytes) -> list[Segment]:
    if len(data) < 64 or data[:4] != b"\x7fELF" or data[4] != 2 or data[5] != 1:
        raise ValueError("Expected little-endian ELF64; eboot.bin SELF is NOT supported")
    if struct.unpack_from("<H", data, 18)[0] != 0x3E:
        raise ValueError("Expected x86-64 (EM_X86_64) ELF machine")
    phoff = struct.unpack_from("<Q", data, 32)[0]
    phentsize, phnum = struct.unpack_from("<HH", data, 54)
    if phentsize < PHDR.size or phnum == 0 or phoff + phnum * phentsize > len(data):
        raise ValueError("Invalid or truncated ELF program headers")

    result = []
    for idx in range(phnum):
        typ, flags, offset, vaddr, _paddr, file_size, _mem_size, _align = PHDR.unpack_from(
            data, phoff + idx * phentsize
        )
        if typ == LOAD and file_size:
            if offset + file_size > len(data):
                raise ValueError(f"Truncated PT_LOAD segment {idx}")
            result.append(Segment(offset, vaddr, file_size, flags))
    if not result or not any(segment.flags & EXECUTABLE for segment in result):
        raise ValueError("ELF has no loadable executable code")
    return result


def audit(data: bytes, names: tuple[str, ...] = NAMES) -> dict:
    segments = load_segments(data)

    def vma_of(offset: int) -> int | None:
        for segment in segments:
            vma = segment.vma_of(offset)
            if vma is not None:
                return vma
        return None

    found: dict[str, dict] = {}
    targets: dict[int, list[str]] = {}
    for name in names:
        needle = name.encode("ascii") + b"\x00"
        occurrences = []
        cursor = 0
        while True:
            at = data.find(needle, cursor)
            if at < 0:
                break
            vma = vma_of(at)
            # All verified v1.07 names begin immediately after NUL. Reject
            # suffixes of longer strings such as XparticleResolution\0.
            if vma is not None and (at == 0 or data[at - 1] == 0):
                occurrences.append({"file_offset": f"0x{at:x}", "vma": f"0x{vma:x}"})
                targets.setdefault(vma, []).append(name)
            cursor = at + 1
        found[name] = {"strings": occurrences, "rip_lea_xrefs": []}

    for segment in segments:
        if not segment.flags & EXECUTABLE:
            continue
        code = memoryview(data)[segment.file_offset : segment.file_offset + segment.file_size]
        for match in re.finditer(re.escape(LEA_RAX_RIP), code):
            displacement_pos = match.start() + len(LEA_RAX_RIP)
            if displacement_pos + 4 > len(code):
                continue
            disp = struct.unpack_from("<i", code, displacement_pos)[0]
            instruction_vma = segment.vaddr + match.start()
            target_vma = instruction_vma + 7 + disp
            for name in targets.get(target_vma, ()):
                found[name]["rip_lea_xrefs"].append(f"0x{instruction_vma:x}")

    return {
        "sha256": hashlib.sha256(data).hexdigest(),
        "scope": "NUL-bounded name matches and 48 8D 05 RIP-relative LEA byte-pattern candidates only",
        "limitations": "Byte candidates can occur inside other instructions; no instruction-boundary proof, defaults/types, relocations, dynamic values, effective settings or GPU time",
        "controls": found,
    }


def self_test() -> None:
    # Minimal in-memory ELF64 with a code segment and a read-only name segment.
    test = bytearray(0x500)
    test[:6] = b"\x7fELF\x02\x01"
    struct.pack_into("<H", test, 18, 0x3E)  # EM_X86_64
    struct.pack_into("<Q", test, 32, 0x40)
    struct.pack_into("<HH", test, 54, PHDR.size, 2)
    PHDR.pack_into(test, 0x40, LOAD, EXECUTABLE, 0x200, 0x1000, 0, 0x100, 0x100, 0x1000)
    PHDR.pack_into(test, 0x40 + PHDR.size, LOAD, 4, 0x400, 0x3000, 0, 0x100, 0x100, 0x1000)
    test[0x410 : 0x410 + 5] = b"demo\x00"
    test[0x420 : 0x420 + 6] = b"Xdemo\x00"  # must not match demo suffix
    lea_vma = 0x1010
    displacement = 0x3010 - (lea_vma + 7)
    test[0x210 : 0x217] = LEA_RAX_RIP + struct.pack("<i", displacement)
    result = audit(bytes(test), ("demo", "missing"))
    assert result["controls"]["demo"]["strings"] == [
        {"file_offset": "0x410", "vma": "0x3010"}
    ]
    assert result["controls"]["demo"]["rip_lea_xrefs"] == ["0x1010"]
    assert result["controls"]["missing"]["strings"] == []
    assert result["controls"]["missing"]["rip_lea_xrefs"] == []
    non_x86 = bytearray(test)
    struct.pack_into("<H", non_x86, 18, 0xB7)  # EM_AARCH64
    try:
        load_segments(bytes(non_x86))
    except ValueError:
        pass
    else:
        raise AssertionError("non-x86 ELF must be rejected")
    try:
        load_segments(b"\x54\x14\xf5\xee" + bytes(64))
    except ValueError:
        pass
    else:
        raise AssertionError("SELF header must be rejected")
    print("PASS: synthetic ELF mapping, LEA byte candidate, name boundaries, missing name, architecture and SELF rejection")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--elf", type=Path, help="Read-only path to a decrypted ELF64")
    parser.add_argument("--self-test", action="store_true", help="Run in-memory fixture; no game files")
    parser.add_argument("--json", action="store_true", help="Print JSON instead of a text table")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        if not args.elf:
            return 0
    if args.elf is None:
        parser.error("Pass --elf or --self-test")

    result = audit(args.elf.read_bytes())
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print("ELF SHA-256:", result["sha256"])
        print("Scope:", result["scope"])
        for name, evidence in result["controls"].items():
            positions = ",".join(loc["file_offset"] + "/" + loc["vma"] for loc in evidence["strings"]) or "NONE"
            xrefs = ",".join(evidence["rip_lea_xrefs"]) or "NONE"
            print(f"{name}: strings={positions}, RIP-LEA-candidates={xrefs}")
        print("LIMITATION:", result["limitations"])

    complete = all(
        len(item["strings"]) == 1 and len(item["rip_lea_xrefs"]) >= 1
        for item in result["controls"].values()
    )
    if not complete:
        print("INCOMPLETE: an expected name or LEA-byte candidate was not found", file=sys.stderr)
    return 0 if complete else 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(2)
