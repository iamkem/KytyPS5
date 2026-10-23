#include "local/stage7-resource-policy.h"
#include <cstdio>
static_assert(Stage7::MainUploadBytes(false) == 512 * Stage7::MiB);
static_assert(Stage7::MainUploadBytes(true) == 256 * Stage7::MiB);
static_assert(Stage7::ChunkBytes == 16 * Stage7::MiB);
static_assert(Stage7::WarmChunks(4 * Stage7::GiB, 24 * Stage7::GiB) == 8);
static_assert(Stage7::WarmChunks(3 * Stage7::GiB, 24 * Stage7::GiB) == 4);
static_assert(Stage7::WarmChunks(Stage7::GiB, 24 * Stage7::GiB) == 2);
static_assert(!Stage7::RetireChunk(31, false, 20, 2));
static_assert(!Stage7::RetireChunk(29, true, 20, 2));
static_assert(!Stage7::RetireChunk(31, true, 2, 2));
static_assert(Stage7::RetireChunk(31, true, 20, 2));
static_assert(!Stage7::HostCritical(0, 24 * Stage7::GiB));
static_assert(Stage7::HostCritical(Stage7::GiB, 24 * Stage7::GiB));
static_assert(!Stage7::HostBufferPressure(false, false, Stage7::GiB, 24 * Stage7::GiB));
static_assert(Stage7::HostBufferPressure(true, false, Stage7::GiB, 24 * Stage7::GiB));
static_assert(Stage7::HostBufferPressure(false, true, 12 * Stage7::GiB, 24 * Stage7::GiB));
static_assert(!Stage7::CanReloadGuestBacking(false, false, true));
static_assert(!Stage7::CanReloadGuestBacking(true, true, true));
static_assert(!Stage7::CanReloadGuestBacking(true, false, false));
static_assert(Stage7::CanReloadGuestBacking(true, false, true));
int main() {
    std::puts("STAGE7_POLICY_PASS chunk=16MiB main=256MiB warm=2/4/8 safe_guest_only=1");
}
