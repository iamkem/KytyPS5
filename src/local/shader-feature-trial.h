#pragma once

// A fixed, opt-in cache namespace for investigating translator features without ever
// opening the player's regular static, local, table, played, or warmup pipeline caches.
// The experiment must be enabled independently in every launched process.
#include <cstdlib>
#include <filesystem>
#include <string_view>

namespace ShaderFeatureTrial {

inline bool Enabled() noexcept {
    const char* value = std::getenv("KYTY_SHADER_FEATURE_TRIAL");
    return value != nullptr && std::string_view(value) == "1";
}

inline std::filesystem::path CacheRoot(bool trial) {
    return trial ? std::filesystem::path("_Build") / "shader-feature-trial" / "_PipelineCache"
                 : std::filesystem::path("_PipelineCache");
}

inline std::filesystem::path CacheRoot() {
    return CacheRoot(Enabled());
}

} // namespace ShaderFeatureTrial
