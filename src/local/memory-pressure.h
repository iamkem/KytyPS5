#pragma once
// Opt-in, conservative physical-RAM pressure policy for non-essential GPU cache work.
// Does not touch guest mappings, live textures, Windows working-set limits or the pagefile.
#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <string_view>

namespace MemoryPressure {
constexpr uint64_t MiB = uint64_t {1} << 20u;
constexpr uint64_t GiB = uint64_t {1} << 30u;

enum class Level : uint8_t { Normal, Elevated, Critical };

struct Thresholds {
    uint64_t elevated;
    uint64_t critical;
    uint64_t elevated_release;
    uint64_t critical_release;
};

// On 24 GiB hosts: elevated below 4 GiB; critical below 2 GiB.
// Clamp on smaller/larger hosts to avoid a fixed 4 GiB threshold everywhere.
[[nodiscard]] constexpr Thresholds ForPhysical(uint64_t total) {
    const uint64_t elevated = std::clamp(total / 6, 2 * GiB, 6 * GiB);
    const uint64_t critical = std::clamp(total / 12, GiB, 3 * GiB);
    return {elevated, critical, elevated + GiB, critical + GiB};
}

// Hysteresis: stay in a pressure tier until available RAM has recovered.
// Zero from an unavailable memory query is not evidence of a pressure transition.
[[nodiscard]] constexpr Level Next(Level previous, uint64_t available, uint64_t total) {
    if (available == 0 || total == 0) return previous;
    const auto t = ForPhysical(total);
    if (available < t.critical || (previous == Level::Critical && available < t.critical_release))
        return Level::Critical;
    if (available < t.elevated || (previous != Level::Normal && available < t.elevated_release))
        return Level::Elevated;
    return Level::Normal;
}

struct RetirePolicy {
    uint64_t min_unused_flips;
    uint32_t max_images_per_flip;
};

// Each candidate still passes TextureCache's existing tests (registered,
// no depth/stencil association, not GPU-modified) before any DeleteImage.
[[nodiscard]] constexpr RetirePolicy Images(Level level) {
    switch (level) {
    case Level::Critical: return {720, 24};
    case Level::Elevated: return {900, 20};
    default: return {1200, 16};
    }
}

// Do not force release of driver handles: caller still requires a static-store
// remake recipe, no pending optimized build, and the full Vulkan idle horizon.
struct PipelinePolicy {
    uint32_t idle_seconds;
    uint32_t max_evictions_per_scan;
};
[[nodiscard]] constexpr PipelinePolicy Pipelines(Level level) {
    switch (level) {
    case Level::Critical: return {90, 192};
    case Level::Elevated: return {120, 128};
    default: return {180, 256};
    }
}

// Temporary-file caching is intentionally preferred for normal launches.
// Adaptive launches allow Windows to write cold mapped guest pages to disk,
// rather than hinting that a large temporary file should remain cached.
[[nodiscard]] constexpr bool PreferTemporaryBacking(bool adaptive) { return !adaptive; }

[[nodiscard]] inline bool Enabled() {
    static const bool enabled = [] {
#if defined(_WIN32)
        char* value = nullptr;
        size_t length = 0;
        if (_dupenv_s(&value, &length, "KYTY_ADAPTIVE_RAM") != 0) return false;
        const bool on = value != nullptr && std::string_view(value) == "1";
        std::free(value);
        return on;
#else
        const char* value = std::getenv("KYTY_ADAPTIVE_RAM");
        return value != nullptr && std::string_view(value) == "1";
#endif
    }();
    return enabled;
}

[[nodiscard]] constexpr const char* Name(Level level) {
    switch (level) {
    case Level::Critical: return "critical";
    case Level::Elevated: return "elevated";
    default: return "normal";
    }
}
} // namespace MemoryPressure
