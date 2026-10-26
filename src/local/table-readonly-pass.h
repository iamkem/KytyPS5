#pragma once
// G2-D: a stage may omit the writable-first traversal only when it has no
// writable or atomic table buffers. This says nothing about past GPU writes,
// buffer residency or image hazards: the read traversal remains unchanged.
#include <cstddef>

namespace TableReadOnlyPass {
template <typename Resources>
[[nodiscard]] bool Eligible(size_t planBuffers, const Resources& resources) {
  if (planBuffers > 32 || planBuffers != resources.size()) return false;
  for (const auto& resource : resources)
    if (resource.written || resource.atomic) return false;
  return true;
}

[[nodiscard]] inline size_t Begin(bool enabled, bool eligible, size_t buffers) {
  return enabled && eligible ? buffers : 0;
}
} // namespace TableReadOnlyPass
