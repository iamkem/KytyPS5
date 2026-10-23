// Stage 7 SSD/guest backing integrity smoke. No emulator or game files touched.
// Verifies file-backed pages survive unmap/remap; NEVER calls DiscardVirtualMemory.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <array>
#include <cstdint>
#include <cstdio>
#include <cstring>

int main() {
    wchar_t dir[MAX_PATH]{}, name[MAX_PATH]{};
    if (!GetTempPathW(MAX_PATH, dir) || !GetTempFileNameW(dir,L"S7R",0,name)) return 2;
    HANDLE file=CreateFileW(name,GENERIC_READ|GENERIC_WRITE,0,nullptr,CREATE_ALWAYS,
                            FILE_ATTRIBUTE_TEMPORARY|FILE_FLAG_DELETE_ON_CLOSE,nullptr);
    if(file==INVALID_HANDLE_VALUE) {DeleteFileW(name);return 3;}
    constexpr size_t Bytes=2ull*1024*1024;
    LARGE_INTEGER size{};size.QuadPart=Bytes;
    int result=4;
    if(SetFilePointerEx(file,size,nullptr,FILE_BEGIN)&&SetEndOfFile(file)){
        HANDLE mapping=CreateFileMappingW(file,nullptr,PAGE_READWRITE,0,0,nullptr);
        if(mapping){
            void* p=MapViewOfFile(mapping,FILE_MAP_ALL_ACCESS,0,0,Bytes);
            if(p){
                auto* bytes=static_cast<uint8_t*>(p);
                for(size_t i=0;i<Bytes;i++) bytes[i]=static_cast<uint8_t>((i*37+11)&255u);
                if(FlushViewOfFile(p,Bytes)) result=5;
                UnmapViewOfFile(p);
                if(result==5){
                    // Map a fresh view and compare EVERY BYTE, including the final page.
                    void* q=MapViewOfFile(mapping,FILE_MAP_READ,0,0,Bytes);
                    if(q){
                        const auto* read=static_cast<const uint8_t*>(q);
                        bool good=true;
                        for(size_t i=0;i<Bytes;i++){
                            if(read[i]!=static_cast<uint8_t>((i*37+11)&255u)){good=false;break;}
                        }
                        result=good?0:6;
                        UnmapViewOfFile(q);
                    }
                }
            }
            CloseHandle(mapping);
        }
    }
    CloseHandle(file); // FILE_FLAG_DELETE_ON_CLOSE
    if(result==0)std::puts("STAGE7_FILE_BACKING_PASS bytes=2097152 remap_verified=1 discard_used=0");
    else std::printf("STAGE7_FILE_BACKING_FAIL code=%d\n",result);
    return result;
}
