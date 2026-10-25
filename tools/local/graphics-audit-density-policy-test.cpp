#include "loader/graphicsAuditDensity.h"

using namespace Loader::GameArgs::GraphicsAuditDensity;
static_assert(Value("original").empty());
static_assert(Value("ps4base").empty());
static_assert(Value("PS4Base").empty());
static_assert(Value("ps4base;KYTY_UNSAFE=1").empty());
