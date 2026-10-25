#pragma once

#include <string_view>

// RETIRED / NO-GO (PPSA01341 v1.07, 2026-10-25).
// Logs confirmed the 8.0 -> 7.0 virtual Perf-profile substitution; user
// observed no FPS improvement. No comparable GPU pass timings are available.
// Keep a small fail-closed tombstone so experimental modes cannot be
// accidentally re-enabled by a stale environment variable or old launcher JSON.
namespace Loader::GameArgs::GraphicsAuditDensity {
[[nodiscard]] constexpr std::string_view Value(std::string_view) { return {}; }

static_assert(Value("original").empty());
static_assert(Value("ps4base").empty());
} // namespace Loader::GameArgs::GraphicsAuditDensity
