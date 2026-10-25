#pragma once

#include <optional>
#include <string>
#include <string_view>

// PPSA01341 v1.07 research-only: the PS5 Performance profile ships
// +r_tessellationDensity=8.0 and PS4 Base ships 7.0. No claim of safe visual
// equivalence or GPU/FPS gain. Strict exact-line replacement in an in-memory
// profile copy; a duplicate/modified baseline fails closed.
namespace Loader::GameArgs::GraphicsAuditDensity {
[[nodiscard]] constexpr bool BuildAdmitted(std::string_view title, std::string_view version) {
    return title == "PPSA01341" && version == "01.007.000";
}

[[nodiscard]] constexpr std::string_view Value(std::string_view mode) {
    return mode == "ps4base" ? "7.0" : std::string_view {};
}

[[nodiscard]] constexpr std::optional<std::string> RewritePerfConfig(std::string_view original,
                                                                      std::string_view mode) {
    const auto value = Value(mode);
    if (value.empty()) return std::nullopt;
    constexpr std::string_view baseline = "+r_tessellationDensity=8.0";
    constexpr std::string_view name = "r_tessellationDensity";
    const auto match = original.find(name);
    if (match == std::string_view::npos || original.find(name, match + name.size()) != std::string_view::npos)
        return std::nullopt;
    const auto lineBreakBefore = original.rfind('\n', match);
    const auto begin = lineBreakBefore == std::string_view::npos ? 0 : lineBreakBefore + 1;
    const auto lineBreakAfter = original.find('\n', match);
    const auto end = lineBreakAfter == std::string_view::npos ? original.size() : lineBreakAfter;
    auto line = original.substr(begin, end - begin);
    if (!line.empty() && line.back() == '\r') line.remove_suffix(1);
    if (line != baseline) return std::nullopt;
    std::string out(original);
    out.replace(begin, baseline.size(), std::string(baseline.substr(0, baseline.size() - 3)).append(value));
    return out;
}
static_assert(BuildAdmitted("PPSA01341", "01.007.000"));
static_assert(!BuildAdmitted("PPSA01341", "01.006.000"));
static_assert(Value("original").empty());
static_assert(Value("ps4base") == "7.0");
} // namespace Loader::GameArgs::GraphicsAuditDensity
