#include "local/memory-pressure.h"
#include <cassert>
#include <cstdio>

using MemoryPressure::Level;
using MemoryPressure::GiB;
using MemoryPressure::Next;
using MemoryPressure::Images;

static_assert(MemoryPressure::ForPhysical(24 * GiB).elevated == 4 * GiB);
static_assert(MemoryPressure::ForPhysical(24 * GiB).critical == 2 * GiB);
static_assert(Next(Level::Normal, 10 * GiB, 24 * GiB) == Level::Normal);
static_assert(Next(Level::Normal, 3 * GiB, 24 * GiB) == Level::Elevated);
static_assert(Next(Level::Elevated, 4 * GiB + GiB / 2, 24 * GiB) == Level::Elevated);
static_assert(Next(Level::Elevated, 6 * GiB, 24 * GiB) == Level::Normal);
static_assert(Next(Level::Elevated, GiB, 24 * GiB) == Level::Critical);
static_assert(Next(Level::Critical, 2 * GiB + GiB / 2, 24 * GiB) == Level::Critical);
static_assert(Next(Level::Critical, 3 * GiB + GiB / 2, 24 * GiB) == Level::Elevated);
static_assert(Next(Level::Normal, 0, 24 * GiB) == Level::Normal); // API query failure: no transition
static_assert(Images(Level::Normal).min_unused_flips == 1200);
static_assert(Images(Level::Elevated).min_unused_flips == 900);
static_assert(Images(Level::Critical).min_unused_flips == 720);
static_assert(Images(Level::Critical).max_images_per_flip == 24);
static_assert(MemoryPressure::Pipelines(Level::Normal).idle_seconds == 300);
static_assert(MemoryPressure::Pipelines(Level::Elevated).idle_seconds == 240);
static_assert(MemoryPressure::Pipelines(Level::Critical).idle_seconds == 180);
static_assert(MemoryPressure::Pipelines(Level::Normal).max_evictions_per_scan == 32);
static_assert(MemoryPressure::Pipelines(Level::Elevated).max_evictions_per_scan == 32);
static_assert(MemoryPressure::Pipelines(Level::Critical).max_evictions_per_scan == 64);
static_assert(MemoryPressure::Pipelines(Level::Critical).remake_protection_seconds == 600);
static_assert(MemoryPressure::Pipelines(Level::Critical, true).idle_seconds == 90);
static_assert(MemoryPressure::Pipelines(Level::Critical, true).max_evictions_per_scan == 128);
static_assert(MemoryPressure::Pipelines(Level::Critical, true).remake_protection_seconds == 0);
static_assert(MemoryPressure::PreferTemporaryBacking(false));
static_assert(!MemoryPressure::PreferTemporaryBacking(true));

int main() {
    assert(MemoryPressure::ForPhysical(8 * GiB).elevated == 2 * GiB);
    assert(MemoryPressure::ForPhysical(64 * GiB).elevated == 6 * GiB);
    std::puts("MEMORY_PRESSURE_POLICY_PASS");
}
