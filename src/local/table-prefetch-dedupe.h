#pragma once
// G2-G: optional suppression of an immediately repeated advisory cache-line
// prefetch within ONE TableEvaluate dependency-level locate batch.
// This never changes guest loads, memory-map proofs or resource ownership.
#include <cstdint>

namespace TablePrefetchDedupe {
struct State {
  uint64_t previous = 0;
  bool valid = false;
  void BeginLevel() { valid = false; }
  // Returns true ONLY for an immediately repeated address in the original
  // issuance order. Tracks attempts, not only emitted prefetches.
  bool ShouldSkip(uint64_t line) {
    const bool repeated = valid && previous == line;
    previous = line;
    valid = true;
    return repeated;
  }
};
} // namespace TablePrefetchDedupe
