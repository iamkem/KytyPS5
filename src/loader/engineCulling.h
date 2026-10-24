#pragma once

#include <string_view>

namespace Loader::GameArgs {

// Candidate culling console variables recovered verbatim from Demon's Souls
// 1.07 eboot.bin. Their existence is established; *their defaults and runtime
// visual correctness are not*. Never change the game without explicit opt-in.
// No Vulkan draw suppression or interpretation of guest visibility here.
// The strings were verified only in this exact title/version binary. Other
// revisions must fail closed until independently audited.
[[nodiscard]] constexpr bool EngineCullingBuildAdmitted(std::string_view title, std::string_view version) {
    return title == "PPSA01341" && version == "01.007.000";
}
[[nodiscard]] constexpr std::string_view EngineCullingConvars(std::string_view mode) {
    if (mode == "virtual") return "r_enableVirtualGeometryOcclusion=true";
    if (mode == "light") return "r_enableLightOcclusionCulling=true";
    if (mode == "combined") return "r_enableVirtualGeometryOcclusion=true;r_enableLightOcclusionCulling=true";
    return {};
}

} // namespace Loader::GameArgs
