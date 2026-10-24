#include "local/draw-submission-census.h"

using DrawSubmissionCensus::State;
namespace Pm4 = Libs::Graphics::Pm4;

constexpr bool ClassifierAndPredication() {
    State s {};
    s.Packet(Pm4::IT_DRAW_INDEX_2, false);
    s.Packet(Pm4::IT_DRAW_INDEX_OFFSET_2, true);
    s.Packet(Pm4::IT_DRAW_INDEX_AUTO, false);
    s.Packet(Pm4::IT_DRAW_INDIRECT, false);
    s.Packet(Pm4::IT_DRAW_INDEX_INDIRECT, true);
    s.Packet(Pm4::IT_DRAW_INDEX_INDIRECT_MULTI, false);
    s.Packet(Pm4::IT_DRAW_INDIRECT_MULTI, true);
    s.Packet(Pm4::IT_DISPATCH_DRAW_PREAMBLE, false);
    s.Packet(Pm4::IT_DISPATCH_DIRECT, false);
    s.Packet(Pm4::IT_DISPATCH_INDIRECT, true);
    s.Packet(Pm4::IT_SET_CONTEXT_REG, false);  // not a draw
    s.GroupedIndirect(1); // no extra
    s.GroupedIndirect(4); // initial counted, plus three consumed packets
    const auto& c = s.window;
    return c.direct_draw_packets == 3 && c.indirect_draw_packets == 5 &&
           c.multi_draw_packets == 2 && c.draw_preamble_packets == 1 &&
           c.compute_dispatch_packets == 2 && c.DrawPackets() == 10 &&
           c.predicated_skip_draw_packets == 3 && c.predicated_skip_dispatch_packets == 1 &&
           c.accelerated_extra_indirect_packets == 3;
}
static_assert(ClassifierAndPredication());

constexpr bool BoundedFrameReports() {
    State s {};
    // First boundary emits, then next power of two; intervals reset only on report.
    s.Packet(Pm4::IT_DRAW_INDEX_AUTO, false);
    const auto first = s.Flip();
    if (!first.emit || first.window_flips != 1 || first.counts.DrawPackets() != 1) return false;
    s.Packet(Pm4::IT_DRAW_INDEX_AUTO, false);
    const auto second = s.Flip();
    if (!second.emit || second.counts.DrawPackets() != 1) return false;
    for (uint32_t frame = 3; frame <= 128; ++frame) {
        s.Packet(Pm4::IT_DISPATCH_DIRECT, false);
        const auto report = s.Flip();
        if (report.emit != ((frame & (frame - 1)) == 0)) return false;
        if (frame == 128 && (report.total_flips != 128 || report.window_flips != 64 ||
                             report.counts.compute_dispatch_packets != 64)) return false;
    }
    for (uint32_t frame = 129; frame <= 248; ++frame) {
        s.Packet(Pm4::IT_DRAW_INDEX_2, false);
        const auto report = s.Flip();
        if (frame < 248 && report.emit) return false;
        if (frame == 248 && (!report.emit || report.window_flips != 120 ||
                             report.counts.DrawPackets() != 120)) return false;
    }
    return true;
}
static_assert(BoundedFrameReports());

int main() { return ClassifierAndPredication() && BoundedFrameReports() ? 0 : 1; }
