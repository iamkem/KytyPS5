# Stage 5 — Adaptive Texture Offload (2026-10-23)

## Why this experiment exists

On 24 GiB Windows host, gameplay v11 Stutter Guard (log `_Build/run-logs/20261023-140733-513.out.log`) reduced the total synchronous pipeline remakes from v10's 1,431 to 507, but available RAM still declined near 1 GiB. It reached 1,036 MiB in shader prefetch samples, and process working set exceeded 13 GiB. GPU video-memory usage was ~6.3 GiB of 10.9 GiB budget; reducing VRAM budget is not a direct solution.

The repo contains a preexisting `TextureOffload` implementation. It is normally enabled by default only on Windows hosts with <=20 GiB RAM, and was OFF on this 24 GiB system. The existing source documents a prior 16 GiB machine test which freed up to ~2 GiB on a 1-1 / Stonefang / 1-1 route; that is **not** an expected or measured result for this computer.

## What v12 adds

Isolated native build `_Build/windows-ram-offload/kyty_emulator.exe`; isolated launcher `_Build/demons-souls-launcher-v12/DemonsSoulsLauncher-win32-x64/DemonsSoulsLauncher.exe`.

Options > Advanced:
- **RAM Safety Mode** = On (Stage 1-4 safeguards; Stage 4 Stutter Guard remains).
- **Extended Memory Mode (RAM16)** = On.
- **Experimental Texture Offload** = **Off by default**. Opt-in On is a high-risk experiment to recover duplicate guest texture RAM.

The launcher sends the following flags only when both RAM Safety and RAM16 are enabled and Texture Offload is explicitly On:
- `KYTY_TEXTURE_OFFLOAD=1`
- `KYTY_TEXTURE_OFFLOAD_ADAPTIVE=1`
- `KYTY_TEXTURE_OFFLOAD_CHECK_MB=8`

The native logic calls the existing texture-offload code, but scans for new candidates **only when physical available RAM declines below ~1/3 of total** (approximately 8 GiB on this machine). It pauses new candidate scans after recovery beyond roughly 10 GiB (2 GiB hysteresis). It continues to drain / restore already offloaded pages even if candidate scans are paused. At each 120 flips, at most 8 MiB of new image downloads are scheduled for equivalence checks, compared with the preexisting 16 MiB default.

Eligibility is the existing source's conservative GPU/guest-byte comparison: clean, sampled-only images with no GPU/CPU dirty bytes, whole valid mapped ranges, and a byte-for-byte GPU download match. Duplicate host pages can then be discarded (the GPU image becomes their sole temporary copy), and are restored on a later access.

## Critical safety limits

**Not yet safe for production gameplay.** The preexisting offload implementation can produce `Texture offload: MISSED ... (zeros until restored)` when a thread cannot wait for GPU restoration; it can also produce `Texture offload: LOST ...` if the image can no longer be downloaded. Both are unacceptable for a final lossless memory optimization. Page faults, GPU download checks, restore stalls, data corruption and a BSOD are possible. This experiment cannot be claimed as a fix for Windows MEMORY_MANAGEMENT bugchecks. The user must not run unattended stress tests, and should back up save data before trying.

**Stop immediately if** the log shows `MISSED`, `LOST`, texture corruption, a hang, or RAM falls below 1 GiB. Leave the setting Off for ordinary gameplay. Windows/SSD I/O due to Stage 3 normal file writeback can also add stutter.

To roll back: use Launcher v11 executable with its normal RAM Safety Mode, or turn Texture Offload Off in v12. v9/v10 and all game/save/shader files are untouched.

## Validation

- Native `memory-pressure-policy-test.cpp` Windows compile/tests: PASS, including 8/10 GiB hysteresis and unknown-memory disabled policy.
- Native isolated Windows build+link: PASS.
- Launcher unit tests: 48 tests; rerun after new native executable exists.
- Launcher packaged UI smoke: pending final run.
- Real gameplay: **not executed**. No savings, FPS improvements, no-error claims, or crash prevention established.

## Run acceptance with matched short scene

Use v11 as the gameplay baseline. On a separate short controlled session in v12 (only after saving a backup), turn Experimental Texture Offload On. Compare Windows physical available RAM, emulator working set, disk activity and stutter in the same location. Logs should show `Texture offload: on`, `Texture offload: adaptive scan started`, and 30-second periodic report `Texture offload: N MiB out of RAM now`, `restores`, `missed`, `lost`. **Any missed/lost page fails the safety gate**, regardless of potential RAM savings.

If this cannot pass the gate, revert to v11; further optimization needs fixing unsafe nonwaiting restore and image-lifetime paths, not merely tuning RAM thresholds.

### Local checkout note

The native binary also includes unrelated preexisting uncommitted modifications `staticPrecompile.inc`, `vma.cpp`, and `local-platform.{cpp,h}`; these were neither committed nor overwritten by Stage 5.
