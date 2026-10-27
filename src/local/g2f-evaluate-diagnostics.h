#pragma once
// G2-F: sampled, count-only TableEvaluate diagnostics. No guest state, IO or
// profiling table access inside a read/locate hot loop.
#include <array>
#include <cstddef>
#include <cstdint>

namespace G2FDiagnostics {
constexpr uint32_t SampleEvery = 32; // deterministic 1-in-32 evaluations while native census is active

enum Reader : size_t {
  ReadCalls, ReadWords, PageReuse, NewPage, GranuleClear, WatcherChecks,
  WatcherPresent, WatcherAbsent, DirectSmallCalls, DirectSmallWords,
  DirectLargeCalls, DirectLargeWords, WatchedFallbackCalls, CrossPageCalls,
  SpanAttempts, SpanSuccess, SpanFailure, WordFallbackWords, ReaderCount
};
enum Locate : size_t {
  SampledEvaluations, CompletedEvaluations, LevelBatches, LocateCalls,
  BoundsRejects, MappingProbes, MappingHits, MappingMisses, MappingFailures,
  PrefetchIssued, AdjacentPrefetchDuplicates, SuppressedPrefetch, LocateCount
};
struct Counts {
  std::array<uint64_t, ReaderCount> reader {};
  std::array<uint64_t, LocateCount> locate {};
  uint64_t previous_line = 0;
  bool previous_valid = false;
  void BeginLevel() {
    ++locate[LevelBatches];
    previous_valid = false;
  }
  void NotePrefetch(uint64_t line) {
    ++locate[PrefetchIssued];
    if (previous_valid && previous_line == line)
      ++locate[AdjacentPrefetchDuplicates];
    previous_line = line;
    previous_valid = true;
  }
};
// Semantic consistency of the reader counters; independent of the emulator.
inline bool ReaderConsistent(const Counts& counts) {
  const auto& c = counts.reader;
  return c[ReadCalls] == c[PageReuse] + c[NewPage] + c[CrossPageCalls] &&
         c[NewPage] == c[GranuleClear] + c[WatcherChecks] &&
         c[WatcherChecks] == c[WatcherPresent] + c[WatcherAbsent] &&
         c[ReadCalls] == c[DirectSmallCalls] + c[DirectLargeCalls] +
                         c[WatchedFallbackCalls] + c[CrossPageCalls] &&
         c[SpanAttempts] == c[SpanSuccess] + c[SpanFailure];
}
} // namespace G2FDiagnostics
