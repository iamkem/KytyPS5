// Standalone CPU-only policy check. No emulator, Vulkan context, precompile or cache I/O.
#include "local/shader-feature-trial.h"

#include <cassert>
#include <filesystem>

int main() {
    const auto production = ShaderFeatureTrial::CacheRoot(false).lexically_normal();
    const auto experiment = ShaderFeatureTrial::CacheRoot(true).lexically_normal();
    assert(production == std::filesystem::path("_PipelineCache"));
    assert(experiment == std::filesystem::path("_Build") / "shader-feature-trial" / "_PipelineCache");
    assert(production != experiment);
    assert((experiment / "static" / "PPSA01341_01.007.000.features") !=
           (production / "static" / "PPSA01341_01.007.000.features"));
    assert((experiment / "warmup-v2" / "test.shaders") !=
           (production / "warmup-v2" / "test.shaders"));
    assert((experiment / "local" / "test.bin") !=
           (production / "local" / "test.bin"));
    return 0;
}
