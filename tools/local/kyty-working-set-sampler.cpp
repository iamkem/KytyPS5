// Stage 8: bounded, read-only *sampled* working-set residency by region type.
// Uses QueryWorkingSetEx; NEVER locks/reads/frees/trims remote memory.
// Resident estimates are statistical virtual-address estimates, NOT unique
// physical frame counts (mapped aliases may be counted twice).
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <psapi.h>
#include <tlhelp32.h>
#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cwchar>
#include <map>
#include <string>
#include <vector>

namespace {
constexpr uint64_t MiB=uint64_t{1}<<20;
constexpr uint64_t Step=256*1024;
constexpr size_t Batch=2048;
constexpr size_t MaxSamples=300000;

struct Region {uintptr_t base=0,alloc=0;uint64_t size=0;DWORD type=0;};
struct Stat {uint64_t bytes=0,resident=0,shared=0,sampled=0,valid=0;};
struct Sample {uintptr_t address=0;uint64_t bytes=0;size_t group=0;};
constexpr std::array<const char*,7> Names={
    "PRIVATE_16MiB","PRIVATE_32MiB","PRIVATE_OTHER",
    "MAPPED_LARGE","MAPPED_OTHER","IMAGE","OTHER"};
DWORD FindKyty(){
    HANDLE snap=CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0);
    if(snap==INVALID_HANDLE_VALUE)return 0;
    PROCESSENTRY32W e{};e.dwSize=sizeof(e);
    DWORD pid=0;
    if(Process32FirstW(snap,&e))do{
        if(_wcsicmp(e.szExeFile,L"kyty_emulator.exe")==0){pid=e.th32ProcessID;break;}
    }while(Process32NextW(snap,&e));
    CloseHandle(snap);return pid;
}
bool Collect(HANDLE proc,std::vector<Region>& out,
    std::map<std::pair<uintptr_t,DWORD>,uint64_t>& groups){
    SYSTEM_INFO info{};GetNativeSystemInfo(&info);
    const auto end=reinterpret_cast<uintptr_t>(info.lpMaximumApplicationAddress);
    uintptr_t at=reinterpret_cast<uintptr_t>(info.lpMinimumApplicationAddress);
    uint32_t failures=0;
    while(at<end){
        MEMORY_BASIC_INFORMATION m{};
        if(!VirtualQueryEx(proc,reinterpret_cast<LPCVOID>(at),&m,sizeof(m))){
            if(++failures>128 || end-at<65536)return false;
            at+=65536;continue;
        }
        failures=0;
        const auto begin=reinterpret_cast<uintptr_t>(m.BaseAddress);
        const uint64_t size=m.RegionSize;
        if(!size || begin>UINTPTR_MAX-size)return false;
        const auto next=begin+static_cast<uintptr_t>(size);
        if(next<=at)return false;
        at=next;
        if(m.State!=MEM_COMMIT)continue;
        const auto alloc=reinterpret_cast<uintptr_t>(m.AllocationBase);
        out.push_back({begin,alloc,size,m.Type});
        groups[{alloc,m.Type}]+=size;
    }
    return true;
}
size_t GroupFor(const Region& r,const std::map<std::pair<uintptr_t,DWORD>,uint64_t>& groups){
    if(r.type==MEM_PRIVATE){
        auto it=groups.find({r.alloc,r.type});
        uint64_t s=it==groups.end()?0:it->second;
        if(s>=15*MiB && s<17*MiB)return 0;
        if(s>=31*MiB && s<33*MiB)return 1;
        return 2;
    }
    if(r.type==MEM_MAPPED){
        auto it=groups.find({r.alloc,r.type});
        return it!=groups.end() && it->second>=8*1024*MiB?3:4;
    }
    return r.type==MEM_IMAGE?5:6;
}
// Offset varies from slab to slab (avoid systematic first-page bias).
uintptr_t SampleAddress(uintptr_t begin,uint64_t length,uint64_t page){
    uint64_t pages=std::max<uint64_t>(1,length/page);
    uint64_t key=(static_cast<uint64_t>(begin)>>12)*0x9E3779B97F4A7C15ull;
    key^=key>>30;key*=0xBF58476D1CE4E5B9ull;
    key^=key>>27;key*=0x94D049BB133111EBull;key^=key>>31;
    return begin+static_cast<uintptr_t>((key%pages)*page);
}
bool Probe(HANDLE proc,const std::vector<Sample>& items,std::array<Stat,7>& result){
    std::vector<PSAPI_WORKING_SET_EX_INFORMATION> query(Batch);
    for(size_t i=0;i<items.size();i+=Batch){
        const size_t count=std::min(Batch,items.size()-i);
        for(size_t j=0;j<count;j++)query[j].VirtualAddress=reinterpret_cast<void*>(items[i+j].address);
        if(!QueryWorkingSetEx(proc,query.data(),static_cast<DWORD>(count*sizeof(query[0])))){
            std::printf("WS_RESIDENCY_ERROR query error=%lu at_sample=%zu\n",GetLastError(),i);
            return false;
        }
        for(size_t j=0;j<count;j++){
            const auto& s=items[i+j];auto& stat=result[s.group];
            stat.sampled++;
            if(query[j].VirtualAttributes.Valid){
                stat.resident+=s.bytes;
                stat.valid++;
                if(query[j].VirtualAttributes.Shared)stat.shared+=s.bytes;
            }
        }
    }
    return true;
}
int Run(HANDLE proc,DWORD pid){
    std::vector<Region> regions;
    std::map<std::pair<uintptr_t,DWORD>,uint64_t> groups;
    if(!Collect(proc,regions,groups)){
        std::puts("WS_RESIDENCY_ERROR VirtualQueryEx enumeration failed");
        return 1;
    }
    SYSTEM_INFO info{};GetNativeSystemInfo(&info);
    const uint64_t page=info.dwPageSize;
    std::array<Stat,7> stats{};
    std::vector<Sample> samples;
    samples.reserve(120000);
    bool truncated=false;
    for(const auto& r:regions){
        const size_t group=GroupFor(r,groups);
        stats[group].bytes+=r.size;
        for(uint64_t offset=0;offset<r.size;offset+=Step){
            if(samples.size()>=MaxSamples){truncated=true;break;}
            const uint64_t len=std::min(Step,r.size-offset);
            // MEM_COMMIT pages are page-aligned; limit sample to this slab.
            samples.push_back({SampleAddress(r.base+static_cast<uintptr_t>(offset),len,page),len,group});
        }
        if(truncated)break;
    }
    if(truncated){
        std::puts("WS_RESIDENCY_ERROR exceeded bounded sample limit; refusing partial estimate");
        return 1;
    }
    if(!Probe(proc,samples,stats))return 1;
    PROCESS_MEMORY_COUNTERS_EX pmc{};pmc.cb=sizeof(pmc);
    if(!GetProcessMemoryInfo(proc,reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&pmc),sizeof(pmc)))
        return 1;
    MEMORYSTATUSEX mem{};mem.dwLength=sizeof(mem);GlobalMemoryStatusEx(&mem);
    uint64_t total=0,resident=0;
    for(size_t i=0;i<stats.size();i++){
        const auto& s=stats[i];total+=s.bytes;resident+=s.resident;
        std::printf("WS_RESIDENCY group=%s committed_mib=%.2f sample_pages=%llu valid_pages=%llu resident_ESTIMATE_mib=%.2f shared_ESTIMATE_mib=%.2f\n",
            Names[i],double(s.bytes)/MiB,
            static_cast<unsigned long long>(s.sampled),static_cast<unsigned long long>(s.valid),
            double(s.resident)/MiB,double(s.shared)/MiB);
    }
    std::printf("WS_RESIDENCY_TOTAL pid=%lu sampled_pages=%zu virtual_commit_mib=%.2f resident_ESTIMATE_mib=%.2f process_working_set_mib=%.2f process_private_mib=%.2f system_available_mib=%.2f\n",
        pid,samples.size(),double(total)/MiB,double(resident)/MiB,
        double(pmc.WorkingSetSize)/MiB,double(pmc.PrivateUsage)/MiB,double(mem.ullAvailPhys)/MiB);
    std::puts("WS_RESIDENCY_NOTE READ_ONLY=1 ONE_SHOT=1 STEP=256KiB.");
    std::puts("WS_RESIDENCY_NOTE Estimates extrapolate one sampled page per 256KiB committed virtual range; do NOT equate them to unique physical bytes.");
    std::puts("WS_RESIDENCY_NOTE MEM_MAPPED aliases may overcount. Process working set / system available are actual OS counters.");
    return 0;
}
}
int main(int argc,char**argv){
    DWORD pid=0;bool self=false;
    if(argc==1){pid=FindKyty();}
    else if(argc==2 && std::strcmp(argv[1],"--self")==0){pid=GetCurrentProcessId();self=true;}
    else if(argc==3 && std::strcmp(argv[1],"--pid")==0){
        const char* str=argv[2];char* end=nullptr;
        const auto value=std::strtoul(str,&end,10);
        if(str==end || *end || value==0 || value>UINT32_MAX)return 2;
        pid=static_cast<DWORD>(value);
    }else{
        std::puts("Usage: kyty-working-set-sampler.exe [--self | --pid <decimal>]");
        return 2;
    }
    if(!pid){std::puts("WS_RESIDENCY_ERROR no kyty_emulator.exe currently running");return 1;}
    HANDLE proc=OpenProcess(PROCESS_QUERY_INFORMATION|PROCESS_VM_READ,FALSE,pid);
    if(!proc){std::printf("WS_RESIDENCY_ERROR open pid=%lu error=%lu\n",pid,GetLastError());return 1;}
    const int status=Run(proc,pid);
    CloseHandle(proc);
    if(self && status==0)std::puts("WS_RESIDENCY_SELF_PASS");
    return status;
}
