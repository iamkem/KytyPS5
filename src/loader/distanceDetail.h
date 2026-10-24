#pragma once

#include <string_view>

namespace Loader::GameArgs {
// Only Demon's Souls' existing engine LOD heuristic and sunlight-shadow cutoff.
// Empty means do not change the game's normal console variables; notably
// Original must override an inherited mode without changing default visuals.
[[nodiscard]] constexpr std::string_view DistanceConvars(std::string_view mode) {
    if (mode == "balanced") return "r_forceViewportHeightForPixelSizeCalc=1080;sunShadowMaxDistance=200";
    if (mode == "performance") return "r_forceViewportHeightForPixelSizeCalc=720;sunShadowMaxDistance=125";
    if (mode == "aggressive") return "r_forceViewportHeightForPixelSizeCalc=480;sunShadowMaxDistance=60";
    return {};
}
} // namespace Loader::GameArgs
