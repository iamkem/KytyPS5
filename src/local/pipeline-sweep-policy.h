#pragma once

#include <cstdint>

// World-transition pipeline sweeps trade lower host RAM usage for synchronous
// pipeline remakes when the player revisits a world. Keep them for low-RAM PCs;
// high-RAM PCs retain the previous worlds' pipelines to favor frame stability.
// This choice depends ONLY on installed physical RAM, never on RAM Safety,
// RAM Diet, or the current amount of available RAM. Idle eviction under RAM
// Diet / genuine VRAM pressure remains an independent policy.
namespace PipelineSweepPolicy {
constexpr uint64_t GiB = uint64_t {1} << 30u;
constexpr uint64_t MaxPhysicalRam = 20 * GiB;

[[nodiscard]] constexpr bool WorldsLeftEnabled(uint64_t physical_ram) {
    // Unknown capacity is not evidence the host needs aggressive reclamation.
    return physical_ram != 0 && physical_ram <= MaxPhysicalRam;
}

static_assert(!WorldsLeftEnabled(0));
static_assert(WorldsLeftEnabled(8 * GiB));
static_assert(WorldsLeftEnabled(16 * GiB));
static_assert(WorldsLeftEnabled(20 * GiB));
static_assert(!WorldsLeftEnabled(20 * GiB + 1));
static_assert(!WorldsLeftEnabled(24 * GiB));
static_assert(!WorldsLeftEnabled(40 * GiB));
} // namespace PipelineSweepPolicy
