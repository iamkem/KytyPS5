// Read-only inspector for the exact KytyPB01 index footer and tables.
// Does NOT read the stored shader binaries or create Vulkan handles.
// Run: kyty-binary-index-audit.exe _PipelineCache/static/PPSA01341_01.007.000.binaries
#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <limits>
#include <span>
#include <string>
#include <vector>

namespace {
constexpr std::array<char, 8> Magic {'K','y','t','y','P','B','0','1'};
constexpr uint64_t MiB = uint64_t{1} << 20;
constexpr size_t KeyBytes = 32; // Vulkan VK_MAX_PIPELINE_BINARY_KEY_SIZE_KHR
struct Cursor {
    const uint8_t* current{};
    const uint8_t* end{};
    template<class T> bool Get(T& value) {
        if (static_cast<size_t>(end-current) < sizeof(T)) return false;
        std::memcpy(&value,current,sizeof(T));
        current+=sizeof(T);
        return true;
    }
    bool Skip(size_t n) {
        if (static_cast<size_t>(end-current) < n) return false;
        current+=n;return true;
    }
    bool Key() {
        uint32_t size=0;
        return Get(size) && size <= KeyBytes && Skip(KeyBytes);
    }
};
struct Binary {uint64_t size=0;uint64_t offset=0;uint32_t users=0;};
bool Inspect(const std::filesystem::path& path) {
    std::ifstream file(path,std::ios::binary|std::ios::ate);
    if(!file) return false;
    const auto len=file.tellg();
    if(len<std::streamoff(64)) return false;
    const uint64_t length=static_cast<uint64_t>(len);
    file.seekg(-24,std::ios::end);
    uint64_t table_at=0,checksum=0;
    std::array<char,8> magic{};
    if(!file.read(reinterpret_cast<char*>(&table_at),8) ||
       !file.read(reinterpret_cast<char*>(&checksum),8) ||
       !file.read(magic.data(),8) ||
       magic!=Magic || table_at>=length-24 || length-24-table_at>128*MiB)
       return false;
    const size_t table_size=static_cast<size_t>(length-24-table_at);
    std::vector<uint8_t> table(table_size);
    file.seekg(static_cast<std::streamoff>(table_at),std::ios::beg);
    if(!file.read(reinterpret_cast<char*>(table.data()),table_size)) return false;
    Cursor cur{table.data(),table.data()+table.size()};
    uint32_t nb=0,np=0,nr=0;
    if(!cur.Get(nb) || nb>10'000'000) return false;
    std::vector<Binary> binaries(nb);
    uint64_t file_data=0;
    for(auto& b:binaries) {
        uint64_t hash=0;
        if(!cur.Key() || !cur.Get(b.offset) || !cur.Get(b.size) || !cur.Get(hash) ||
           b.offset>table_at || b.size>table_at-b.offset) return false;
        file_data+=b.size;
    }
    if(!cur.Get(np) || np>10'000'000) return false;
    std::vector<std::pair<uint32_t,uint32_t>> pipelines(np);
    for(auto& p:pipelines)
        if(!cur.Key() || !cur.Get(p.first) || !cur.Get(p.second)) return false;
    if(!cur.Get(nr) || nr>50'000'000) return false;
    std::vector<uint32_t> refs(nr);
    for(auto& ref:refs) {
        if(!cur.Get(ref) || ref>=nb) return false;
        binaries[ref].users++;
    }
    if(cur.current!=cur.end) return false;
    for(const auto& p:pipelines)
        if(p.first>nr || p.second>nr-p.first) return false;
    uint64_t shared_bytes=0,owned_bytes=0,shared_refs=0,owned_refs=0;
    uint32_t shared_count=0,owned_count=0;
    uint64_t hot_bytes=0,hot_refs=0;
    for(const auto& b:binaries) {
        if(b.users>=16) {shared_bytes+=b.size;shared_count++;shared_refs+=b.users;}
        else {owned_bytes+=b.size;owned_count++;owned_refs+=b.users;}
        if(b.users>=100) {hot_bytes+=b.size;hot_refs+=b.users;}
    }
    std::printf("BINARY_INDEX_AUDIT_PASS path=%s\n",path.string().c_str());
    std::printf("INDEX file_mib=%.2f table_mib=%.2f binaries=%u pipelines=%u refs=%u stored_data_mib=%.2f\n",
        double(length)/MiB,double(table_size)/MiB,nb,np,nr,double(file_data)/MiB);
    std::printf("INDEX shared_users_ge16 binaries=%u total_payload_mib=%.2f referenced=%llu\n",
        shared_count,double(shared_bytes)/MiB,static_cast<unsigned long long>(shared_refs));
    std::printf("INDEX per_pipeline_owned binaries=%u total_payload_mib=%.2f referenced=%llu\n",
        owned_count,double(owned_bytes)/MiB,static_cast<unsigned long long>(owned_refs));
    std::printf("INDEX highly_shared_ge100 total_payload_mib=%.2f referenced=%llu\n",
        double(hot_bytes)/MiB,static_cast<unsigned long long>(hot_refs));
    std::puts("INDEX_NOTE Shared payload totals are INDEX upper bounds, not measured Vulkan handle memory or process RAM.");
    std::puts("INDEX_NOTE vkPipelineBinaryKHR handles are created lazily, so the live shared set can be smaller.");
    (void)checksum; // The file's XXH3 needs xxhash; structure validation here is read-only.
    return true;
}
}
int main(int argc,char**argv) {
    if(argc!=2) {std::fprintf(stderr,"Usage: kyty-binary-index-audit.exe FILE\n");return 2;}
    if(!Inspect(argv[1])) {std::puts("BINARY_INDEX_AUDIT_FAIL");return 1;}
    return 0;
}
