#include "../../src/local/table-unbounded-levels.h"
#include <algorithm>
#include <cassert>
#include <cstdint>
#include <vector>
#include <array>

// Metadata-only fixture. Simulates stage plan construction and two-pass
// locate-then-read ordering. No guess about game memory/permissions.
struct Run { uint32_t address, count; int32_t immediate; bool bounded; uint32_t records; bool via_slot; };
static auto flags(const std::vector<Run>& runs, const std::vector<uint16_t>& ends){
 return TableUnboundedLevels::Compute(runs,ends,[](const Run& run){return !run.bounded;});
}
struct Trace {std::vector<uint32_t> addresses,reads; bool ok=true;};
static Trace evaluate(const std::vector<Run>& runs, const std::vector<uint16_t>& ends,
                      bool enabled, bool mapping_ok, const std::vector<uint32_t>& initial){
 Trace t;
 auto qualify=flags(runs,ends);
 size_t begin=0,level=0;
 auto slots=initial;
 for(const size_t end:ends){
  if(end>runs.size()||end<=begin){t.ok=false;return t;}
  const bool optimized=enabled&&qualify.size()==ends.size()&&qualify[level]!=0;
  ++level;
  for(size_t i=begin;i<end;++i){
   const auto& r=runs[i];
   const bool check_bounds=optimized?false:r.bounded;
   const uint64_t size=uint64_t(r.records)*4u;
   if(check_bounds&&(r.immediate<0||uint64_t(r.immediate)+uint64_t(r.count)*4>size)){
    t.ok=false;return t;
   }
   const uint32_t offset=r.via_slot?slots[0]:r.address;
   const uint32_t addr=offset+static_cast<uint32_t>(r.immediate);
   // Mapping proof happens on both paths, even for unbounded metadata.
   if(!mapping_ok){t.ok=false;return t;}
   t.addresses.push_back(addr);
  }
  for(size_t i=begin;i<end;++i){
   auto addr=t.addresses[t.addresses.size()-(end-begin)+(i-begin)];
   t.reads.push_back(addr);
   slots[0]=addr; // later level may read the address calculated in this level
  }
  begin=end;
 }
 t.ok=t.ok&&begin==runs.size();
 return t;
}
static void same(const std::vector<Run>& runs,const std::vector<uint16_t>& ends,
                 bool mapped=true,const std::vector<uint32_t>& slots={0}){
 const auto a=evaluate(runs,ends,false,mapped,slots),b=evaluate(runs,ends,true,mapped,slots);
 assert(a.ok==b.ok); assert(a.addresses==b.addresses);assert(a.reads==b.reads);
}
int main(){
 std::vector<Run> a={{0x1000,2,0,false,0,false},{0x1040,4,0,false,0,false},
                       {0,1,16,false,0,true},{0x2000,2,4,true,4,false}};
 const std::vector<uint16_t> levels={2,3,4};
 assert((flags(a,levels)==std::vector<uint8_t>{1,1,0}));
 same(a,levels);
 same(a,levels,false); // failed mapping always rejects, both paths
 a[3].records=1; same(a,levels); // bounded range rejection must be unchanged
 a[3].records=32; same(a,levels);
 a[3].bounded=false;
 assert((flags(a,levels)==std::vector<uint8_t>{1,1,1}));
 same(a,levels);
 const std::vector<Run> crossing={{0x0ff8,4,0,false,0,false},{0x3ff8,8,0,false,0,false}};
 same(crossing,{1,2}); // 4 KiB, 16 KiB boundary checks remain with original locate
 assert(flags(crossing,{3}).empty());
 assert(flags(crossing,{1}).empty());
 assert(flags(crossing,{0,2}).empty());
 assert(flags(crossing,{2,2}).empty());
 assert(flags(crossing,{}).empty());
 assert(flags({},{}).empty());
 return 0;
}
