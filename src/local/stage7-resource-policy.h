#pragma once
// Stage 7 experimental memory policy. No unsafe guest-page discard, no GPU side effects.
#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <cstring>

namespace Stage7 {
inline constexpr uint64_t MiB = uint64_t{1} << 20u;
inline constexpr uint64_t GiB = uint64_t{1} << 30u;
inline constexpr uint64_t ChunkBytes = 16 * MiB;
inline constexpr uint64_t IdleSeconds = 30;

inline bool Enabled() {
    static const bool value = [] {
#if defined(_WIN32)
        char* env = nullptr;
        size_t len = 0;
        if (_dupenv_s(&env, &len, "KYTY_STAGE7_RAM") != 0) return false;
        const bool enabled = env != nullptr && std::strcmp(env, "1") == 0;
        std::free(env);
        return enabled;
#else
        const char* env = std::getenv("KYTY_STAGE7_RAM");
        return env != nullptr && std::strcmp(env, "1") == 0;
#endif
    }();
    return value;
}

// Keep a large continuous staging ring for single huge texture uploads.
// Never substitute the small chunk pool for a buffer requiring a contiguous span.
// The legacy 512 MiB ring is completely unchanged when Stage7 is off.
[[nodiscard]] constexpr uint64_t MainUploadBytes(bool enabled) {
    return (enabled ? uint64_t{256} : uint64_t{512}) * MiB;
}

// A small warm reserve avoids allocation churn when a scene streams again.
// Even in critical memory, never release in-flight GPU buffers.
[[nodiscard]] constexpr uint64_t WarmChunks(uint64_t available, uint64_t physical) {
    if (available == 0 || physical == 0) return 8;
    if (available < std::max(GiB, physical / 12)) return 2;
    if (available < std::max(2 * GiB, physical / 6)) return 4;
    return 8;
}

[[nodiscard]] constexpr bool RetireChunk(uint64_t age_seconds, bool gpu_finished,
                                          uint64_t blocks, uint64_t warm_blocks) {
    return gpu_finished && age_seconds >= IdleSeconds && blocks > warm_blocks;
}

[[nodiscard]] constexpr bool HostCritical(uint64_t available, uint64_t physical) {
    return available != 0 && physical != 0 && available < std::max(GiB, physical / 12);
}

// Headroom should be recovered first via safe, idle Vulkan allocations.
// GPU-only modified data, in-flight work and non-reconstructible resources stay resident.
[[nodiscard]] constexpr bool HostBufferPressure(bool enabled, bool gpu_pressure,
                                                  uint64_t available, uint64_t physical) {
    return gpu_pressure || (enabled && HostCritical(available, physical));
}

[[nodiscard]] constexpr bool CanReloadGuestBacking(bool valid_guest_backing,
                                                    bool gpu_written,
                                                    bool stale_or_idle) {
    return valid_guest_backing && !gpu_written && stale_or_idle;
}
} // namespace Stage7
