#pragma once

#include <cstdint>
#include <cstdlib>

// PS5 pixel-pipe-stat evidence, *not* an occlusion result provider.
// 0x38 controls counters; 0x39 writes one snapshot to each of 16 DB pairs;
// 0x3a resets counters, with a separate event-index classification.
// Until the emulator preserves DB_COUNT_CONTROL and matching GPU depth spans,
// Vulkan zero-visible results may NOT be written to guest memory. Incomplete
// counts must keep the compatibility always-visible fallback.
namespace OcclusionQueryAudit {

[[nodiscard]] inline bool Enabled() {
    static const bool enabled = [] {
        const char* value = std::getenv("KYTY_OCCLUSION_AUDIT");
        return value != nullptr && value[0] == '1' && value[1] == '\0';
    }();
    return enabled;
}

struct Counters {
    uint64_t count_register_writes = 0;
    uint64_t controls = 0;
    uint64_t resets = 0;
    uint64_t dumps = 0;
    uint64_t zpass_events = 0;
    uint64_t dumps_without_control = 0;
    uint64_t unrecognized_event_indexes = 0;
    uint32_t last_count_control = 0;
    uint32_t last_control_index = 0;
    uint32_t last_reset_index = 0;
    bool seen_control = false;

    constexpr void Register(uint32_t raw) {
        ++count_register_writes;
        last_count_control = raw;
    }
    constexpr void Event(uint32_t type, uint32_t index) {
        switch (type) {
            case 0x15: ++zpass_events; break;
            case 0x38:
                ++controls;
                last_control_index = index;
                seen_control = true;
                if (index != 1) ++unrecognized_event_indexes;
                break;
            case 0x39:
                ++dumps;
                if (!seen_control) ++dumps_without_control;
                if (index != 1) ++unrecognized_event_indexes;
                break;
            case 0x3a:
                ++resets;
                last_reset_index = index;
                // A pixel-pipe counter reset does not necessarily disable the
                // counting configuration. Never infer an invalid interval from
                // resets, especially with generation-specific event indexes.
                break;
            default: break;
        }
    }
    // Log only the initial observation and exponentially spaced summaries;
    // no per-draw allocations or spam during multi-hour sessions.
    [[nodiscard]] constexpr bool ShouldReport() const {
        return dumps != 0 && (dumps & (dumps - 1)) == 0;
    }
};

// Thread-local diagnostic census: aggregates processors that share a parser
// thread; not a guest queue- or DB-specific interval tracker. Do not move
// this to Vulkan's recording worker or treat counts as culling evidence.
inline Counters& Current() {
    static thread_local Counters counters;
    return counters;
}

// Gate is deliberately closed: no host query count mapping, per-DB alignment,
// GPU completion/writeback ordering, or validation of sample aggregation yet.
[[nodiscard]] constexpr bool CanPublishHostVisibility() { return false; }

} // namespace OcclusionQueryAudit
