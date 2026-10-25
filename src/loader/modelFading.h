#pragma once

#include <string_view>

// Retired after user runtime validation on PPSA01341 v1.07 (2026-10-25):
// - Combined severely corrupted geometry.
// - Model and Instance alone gave no visible FPS improvement.
// Keep this fail-closed tombstone to prevent the tested unsafe probes from
// being accidentally reinstated without new game-runtime evidence.
namespace Loader::GameArgs::ModelFading {
[[nodiscard]] constexpr std::string_view Convars(std::string_view) {
    return {};
}
static_assert(Convars("model").empty());
static_assert(Convars("instance").empty());
static_assert(Convars("combined").empty());
static_assert(Convars("original").empty());
} // namespace Loader::GameArgs::ModelFading
