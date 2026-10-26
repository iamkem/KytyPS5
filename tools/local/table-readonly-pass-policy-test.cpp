// Standalone C++ policy fixture, no emulator/game/GPU/Vulkan requirement.
#include "../../src/local/table-readonly-pass.h"
#include <array>
#include <cassert>
#include <cstddef>
#include <vector>

struct Buffer {
  bool written = false;
  bool atomic = false;
};
using TableReadOnlyPass::Eligible;
using TableReadOnlyPass::Begin;

static std::vector<size_t> Visit(const std::vector<Buffer>& buffers, bool enabled, bool eligible) {
  const auto count=buffers.size();
  std::vector<size_t> visit;
  for(size_t n=Begin(enabled,eligible,count);n<2*count;++n) {
    const size_t i=n<count?n:n-count;
    const bool write=buffers[i].written||buffers[i].atomic;
    if(write!=(n<count))continue;
    visit.push_back(n);  // Includes every original write/read visitor, preserving order.
  }
  return visit;
}
static void EqualModes(const std::vector<Buffer>& data){
  const bool eligible=Eligible(data.size(),data);
  assert(Visit(data,false,eligible)==Visit(data,true,eligible));
}
int main(){
  EqualModes({});
  for(size_t n : {size_t(1),size_t(2),size_t(32),size_t(33)}){
    std::vector<Buffer> read(n);
    assert(Eligible(n,read)==(n<=32));
    EqualModes(read);
    for(size_t writer=0;writer<n;++writer){
      auto mixed=read;
      mixed[writer].written=true;
      assert(!Eligible(n,mixed));
      EqualModes(mixed);
      mixed[writer].written=false;
      mixed[writer].atomic=true;
      assert(!Eligible(n,mixed));
      EqualModes(mixed);
    }
    std::vector<Buffer> all(n,{true,false});
    assert(!Eligible(n,all));
    EqualModes(all);
  }
  const std::array<Buffer,1> one{{{false,false}}};
  assert(!Eligible(0,one)); // count mismatch
  assert(!Eligible(2,one));
  assert(Eligible(1,one));
  assert(Begin(false,true,4)==0);
  assert(Begin(true,false,4)==0);
  assert(Begin(true,true,4)==4);
  return 0;
}
