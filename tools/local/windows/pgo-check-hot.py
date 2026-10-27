#!/usr/bin/env python3
"""Read-only Clang/LLVM PGO compatibility check for three KytyPS5 hot TUs.

Uses the canonical latest/native-build compiler commands. Replays front-end code
generation into stdout (discarded), never emitting objects, IR files, depfiles,
or game executables. The current binary and profile are not modified.

Windows PowerShell from the repository root:
    python -B tools/local/windows/pgo-check-hot.py
    python -B tools/local/windows/pgo-check-hot.py --strict

--strict returns exit 1 when Clang reports stale function profiles. Exit 2 means
the check failed, not that the profile matches.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
BUILD = ROOT / "_Build" / "latest" / "native-build"
FILES = ("renderDraw.cpp", "bufferCache.cpp", "graphicsRun.cpp")
WARNING = re.compile(r"(?:of\s+)?([\d,]+)\s+functions?,\s*([\d,]+)\s+(?:has|have)\s+mismatched\s+data", re.I)
WARNING_REVERSE = re.compile(r"([\d,]+)\s+of\s+([\d,]+)\s+functions?\s+(?:has|have)\s+mismatched\s+data", re.I)


def command_table() -> list[dict]:
    cache = BUILD / "CMakeCache.txt"
    try:
        entry = next(
            line.split("=", 1)[1]
            for line in cache.read_text(encoding="utf-8").splitlines()
            if line.startswith("CMAKE_MAKE_PROGRAM:")
        )
    except (OSError, StopIteration) as exc:
        raise RuntimeError(f"Cannot find Ninja from canonical {cache}") from exc
    res = subprocess.run(
        [entry, "-C", str(BUILD), "-t", "compdb", "-x"],
        cwd=ROOT, capture_output=True, text=True, errors="replace", check=False,
    )
    if res.returncode:
        raise RuntimeError(f"Ninja compdb exit={res.returncode}: {res.stderr[-1200:]}")
    return json.loads(res.stdout)


def diagnose(entry: dict) -> tuple[int, str]:
    # Canonical Ninja command is unquoted in this build. Refuse to guess about
    # Windows quoting if a future generator changes it.
    command = entry["command"]
    argv = command.split()
    if any('"' in part or part.startswith("@") for part in argv):
        raise RuntimeError(f"Unsupported quoted/@rsp compile entry for {entry['file']}")
    argv = [
        part for part in argv if not part.startswith(
            ("-clang:-MD", "-clang:-MT", "-clang:-MF", "/Fo", "/Fd")
        ) and part != "-Wno-profile-instr-out-of-date"
    ]
    try:
        at = argv.index("--")
    except ValueError as exc:
        raise RuntimeError(f"Unsupported clang command missing '--': {entry['file']}") from exc
    # -S -emit-llvm -o - produces IR on stdout. Discard it; no file created.
    argv[at:at] = [
        "-Wprofile-instr-out-of-date", "/clang:-S",
        "/clang:-emit-llvm", "/clang:-o", "/clang:-",
        "-fno-crash-diagnostics",
    ]
    res = subprocess.run(
        argv, cwd=entry["directory"], stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE, text=True, errors="replace", check=False,
    )
    return res.returncode, res.stderr


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--strict", action="store_true", help="Exit 1 when any stale PGO functions are found")
    args = parser.parse_args()
    try:
        table = command_table()
        matches = {
            Path(row["file"]).name: row for row in table
            if "CMakeFiles/kyty_emulator.dir/" in row.get("output", "").replace("\\", "/")
            and Path(row["file"]).name in FILES
        }
        missing = set(FILES).difference(matches)
        if missing:
            raise RuntimeError(f"Missing kyty_emulator compile commands for: {sorted(missing)}")
        print("PGO CODEGEN CHECK | latest/native-build | no output files")
        total = 0
        for name in FILES:
            exit_code, warnings = diagnose(matches[name])
            if exit_code:
                print(f"{name}: CODEGEN FAIL exit={exit_code}\n{warnings[-1800:]}")
                return 2
            result = WARNING.search(warnings)
            reverse = WARNING_REVERSE.search(warnings)
            if result:
                functions = int(result.group(1).replace(",", ""))
                mismatches = int(result.group(2).replace(",", ""))
            elif reverse:
                mismatches = int(reverse.group(1).replace(",", ""))
                functions = int(reverse.group(2).replace(",", ""))
            else:
                if "mismatched data" in warnings.lower():
                    print(f"{name}: UNPARSED PGO WARNING\n{warnings[-1800:]}")
                    return 2
                functions = None
                mismatches = 0
            total += mismatches
            print(f"{name}: exit=0 stale={mismatches} total_functions={functions if functions is not None else 'not-reported'}")
        print(f"TOTAL compiler_reported_mismatches={total}; this does not count profile records classified as unknown_function when hash bit 60 differs; no measured FPS change.")
        return 1 if args.strict and total else 0
    except (RuntimeError, ValueError, KeyError, OSError, json.JSONDecodeError) as exc:
        print(f"PGO CODEGEN CHECK FAILED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
