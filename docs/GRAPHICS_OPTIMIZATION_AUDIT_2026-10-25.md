# Phase Graphics Optimization Audit — PPSA01341 v1.07 (2026-10-25)

## Scope and non-destructive constraints

- Target: **C:\\Users\\hoang\\Desktop\\dev\\KytyPS5** only; no .devspace worktrees, no game writes, no cached shader deletion, no game launch, no native shader precompile.
- Game inspected: `C:\\Games\\PS5\\DMSR\\PPSA01341-1.07\\PPSA01341-app0` source `eboot.bin` + `misc/renderconfig_*.txt` + `coredata/enginesupport/debugmenu/*.txt`. Checked engine variable presence, not their addresses/values at execution.
- Avoid repeating retired model/instance fading (Combined severe geometry corruption, isolated modes no FPS benefit), unsafe shadow LOD, and ineffective engine occlusion switches.

## P0 — Read-only analysis of actual existing logs

Audit command (read-only, no log writes): `node tools/local/graphics-audit-baseline.cjs --recent 12`. Run from repository root. The tool selects only timestamped run `.out.log` files (not shader-precompile logs), extracts **SLOW Frame threshold events only**, categorizes reported high idle/compile/gpu_wait, and intentionally returns `null` for unsupported FPS, 1% low and GPU busy metrics.

For the 12 logs from 2026-10-25 08:30:31–09:32:45, the tool counted **132** thresholded slow events, **77** events with idle >=80% of the recorded slow frame, **52** events with compile >=10 ms, and **8** events with gpu_wait >=10 ms. Most events did not report a gpu_wait field, so **absence is not zero GPU wait**. Selected logs include **retired Model/Instance experiments** and startup/scene loads. Counts can overlap; do not sum classes into a partition. Neither comparison of these counts nor their slow-frame median is a valid controlled FPS, 1% low, GPU-bound or GPU-ms benchmark.

For game-side A/B measurement on RTX 5070, keep DLSS internal render/output, area/save/camera, ambient and spot shadows, FOV, RAM Safety/Diet and Distance Tessellation fixed. Compare **Original → PS4 Base → Original** with a game restart between modes and allow shader warmup before collecting **60–120 seconds of frame times** from external capture (e.g. CapFrameX/PresentMon) and side-by-side screenshots. Additional emulator HUD Detailed (F8) shows GPU load and render-thread busy but not per-pass GPU time. Only a repeatable improvement with correct game geometry qualifies for promotion.

## P1 — Density: retired NO-GO after user runtime A/B

**Verdict 2026-10-25:** User ran Original PS5 Perf Density **8.0** at 10:42:05 (`_Build/run-logs/20261025-104205-021.out.log`) and PS4 Base Density **7.0** at 10:43:51 (`_Build/run-logs/20261025-104351-349.out.log`). The second log confirms the virtual profile emitted 7.0 twice. The user observed **FPS essentially unchanged**; this is insufficient to claim a statistically proven zero change, but it does **not meet promotion criteria**. Do not escalate to density 5 or reintroduce a more aggressive geometry-quality toggle without new workload evidence. The second run had a compile-heavy slow frame (754.2 ms), so neither session's thresholded slow-frame count is a valid FPS comparison. No formal full-frame FPS/1% low, GPU busy or image-equivalence data exists.

**Retirement:** Removed `KYTY_GRAPHICS_AUDIT_DENSITY` from both the native virtual file-redirect path and launcher. The previous saved `graphics_audit_density` key is ignored by launcher clean/save and never passed to the game; a native tombstone `graphicsAuditDensity.h` always returns an empty value. No default PS5 Performance profile or game asset was changed. Distance Tessellation Early Fade remains independently available. The following description is retained **only as historical experiment evidence, not active functionality**.

### Original opt-in probe (historical, removed)

The installed PS5 Performance profile ships `+r_tessellationDensity=8.0`; the installed PS4 Base profile ships `+r_tessellationDensity=7.0`. PS4 Neo is 5; PS5 Trinity 13 and PS5 High 18. These numbers are **profile values, not FPS or geometry equality guarantees**.

The new launcher setting **Geometry Density (Experimental)** is `Original (PS5 Perf 8.0)` by default and `PS4 Base Density 7.0 (probe only)` as explicit opt-in; launcher passes `KYTY_GRAPHICS_AUDIT_DENSITY=original|ps4base`. Native admits only title `PPSA01341`, `APP_VER=01.007.000`, `KYTY_GAME_CONVARS != 0`, and a unique exact `+r_tessellationDensity=8.0` line within a virtual read of **renderconfig_ps5_perf.txt**, without touching assets or unrelated profile values. Existing `r_Wants4K=WantsTrinity` and independent `Distance Tessellation Early Fade` remain intact; when the game doesn't read this profile, the probe has no effect. Logs report whether the density override was actually placed in the virtual-copy output. The log is NOT proof the game accepted the value internally or reduced GPU tessellation dispatches.

**Admission**: no visual geometry loss (walkable structures, models near camera, shadows, character/enemy shapes), no extra compile hitches or increased shader storage; run controlled A/B before claims of performance gain. Do not select this as a normal preset before tests.

## P2 — Particle effects: static evidence, runtime gate NOT GRANTED

`debugrendermenudynamic.txt` exposes `particleResolution`, `particleLowResBudgetFactor`, `particleDistortionResolution`, `particleDistortionBudgetFactor`, `particleRibbonTessDensity`, `particleEnableAsyncCompute`, `particleNumShadowCascades`. The installed eboot binary contains matching strings: `particleResolution` at file offset `0x024B9175`, `particleDistortionResolution` at `0x024D5A8E`, `particleLowResBudgetFactor` at `0x02489501` and `particleDistortionBudgetFactor` at `0x024A5D2D` (verified by LLVM `strings -t x`, **string locations only, not code or defaults**). None of the seven inspected PS4/PS5 `misc/renderconfig*` profiles provides the candidate particle settings. **None of the target setting's default values, enum values for resolution, unit semantics or per-pass GPU costs have been validated for v1.07**. In particular, do not force `particleResolution=0` or guess budget multipliers. First obtain the convar registration metadata/defaults or a read-only game diagnostic before opening a launcher mode. No particle override is injected by this phase.

## P3 — SSR and contact shadows: static evidence, runtime gate NOT GRANTED

`debugrendermenuibl.txt` lists `r_ssrEnableOverrides`, `r_ssrMaxIterations`, `r_ssrMaxRayLength`, `r_ssrCutoffDistance` and `r_ssrMethod`. `debugrendermenulighting.txt` lists `r_contactShadowsEnabled`. Verified v1.07 eboot string locations: `r_ssrEnableOverrides` `0x024A5CF0`, `r_ssrMaxIterations` `0x0241798B`, `r_ssrMaxRayLength` `0x024DF27B`, `r_ssrCutoffDistance` `0x02433D46`, `r_contactShadowsEnabled` `0x024B9129`. These are byte offsets of names, NOT numerical parameter values. All inspected shipped profiles set `r_iblResolution` (PS5 Perf and LowEnergy use `HalfResX`, Trinity and High use `Full`); none explicitly sets these SSR/contact settings. **Neither the effective default SSR settings nor whether contact shadows are active under Graphics Lowest (which already disables ambient and spot shadows) is known**. Avoid guessing an iteration count, toggling reflection shaders in a baseline build, or falsely claiming shadow pass savings. A separate static disassembly or equivalent convar-default evidence plus a per-pass workload measurement is required before exposing an SSR/Contact probe. No SSR/Contact override is injected by this phase.

## P2/P3 initial registration-path audit (before constructor-value recovery; 2026-10-25)

**New independent evidence:** Read-only scan of original decrypted `eboot_ps5rs.elf` (SHA-256 `f81e414defc06fbca78b40eaec3e80f6631c0e77519b03110952a7efde1b0654`) mapped all **13/13 unique NUL-terminated convar names** into an ELF PT_LOAD segment and found **one matching `48 8D 05` RIP-relative LEA byte-pattern candidate per convar** within the executable PT_LOAD range. These are *not*, by themselves, instruction-boundary-verified references; targeted manual `llvm-objdump` and Capstone disassembly inspected the matching code sites before any initialization-path claims. The original SELF `eboot.bin` has a different on-disk layout (SHA-256 `fba2d6341abf74f032cde774df9bfee2f3afcf32402b20938add42d352914295`); previous SELF string offsets must **not** be passed to ELF disassembly. Reproducer: `py -3 tools/local/graphics-convar-xref.py --elf "C:\\Games\\PS5\\DMSR\\PPSA01341-1.07\\PPSA01341-app0\\eboot_ps5rs.elf"`. The script is strictly read-only, requires an explicit ELF path, does not examine/alter runtime and makes **no type/default claims** by itself.

Targeted `llvm-objdump` and Capstone inspection of the matching initializer call sites supplies a narrower extra fact: distinct boolean, 32-bit integer, 32-bit float and selectable/enum-like registration **paths**. For example `0x9260b0` loads 32-bit floating bounds into the registration object and reads a separate current/initial float through the caller's `rdx` pointer; `0x431500` reads a 32-bit integer through `rdx`, and `0x450a20` reads one byte through `rdx`. Selectable/enum-like helpers at `0x963d70` and `0x958ce0` require additional mapping before their choices can be assigned meanings.

| Convar | ELF name file offset | Code LEA candidate (VMA) | Registration path | Observed registration arguments (NOT defaults) |
|---|---:|---:|---|---|
| `particleResolution` | `0x24ad5f5` | `0x95f1b3` | selectable/enum-like | `0`, `2` (semantics unverified) |
| `particleLowResBudgetFactor` | `0x247d981` | `0x95f490` | float32 | `0.0`, `1.0` |
| `particleDistortionResolution` | `0x24c9f0e` | `0x95f2ca` | selectable/enum-like | `0`, `2` (semantics unverified) |
| `particleDistortionBudgetFactor` | `0x249a1ad` | `0x95f3f3` | float32 | `1.0`, `10.0` |
| `particleRibbonTessDensity` | `0x2431c91` | `0x95ec5c` | float32 | `0.0`, `10.0` |
| `particleEnableAsyncCompute` | `0x2461e97` | `0x95ef6d` | bool | none recovered |
| `particleNumShadowCascades` | `0x246b359` | `0x95efee` | integer32 | `0`, `4` |
| `r_ssrEnableOverrides` | `0x249a170` | `0x94d143` | bool | none recovered |
| `r_ssrMaxIterations` | `0x240be0b` | `0x94d2fe` | integer32 | `1`, `256` |
| `r_ssrMaxRayLength` | `0x24d36fb` | `0x94d1c4` | float32 | `0.0`, `1600.0` |
| `r_ssrCutoffDistance` | `0x24281c6` | `0x94d261` | float32 | `0.0`, `5000.0` |
| `r_ssrMethod` | `0x24029c5` | `0x94ce97` | selectable/enum-like | `0`, `2` (semantics unverified) |
| `r_contactShadowsEnabled` | `0x24ad5a9` | `0x947101` | bool | none recovered |

**Crucial distinction:** The numeric immediates above are **registration arguments consistent with lower/upper bounds**, not proven current values nor a safe replacement preset. The float helper at `0x9260b0` copies the two separate bound arguments through `r13`/`r12` to object fields `+0x6c`/`+0x74`, but copies the **separate initial value** via `r14 = rdx` to field `+0x68`. The integer helper at `0x431500` and boolean helper at `0x450a20` also read their initial value through `rdx`. Observed call sites form `rdx = [0x26d22f0] + per-setting offset`. The pointer slot contains zero in the inspected on-disk ELF, but **relocation and initialization of this backing pointer were not exhaustively traced**: its effective values may still be recoverable with additional static work. At this **registration-only checkpoint**, constructor values were still unknown; they are recovered in the next section. **Effective settings after loading profiles, enum labels/behavior, runtime overrides, GPU workload/pass costs and pass enablement under Graphics Lowest remain unknown**. Specifically, `r_ssrMaxIterations=256` and `particleLowResBudgetFactor=1.0` are registration bound arguments, **not** their original constructor values. No P2/P3 setting was modified or admitted.

**Reproduction and verification:** `py -3 tools/local/graphics-convar-xref.py --self-test` PASS (synthetic ELF mapping, byte-pattern candidate, strict name boundary, missing-name and SELF rejection), original ELF **13/13 unique names plus 13 candidate code references**, SHA recorded. For independent instruction-level checking use LLVM on the same SHA-pinned ELF, for example `llvm-objdump -d -M intel --no-show-raw-insn --start-address=0x95f470 --stop-address=0x95f500 eboot_ps5rs.elf` (Particle budget registration), `--start-address=0x94d2e8 --stop-address=0x94d35f` (SSR iterations), `--start-address=0x9260b0 --stop-address=0x9261a7` (float initialization helper), `--start-address=0x431500 --stop-address=0x4315b2` (integer helper) and `--start-address=0x450a20 --stop-address=0x450ace` (boolean helper). These disassemblies show argument flow, but **do not** by themselves establish the run-time backing-storage initializer or GPU cost. The reproducible scanner uses only standard-library Python, has no automatic game access and intentionally reports *byte-pattern candidates*, not decoded instructions or proof registration executed at runtime.

**Next acceptance gate at that checkpoint:** Identify the per-setting backing-store initializer, actual effective settings after profile application, and **real GPU pass/dispatch time**. Until GPU evidence and a safe A/B exist, both P2 and P3 stay research-only/no overrides.

## P2/P3 next finding — 13 constructor baseline values recovered (2026-10-25)

**Evidence scope:** The same SHA-pinned decrypted v1.07 ELF, `f81e414defc06fbca78b40eaec3e80f6631c0e77519b03110952a7efde1b0654`. These are **original ELF static-constructor values**, *not necessarily effective runtime values after config/profile writes*. No game execution or guest-memory inspection occurred.

**Proof of initialization, not just string matching:**

1. `DT_RELA=0x33844b8`, `DT_RELASZ=0x3e78d0`, `DT_RELAENT=24`; exactly one `R_X86_64_RELATIVE` entry for the backing-pointer slot at VMA `0x26d22f0` (relocation record file offset `0x2ad93f0`), whose addend is `0x2f13b40`. With load bias `B`, the relocated pointer is `B+0x2f13b40`. The VMA `0x2f13b40` is in the writable PT_LOAD segment's zero-filled memory tail; raw file zeros are **not** default values.
2. Another `R_X86_64_RELATIVE` entry (file offset `0x2ade5e0`) points the constructor table slot VMA `0x26d6308` to code VMA `0x940040` (+ load bias). ELF `DT_INIT=0x10` has an initializer-table traversal/call sequence `0x45–0x64`. At `0x9400c7`, `0x9400d3`, `0x9400df`, constructor `0x940040` calls lighting `0x944bc0`, SSR `0x94c470`, and particle `0x95be80` respectively.
3. The registration sites already established above read `[0x26d22f0] +` each field offset. For SSR, constructor `0x94c470` calls the nested `0xa7dfa0` at `0x94c4b6`. Original stored constants, e.g. `0x24f6fe0` (SSR method), `0x237e0a8` (SSR distance float), and `0x24f4550` (two particle budget floats), were read from their mapped file-backed read-only segments, then cross-checked against the corresponding constructor stores. Exact call and opcode signatures are checked by the new verifier.

| Group | Setting | Backing offset | Original constructor value |
|---|---|---:|---:|
| P2 | `particleResolution` | `0x8c8` | numeric enum `2` (label unknown) |
| P2 | `particleLowResBudgetFactor` | `0x8d4` | float32 `0.2` (stored `0x3e4ccccd`) |
| P2 | `particleDistortionResolution` | `0x8cc` | numeric enum `2` (label unknown) |
| P2 | `particleDistortionBudgetFactor` | `0x8d0` | float32 `4.0` |
| P2 | `particleRibbonTessDensity` | `0x8b0` | float32 `1.0` |
| P2 | `particleEnableAsyncCompute` | `0x8b8` | boolean `true` |
| P2 | `particleNumShadowCascades` | `0x8bc` | integer `2` |
| P3 | `r_ssrMethod` | `0x788` | numeric enum `1` (label unknown) |
| P3 | `r_ssrEnableOverrides` | `0x798` | boolean `false` |
| P3 | `r_ssrMaxIterations` | `0x79c` | integer `128` |
| P3 | `r_ssrCutoffDistance` | `0x7a0` | float32 `1000.0` |
| P3 | `r_ssrMaxRayLength` | `0x7a4` | float32 `1000.0` |
| P3 | `r_contactShadowsEnabled` | `0x91` | boolean `true` |

**Read-only reproduction:** Run `py -3 tools/local/graphics-convar-init-audit.py --self-test` and `py -3 tools/local/graphics-convar-init-audit.py --elf "C:\\Games\\PS5\\DMSR\\PPSA01341-1.07\\PPSA01341-app0\\eboot_ps5rs.elf"`. The tool is standard-library-only, verifies the exact SHA, PT_LOAD mapping, relocations, initializer calls, byte signatures and read-only data constants; it **fails closed** on any other executable. The separate `graphics-convar-xref.py` continues to provide independently reproducible name-offset candidates.

**No runtime admission yet:** These constructor defaults do not establish which profile/config subsequently changes them, what enum IDs `1`/`2` mean, whether the SSR/contact passes submit real GPU work, or how much GPU time particle effects cost. In particular, `r_ssrEnableOverrides=false` **does not mean SSR is disabled**, and `r_contactShadowsEnabled=true` **does not prove active contact-shadow work** under Graphics Lowest. Next, pursue *consumer/enum mapping* and *effective runtime settings* (only with separately authorized, bounded read-only observation); GPU timing and visual-equivalence A/B remain required before **any P2/P3 override**. P2/P3 constructor-baseline static gate **PASS**, performance-tuning admission **NOT GRANTED**.

## Combined P2/P3 short gameplay A/B probe (2026-10-25)

To avoid testing each GPU-side feature separately, launcher `Graphics → Graphics Performance Test (Experimental)` offers **Original (default OFF)**, **Combined**, and the previously shipped **SSR 64 only**. Existing JSON key `ssr_test` remains compatible (`original|iterations64|combined`). Source-backed constructor baselines and the opt-in experimental overrides are:

| Candidate | ELF constructor value | Combined trial | Why shortlisted / image risk |
|---|---:|---:|---|
| `r_ssrMaxIterations` + `r_ssrEnableOverrides` | `128` / `false` | `64` / `true` | Fewer SSR ray steps possible; reflections can degrade |
| `r_ssrMaxRayLength` | `1000.0` | `600.0` | Restricts SSR ray search; distant reflections can disappear |
| `particleRibbonTessDensity` | `1.0` | `0.5` | Fewer ribbon tessellation subdivisions possible; magical effects may visibly change |
| `r_contactShadowsEnabled` | `true` | `false` | May avoid contact-shadow work if pass active; fine shadows can disappear |

**Admission and safety:** These are heuristics for a **single exploratory bundled test**, not measured performance wins nor verified final runtime defaults. The current Lowest profile may already skip relevant work. Excluded deliberately: GI/fog/bloom global disable, unknown particle enum/budget semantics, retired occlusion/model/instance/density switches, and unsafe force shadow LOD. Windows runner appends the corresponding `KYTY_GAME_CONVARS` on a temporary virtual-copy command-line path after Quality and `-Set`, only for title `PPSA01341`, app version `01.007.000`, and when the global `KYTY_GAME_CONVARS=0` opt-out is not in effect. Original emits none of these, SSR-only retains just two SSR flags. No native rebuild, game asset/save or shader cache edits, nor automatic gameplay or precompile.

**Quick user runtime gate:** compare Original → Combined in *one matched scene*, fully restarting game between switches; check FPS and reflections, particles, contact shadows. If no practical improvement or geometry/artifact regressions, immediately return to Original and retire the bundle. `node --test launcher-electron/tests/*.test.cjs` and actual runner `-DryRun` integration tests validate selection and injection, **not** rendered FPS.

## Additional prior evidence and retirements

- The current Graphics Lowest and Distance Aggressive overlap at `r_forceViewportHeightForPixelSizeCalc=480` and `sunShadowMaxDistance=60`; the latter does not give extra benefit atop Lowest.
- `doIndexBufferCulling=false` is the existing upstream default on supported Demon's Souls because its GPU culling can cost ~2,800 dispatches/frame on PC; keep unchanged.
- 2026-10-24 engine Virtual/Light Occlusion A/B showed no reduction in counted guest draw packets (historical baseline 6376.8 vs 6388.9/6383.8/6394.9); retirement remains in effect.
- 2026-10-25 Combined Model/Instance probe caused **severe geometry corruption** with no stand-alone FPS benefit; **NO-GO** remains.
- Existing Early Fade `12.0 -> 10.0` had no reported visual faults but **has not shown a measured FPS improvement**.

## Validation contract

- `tools/local/graphics-audit-density-policy-test.cpp`: C++20 compile-time retirement assertions: all density modes now produce no override.
- `launcher-electron/tests/graphics-audit-density.test.cjs`: regression contract proving old saved Density 7 cannot activate a native override, while Early Fade/RAM and normal game startup behavior remain unaffected.
- `launcher-electron/tests/graphics-audit-baseline.test.cjs`: log parser does not invent FPS/1% low; ignores shader-precompile files.
- Native build with configured NVIDIA Streamline, complete launcher test suite, Electron package inspection and verified origin branch required before handoff. Game and precompile deliberately NOT executed.
