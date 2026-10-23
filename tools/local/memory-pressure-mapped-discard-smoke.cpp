#define WIN32_LEAN_AND_MEAN
#include <Windows.h>
#include <winioctl.h>
#include <cstdio>
#include <cstdint>
#include <string>

int main() {
    wchar_t tmp[MAX_PATH] {};
    if (!GetTempPathW(MAX_PATH, tmp)) return 1;
    const auto path = std::wstring(tmp) + L"kyty-discard-mapping-test-" + std::to_wstring(GetCurrentProcessId()) + L".tmp";
    HANDLE f = CreateFileW(path.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr,
        CREATE_ALWAYS, FILE_ATTRIBUTE_NOT_CONTENT_INDEXED | FILE_FLAG_DELETE_ON_CLOSE, nullptr);
    if (f == INVALID_HANDLE_VALUE) return 2;
    DWORD returned = 0;
    const bool sparse = DeviceIoControl(f, FSCTL_SET_SPARSE, nullptr, 0, nullptr, 0, &returned, nullptr) != 0;
    LARGE_INTEGER length {};
    length.QuadPart = 65536;
    if (!sparse || !SetFilePointerEx(f, length, nullptr, FILE_BEGIN) || !SetEndOfFile(f)) {CloseHandle(f);return 3;}
    HANDLE section = CreateFileMappingW(f, nullptr, PAGE_READWRITE, 0, 0, nullptr);
    if (!section) {CloseHandle(f);return 4;}
    auto* page = static_cast<uint8_t*>(MapViewOfFile(section, FILE_MAP_WRITE|FILE_MAP_READ, 0, 0, 65536));
    if (!page) {CloseHandle(section);CloseHandle(f);return 5;}
    page[0]=0x5a;page[4096]=0x45;
    const DWORD mappedResult = DiscardVirtualMemory(page, 65536);
    std::printf("STAGE5_FILE_MAPPING_DISCARD_STATUS=%lu (0=SUCCESS), bytes=%02x,%02x\n",
        static_cast<unsigned long>(mappedResult), page[0], page[4096]);
    auto* privatePage = static_cast<uint8_t*>(VirtualAlloc(nullptr, 65536, MEM_RESERVE|MEM_COMMIT, PAGE_READWRITE));
    if(!privatePage) return 6;
    privatePage[0]=0x2a;
    const DWORD privateResult = DiscardVirtualMemory(privatePage, 65536);
    std::printf("STAGE5_PRIVATE_ALLOCATION_DISCARD_STATUS=%lu (0=SUCCESS), after=%02x\n",
        static_cast<unsigned long>(privateResult), privatePage[0]);
    VirtualFree(privatePage,0,MEM_RELEASE);
    UnmapViewOfFile(page);CloseHandle(section);CloseHandle(f);
    return 0;
}
