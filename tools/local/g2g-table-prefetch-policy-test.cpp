#include "../../src/local/table-prefetch-dedupe.h"
#include <cassert>
#include <cstdint>
#include <vector>
#include <initializer_list>

static std::vector<uint64_t> Run(std::initializer_list<std::initializer_list<uint64_t>> levels, bool on){
 std::vector<uint64_t> out;
 TablePrefetchDedupe::State state;
 for(const auto& level:levels){
  if(on)state.BeginLevel();
  for(uint64_t line:level){
   if(on&&state.ShouldSkip(line))continue;
   out.push_back(line);
  }
 }
 return out;
}
int main(){
 assert((Run({{0,0,0}},true)==std::vector<uint64_t>{0}));
 assert((Run({{0,0,0}},false)==std::vector<uint64_t>{0,0,0}));
 assert((Run({{0x1000,0x1040,0x1000}},true)==std::vector<uint64_t>{0x1000,0x1040,0x1000}));
 assert((Run({{0x1000,0x1000,0x1040,0x1040},{0x1040,0x1000,0x1000}},true)==std::vector<uint64_t>{0x1000,0x1040,0x1040,0x1000}));
 assert((Run({{0x1000,0x1040,0x1080},{0x1080,0x10c0}},true)==std::vector<uint64_t>{0x1000,0x1040,0x1080,0x1080,0x10c0}));
 assert((Run({{},{}},true).empty()));
 return 0;
}
