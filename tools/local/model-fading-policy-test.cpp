#include "loader/modelFading.h"
#include <string_view>
using namespace Loader::GameArgs::ModelFading;
using namespace std::literals;
static_assert(BuildAdmitted("PPSA01341", "01.007.000"));
static_assert(!BuildAdmitted("PPSA01341", "01.006.000"));
static_assert(!BuildAdmitted("PPSA01340", "01.007.000"));
static_assert(Convars("model") ==
 "r_ModelFadeOutOverrideEnable=true;r_ModelFadeOutStartOverride=100.0"sv);
static_assert(Convars("instance") == "r_fadeOutInstanceOverDistance=0.75"sv);
static_assert(Convars("combined") ==
 "r_ModelFadeOutOverrideEnable=true;r_ModelFadeOutStartOverride=100.0;"
 "r_fadeOutInstanceOverDistance=0.75"sv);
static_assert(Convars("original").empty());
static_assert(Convars("combined;INJECTED=1").empty());
static_assert(Convars("MODEL").empty());
