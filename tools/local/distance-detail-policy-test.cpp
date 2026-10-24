#include "loader/distanceDetail.h"

#include <string_view>
using Loader::GameArgs::DistanceConvars;
using namespace std::literals;

static_assert(DistanceConvars("original").empty());
static_assert(DistanceConvars("").empty());
static_assert(DistanceConvars("invalid").empty());
static_assert(DistanceConvars("BALANCED").empty());
static_assert(DistanceConvars("balanced") ==
              "r_forceViewportHeightForPixelSizeCalc=1080;sunShadowMaxDistance=200"sv);
static_assert(DistanceConvars("performance") ==
              "r_forceViewportHeightForPixelSizeCalc=720;sunShadowMaxDistance=125"sv);
static_assert(DistanceConvars("aggressive") ==
              "r_forceViewportHeightForPixelSizeCalc=480;sunShadowMaxDistance=60"sv);

int main() { return DistanceConvars("original").empty() ? 0 : 1; }
