#include "loader/graphicsAuditDensity.h"
#include "loader/distanceTessellation.h"
#include <string_view>

using namespace Loader::GameArgs;
using namespace std::literals;

static_assert(GraphicsAuditDensity::BuildAdmitted("PPSA01341", "01.007.000"));
static_assert(!GraphicsAuditDensity::BuildAdmitted("PPSA01341", "01.006.000"));
static_assert(!GraphicsAuditDensity::BuildAdmitted("PPSA01340", "01.007.000"));
static_assert(GraphicsAuditDensity::Value("original").empty());
static_assert(GraphicsAuditDensity::Value("ps4base") == "7.0"sv);

constexpr bool Exact() {
    const auto initial = "+r_tessellationDensity=8.0\n+r_tessellationFadeOutStart=12.0\n+r_Wants4K = WantsTrinity\n"sv;
    const auto result = GraphicsAuditDensity::RewritePerfConfig(initial, "ps4base");
    return result && *result == "+r_tessellationDensity=7.0\n+r_tessellationFadeOutStart=12.0\n+r_Wants4K = WantsTrinity\n";
}
constexpr bool Compose() {
    const auto initial = "+r_tessellationDensity=8.0\r\n+r_tessellationFadeOutStart=12.0\r\n+r_tessellationMaxRecursions=7\r\n"sv;
    const auto early = DistanceTessellation::RewritePerfConfig(initial, "early");
    if (!early) return false;
    const auto result = GraphicsAuditDensity::RewritePerfConfig(*early, "ps4base");
    return result && *result == "+r_tessellationDensity=7.0\r\n+r_tessellationFadeOutStart=10.0\r\n+r_tessellationMaxRecursions=7\r\n";
}
constexpr bool FailClosed() {
    return !GraphicsAuditDensity::RewritePerfConfig("+r_tessellationDensity=8.0\n", "original") &&
           !GraphicsAuditDensity::RewritePerfConfig("+r_tessellationDensity=7.0\n", "ps4base") &&
           !GraphicsAuditDensity::RewritePerfConfig("+r_tessellationDensity=8.0\n+r_tessellationDensity=8.0\n", "ps4base") &&
           !GraphicsAuditDensity::RewritePerfConfig("  +r_tessellationDensity=8.0\n", "ps4base") &&
           !GraphicsAuditDensity::RewritePerfConfig("# +r_tessellationDensity=8.0\n", "ps4base") &&
           !GraphicsAuditDensity::RewritePerfConfig("+r_tessellationDensity = 8.0\n", "ps4base") &&
           !GraphicsAuditDensity::RewritePerfConfig("+r_Unrelated=123\n", "ps4base") &&
           !GraphicsAuditDensity::RewritePerfConfig("+r_tessellationDensity=8.0\n", "ps4base;evil=1");
}
static_assert(Exact());
static_assert(Compose());
static_assert(FailClosed());
