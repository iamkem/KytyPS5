#pragma once

#include <optional>
#include <string>
#include <string_view>

namespace Loader::GameArgs::DistanceTessellation {

// Exact title/version inspected: the performance render profile of PPSA01341 v1.07.
// Experimental: preserves the shipped density, recursion and near geometry. Neither
// a reduction in GPU work nor the meaning of the distance unit is yet established.
[[nodiscard]] constexpr bool BuildAdmitted(std::string_view title, std::string_view version) {
    return title == "PPSA01341" && version == "01.007.000";
}

[[nodiscard]] constexpr std::string_view FadeStart(std::string_view mode) {
    return mode == "early" ? "10.0" : std::string_view {};
}

// Rewrite only the one known shipped line, with an exact baseline match. A missing,
// duplicated, or otherwise modified line is NOT an invitation to guess an override.
// Maintain every other byte and the original line ending (CRLF or LF).
[[nodiscard]] constexpr std::optional<std::string> RewritePerfConfig(std::string_view original,
                                                                  std::string_view mode) {
    const auto value = FadeStart(mode);
    if (value.empty()) return std::nullopt;
    constexpr std::string_view key = "+r_tessellationFadeOutStart=12.0";
    constexpr std::string_view variable = "r_tessellationFadeOutStart";
    const auto start = original.find(variable);
    if (start == std::string_view::npos || original.find(variable, start + variable.size()) != std::string_view::npos)
        return std::nullopt;
    const auto line_begin = original.rfind('\n', start);
    const auto begin = line_begin == std::string_view::npos ? 0 : line_begin + 1;
    const auto line_end = original.find('\n', start);
    const auto end = line_end == std::string_view::npos ? original.size() : line_end;
    auto line = original.substr(begin, end - begin);
    if (!line.empty() && line.back() == '\r') line.remove_suffix(1);
    if (line != key) return std::nullopt;
    std::string result(original);
    result.replace(begin + key.size() - 4, 4, value);
    return result;
}
} // namespace Loader::GameArgs::DistanceTessellation
