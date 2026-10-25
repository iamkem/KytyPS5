#include "loader/modelFading.h"

using namespace Loader::GameArgs::ModelFading;
static_assert(Convars("original").empty());
static_assert(Convars("model").empty());
static_assert(Convars("instance").empty());
static_assert(Convars("combined").empty());
static_assert(Convars("combined;UNSAFE=1").empty());
