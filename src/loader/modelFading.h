#pragma once

#include <string_view>

// Demon's Souls v1.07 debugrendermenudebug.txt / eboot.bin expose these
// variable names, NOT the defaults, units, or safe scene-specific ranges.
// Research-only explicit probe values, never an optimized graphics preset.
// In particular, instance scale 0.75 is a hypothesis, not an observed default.
namespace Loader::GameArgs::ModelFading {
[[nodiscard]] constexpr bool BuildAdmitted(std::string_view title, std::string_view version) {
    return title == "PPSA01341" && version == "01.007.000";
}
[[nodiscard]] constexpr std::string_view Convars(std::string_view mode) {
    if (mode == "model") return "r_ModelFadeOutOverrideEnable=true;r_ModelFadeOutStartOverride=100.0";
    if (mode == "instance") return "r_fadeOutInstanceOverDistance=0.75";
    if (mode == "combined")
        return "r_ModelFadeOutOverrideEnable=true;r_ModelFadeOutStartOverride=100.0;"
               "r_fadeOutInstanceOverDistance=0.75";
    return {};
}
static_assert(!BuildAdmitted("PPSA01341", "01.005.000"));
static_assert(BuildAdmitted("PPSA01341", "01.007.000"));
static_assert(Convars("original").empty());
static_assert(Convars("unknown").empty());
} // namespace Loader::GameArgs::ModelFading
