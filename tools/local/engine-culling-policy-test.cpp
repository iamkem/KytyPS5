#include "loader/engineCulling.h"
#include <string_view>
using Loader::GameArgs::EngineCullingConvars;
using Loader::GameArgs::EngineCullingBuildAdmitted;
using namespace std::literals;

// Original/unknown must preserve the native game, and individual arms may
// enable ONLY the verified existing engine console variable. No Vulkan draw
// command suppression can be reached through this mapping.
static_assert(EngineCullingBuildAdmitted("PPSA01341", "01.007.000"));
static_assert(!EngineCullingBuildAdmitted("PPSA01340", "01.007.000"));
static_assert(!EngineCullingBuildAdmitted("PPSA01342", "01.007.000"));
static_assert(!EngineCullingBuildAdmitted("PPSA01341", "01.005.000"));
static_assert(!EngineCullingBuildAdmitted("PPSA01341", ""));
static_assert(EngineCullingConvars("original").empty());
static_assert(EngineCullingConvars("").empty());
static_assert(EngineCullingConvars("garbage").empty());
static_assert(EngineCullingConvars("virtual") == "r_enableVirtualGeometryOcclusion=true"sv);
static_assert(EngineCullingConvars("light") == "r_enableLightOcclusionCulling=true"sv);
static_assert(EngineCullingConvars("combined") ==
    "r_enableVirtualGeometryOcclusion=true;r_enableLightOcclusionCulling=true"sv);
static_assert(EngineCullingConvars("virtual").find("r_enableLightOcclusionCulling") == std::string_view::npos);
static_assert(EngineCullingConvars("light").find("r_enableVirtualGeometryOcclusion") == std::string_view::npos);
int main() { return 0; }
