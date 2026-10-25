#include "loader/distanceTessellation.h"
#include <string_view>

using namespace Loader::GameArgs::DistanceTessellation;
using namespace std::literals;

static_assert(BuildAdmitted("PPSA01341", "01.007.000"));
static_assert(!BuildAdmitted("PPSA01341", "01.005.000"));
static_assert(!BuildAdmitted("PPSA01340", "01.007.000"));
static_assert(!BuildAdmitted("BAD", "01.007.000"));
static_assert(FadeStart("original").empty());
static_assert(FadeStart("early") == "10.0");
static_assert(FadeStart("aggressive").empty());

constexpr bool TestExactRewrite() {
    auto original = "+r_tessellationDensity=8.0\n+r_tessellationFadeOutStart=12.0\n+r_tessellationFadeOutRange=3.0\n"sv;
    auto result = RewritePerfConfig(original, "early");
    return result && *result ==
        "+r_tessellationDensity=8.0\n+r_tessellationFadeOutStart=10.0\n+r_tessellationFadeOutRange=3.0\n";
}
constexpr bool TestCrLf() {
    auto result = RewritePerfConfig("+r_tessellationFadeOutStart=12.0\r\n+next=1\r\n", "early");
    return result && *result == "+r_tessellationFadeOutStart=10.0\r\n+next=1\r\n";
}
constexpr bool TestFailClosed() {
    return !RewritePerfConfig("+r_tessellationFadeOutStart=13.0\n", "early") &&
           !RewritePerfConfig("+r_tessellationFadeOutStart=12.0\n+r_tessellationFadeOutStart=12.0\n", "early") &&
           !RewritePerfConfig("# +r_tessellationFadeOutStart=12.0\n", "early") &&
           !RewritePerfConfig("+r_tessellationFadeOutStart=12.0\n", "original") &&
           !RewritePerfConfig("+r_other=12.0\n", "early");
}
static_assert(TestExactRewrite());
static_assert(TestCrLf());
static_assert(TestFailClosed());
