#pragma once

#include "graphics/guest_gpu/pm4.h"

#include <cstdint>

// Read-only census of *guest PM4 packets*, NOT GPU draws or hidden objects.
// Packet counts can be much smaller than actual Vulkan draws for MULTI and
// larger than submitted work for zero-sized draws. An accelerated run consumes
// several consecutive PM4 packets, so callers must record its extra members.
namespace DrawSubmissionCensus {

struct Counts {
    uint64_t direct_draw_packets = 0;
    uint64_t draw_preamble_packets = 0;
    uint64_t indirect_draw_packets = 0;
    uint64_t multi_draw_packets = 0;
    uint64_t compute_dispatch_packets = 0;
    uint64_t predicated_skip_draw_packets = 0;
    uint64_t predicated_skip_dispatch_packets = 0;
    uint64_t accelerated_extra_indirect_packets = 0;

    [[nodiscard]] constexpr uint64_t DrawPackets() const {
        return direct_draw_packets + indirect_draw_packets + multi_draw_packets;
    }
};

struct Report {
    Counts counts {};
    uint64_t total_flips = 0;
    uint64_t window_flips = 0;
    bool emit = false;
};

struct State {
    Counts window {};
    uint64_t total_flips = 0;
    uint64_t window_flips = 0;

    constexpr void Packet(uint32_t opcode, bool predicated_skip) {
        namespace Pm4 = Libs::Graphics::Pm4;
        switch (opcode) {
            case Pm4::IT_DRAW_INDEX_2:
            case Pm4::IT_DRAW_INDEX_OFFSET_2:
            case Pm4::IT_DRAW_INDEX_AUTO:
                ++window.direct_draw_packets;
                if (predicated_skip) ++window.predicated_skip_draw_packets;
                return;
            case Pm4::IT_DISPATCH_DRAW_PREAMBLE:
                ++window.draw_preamble_packets;
                if (predicated_skip) ++window.predicated_skip_draw_packets;
                return;
            case Pm4::IT_DRAW_INDIRECT:
            case Pm4::IT_DRAW_INDEX_INDIRECT:
                ++window.indirect_draw_packets;
                if (predicated_skip) ++window.predicated_skip_draw_packets;
                return;
            case Pm4::IT_DRAW_INDIRECT_MULTI:
            case Pm4::IT_DRAW_INDEX_INDIRECT_MULTI:
                ++window.multi_draw_packets;
                if (predicated_skip) ++window.predicated_skip_draw_packets;
                return;
            case Pm4::IT_DISPATCH_DIRECT:
            case Pm4::IT_DISPATCH_INDIRECT:
                ++window.compute_dispatch_packets;
                if (predicated_skip) ++window.predicated_skip_dispatch_packets;
                return;
            default: return;
        }
    }

    // Only for packet-fast-paths which consume more than one *contiguous*
    // IT_DRAW_INDEX_INDIRECT packet. MULTI commands stay one PM4 packet.
    constexpr void GroupedIndirect(uint32_t packets) {
        if (packets <= 1) return;
        const auto extra = static_cast<uint64_t>(packets - 1);
        window.indirect_draw_packets += extra;
        window.accelerated_extra_indirect_packets += extra;
    }

    [[nodiscard]] constexpr Report Flip() {
        ++total_flips;
        ++window_flips;
        // Early evidence without waiting for a long session, then one report
        // per 120 flip boundaries. The meaning is an interval, not one draw.
        const bool sample = total_flips <= 128
                                ? (total_flips & (total_flips - 1)) == 0
                                : (total_flips - 128) % 120 == 0;
        if (!sample) return {};
        Report report {window, total_flips, window_flips, true};
        window = {};
        window_flips = 0;
        return report;
    }
};

} // namespace DrawSubmissionCensus
