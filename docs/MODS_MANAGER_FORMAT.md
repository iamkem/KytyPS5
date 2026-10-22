# Demon's Souls PC / KytyPS5 — Mods Manager v6 file format and safety

This document describes the actual **loose-asset replacement manager**, not a universal PS5 mod loader. Acceptance at import/preflight means the asset layout passes validation; it does **not** prove Demon's Souls loads or interprets the mod correctly.

## Accepted layout

Import either a directory containing game-relative loose assets, or a .zip with the same relative structure:

```text
My-Mod.zip
├── textures/
│   └── .../replacement.dds
├── characters/
│   └── .../replacement.dcx
├── text/
│   └── ds/_cmn/goods_name.en.ctxt
└── readme.txt           # Optional root-level metadata, ignored
```

The asset folders must represent the **same relative paths as the actual game's `PPSA01341-app0` directory**. A ZIP may have one or two enclosing folders (for example `ModName/PPSA01341-app0/text/...`); the importer looks for actual asset roots and copies only those. It does not search archives inside archives or repack game containers.

Permitted *top-level asset folder names* in the current source (`launcher-electron/mod-manager.cjs`):

```text
characters   cinematics   collision    coredata      cp11demonssouls
globalillumination         levels       materials     misc
model        models       movies        particles     parts
props        scripts      sky           sound         test
text         textures     ui            virtualgeo    weapons
workspaces
```

These folders are an **allowlist for location**, not evidence that every file format/game build inside them is supported. Asset extensions such as `.dds`, `.dcx`, `.ctxt`, `.ctxr`, and `.cfon` are not blocked by the parser. The file contents still must match the target game's expected format.

Top-level `readme`, `license`, `changelog`, `description` text/Markdown files are ignored when named as accepted by the importer. Unrelated files or custom installer structures may be rejected.

## Rejected layout/content

- `eboot.bin`, `sce_module/`, `sce_sys/`, saves, shader caches, emulator/launcher configuration files, absolute paths or `../` traversal.
- Executable/script extensions including `.exe`, `.dll`, `.prx`, `.elf`, `.bin`, `.bat`, `.cmd`, `.ps1`, `.vbs`, `.js`, `.py`, `.lua`, `.sh`, `.so`, `.dylib`, `.jar`, `.msi`, `.lnk`, `.sys`, `.com`, `.scr`, `.reg`, `.node`.
- Symbolic links, nonregular files, Windows-reserved path segments, and case-insensitive duplicate filenames.
- More than 4,000 asset files, larger than 2 GiB per file, or larger than 8 GiB total uncompressed.
- Packed mod distribution formats needing dedicated conversion, repacking or runtime injection. A valid ZIP is merely a transport for loose files.

Mods made for the **PS3 Demon's Souls** or a different PS5 title update are not automatically compatible with the PS5 remake v1.07.

## Safe workflow

1. Inspect the mod archive/folder and its target game version before importing.
2. In **Options → Mods**, choose **Add Folder** or **Import ZIP**. Imported mods are initially disabled and copied to `_Mods/packages/<uuid>/` outside the game.
3. Select the mod and choose **Inspect Files**. This read-only SHA-256 preflight lists each file and classifies it:
   - **REPLACE**: existing game file differs; enabling will back it up and replace it.
   - **ADD**: file does not exist in the installed game.
   - **IDENTICAL**: hashes are identical; no content difference.
   - **CONFLICT**: a different active mod owns this relative path; enable is blocked.
   - **INVALID**: unsafe/missing/changed package, unsafe destination, or modified deployed file; action is blocked.
   - **RESTORE / REMOVE** (active mod): what disabling will restore or remove.
4. **Enable** performs a fresh preflight and displays the counts and selected paths before the existing explicit confirmation. The transaction still rechecks packages, owners and originals before writing.
5. Test gameplay compatibility only when safe to do so, and disable via the manager afterward to restore verified originals. Do not manually edit files while a mod is enabled.
6. If an operation was interrupted, use **Repair Incomplete Change**. Recovery refuses unknown external edits.

The hash preview may read substantial data for large mods; it changes **no game files**. Nothing is applied merely by importing or inspecting.

### Compatibility levels

- **Structurally accepted**: file names, paths and archive shape pass validation.
- **Preflight passed**: imported package and installed paths/hashes are consistent, with no conflicts.
- **Runtime compatible**: requires explicit gameplay validation (asset actually loaded correctly), not established by unit tests or preflight.

Back up your *own* game installation before any future real-world compatibility trial; the manager's original-file backups are not a replacement for a full user-controlled game backup. Neither import nor inspection touches saves, shader cache, GPU/kernel code, or launcher settings.

## Current imported-package observation (2026-10-22)

Read-only inspection of disabled `PPSA01341-app0` package: **69 asset files / 25,237,425 bytes**; **68 REPLACE**, **0 ADD**, **1 IDENTICAL**, **0 CONFLICT**, **0 INVALID**; **0 applied files**, no pending repair. This is a path/hash result only. It was **not enabled and not tested in gameplay**.
