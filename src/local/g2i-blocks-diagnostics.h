#pragma once
// G2-I: count-and-cycle sampling of TableBlocks ONLY while a manual native
// CPU Census is active. This never changes buffer acquisition or upload order.
#include <array>
#include <cstddef>
#include <cstdint>

namespace G2IBlocksDiagnostics {
constexpr uint32_t SampleEvery = 64;

enum Counter : size_t {
    SampledCalls,
    CompletedCalls,
    Stages,
    Descriptors,
    WritableDescriptors,
    WritableObtainCalls,
    ReadonlyDescriptors,
    ReadonlyReused,
    ReadonlyResolves,
    UploadCalls,
    UploadBytes,
    EmptyStages,
    Counters
};
enum Timed : size_t { WritableObtain, FinalUpload, Timings };
struct Counts {
    std::array<uint64_t, Counters> counts {};
    std::array<uint64_t, Timings> cycles {};
    std::array<uint64_t, Timings> timed_calls {};
    void AddTime(Timed kind, uint64_t elapsed) {
        cycles[kind] += elapsed;
        ++timed_calls[kind];
    }
};
inline bool Consistent(const Counts& c) {
    const auto& a = c.counts;
    return a[SampledCalls] == 1 &&
           a[CompletedCalls] <= a[SampledCalls] &&
           a[WritableObtainCalls] == c.timed_calls[WritableObtain] &&
           a[UploadCalls] == c.timed_calls[FinalUpload] &&
           a[Descriptors] == a[WritableDescriptors] + a[ReadonlyDescriptors] &&
           a[ReadonlyResolves] + a[ReadonlyReused] <= a[ReadonlyDescriptors] &&
           a[EmptyStages] + a[UploadCalls] <= a[Stages];
}
} // namespace G2IBlocksDiagnostics
