#pragma once
// Immutable packed TablePair plan metadata. One byte per dependency level.
// Eligibility is derived ONLY from packed run metadata, never from guest data.
// Bad/partial levels fail closed, leaving the original generic path intact.
#include <cstddef>
#include <cstdint>
#include <vector>

namespace TableUnboundedLevels {
template <class Runs, class LevelEnds, class IsUnbounded>
[[nodiscard]] std::vector<uint8_t> Compute(const Runs& runs, const LevelEnds& level_ends, IsUnbounded is_unbounded) {
  std::vector<uint8_t> flags;
  flags.reserve(level_ends.size());
  size_t begin = 0;
  for (const auto raw_end : level_ends) {
    const size_t end = raw_end;
    if (end <= begin || end > runs.size()) return {}; // malformed plan: no specialization
    bool all = true;
    for (size_t i = begin; i < end; ++i)
      if (!is_unbounded(runs[i])) { all = false; break; }
    flags.push_back(static_cast<uint8_t>(all));
    begin = end;
  }
  return begin == runs.size() ? flags : std::vector<uint8_t> {};
}
} // namespace TableUnboundedLevels
