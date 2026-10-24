#include "local/occlusion-query-audit.h"

using OcclusionQueryAudit::Counters;

constexpr auto StartDumpReset() {
    Counters a {};
    a.Register(0x40102030u);
    a.Event(0x38, 1);  // PIXEL_PIPE_STAT_CONTROL
    a.Event(0x39, 1);  // PIXEL_PIPE_STAT_DUMP
    a.Event(0x39, 1);  // second snapshot, e.g. end counter
    a.Event(0x3a, 0);  // PIXEL_PIPE_STAT_RESET: ordinary event index
    a.Event(0x39, 1);  // reset is not proven to disable counting
    return a;
}

static_assert(!OcclusionQueryAudit::CanPublishHostVisibility());
static_assert(!Counters {}.ShouldReport());
static_assert([] { Counters a {}; a.Event(0x38, 1); return a.controls == 1 && !a.ShouldReport(); }());
static_assert([] { Counters a {}; a.Event(0x39, 1); return a.dumps_without_control == 1; }());
static_assert([] { Counters a {}; a.Event(0x38, 2); return a.unrecognized_event_indexes == 1; }());
static_assert([] { Counters a {}; a.Event(0x3a, 0); return a.unrecognized_event_indexes == 0; }());
static_assert(StartDumpReset().count_register_writes == 1);
static_assert(StartDumpReset().last_count_control == 0x40102030u);
static_assert(StartDumpReset().controls == 1);
static_assert(StartDumpReset().resets == 1);
static_assert(StartDumpReset().dumps == 3);
static_assert(StartDumpReset().dumps_without_control == 0);
static_assert(StartDumpReset().last_reset_index == 0);
static_assert(StartDumpReset().unrecognized_event_indexes == 0);
static_assert(!StartDumpReset().ShouldReport());
static_assert([] { Counters a {}; a.Event(0x39,1); a.Event(0x39,1); return a.ShouldReport(); }());
static_assert([] { Counters a {}; a.Event(0x38,1); a.Event(0x15,0); return a.zpass_events == 1; }());

int main() { return OcclusionQueryAudit::CanPublishHostVisibility() ? 1 : 0; }
