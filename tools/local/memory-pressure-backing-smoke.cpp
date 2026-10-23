// Small isolated Win32 memory-mapping smoke test; NEVER launches the emulator.
// Validates that the non-TEMPORARY sparse/delete-on-close backing remains coherent
// across writable aliases, and deletes itself when the last handle is closed.
#include "local/memory-pressure.h"
#define WIN32_LEAN_AND_MEAN
#include <Windows.h>
#include <winioctl.h>
#include <cstdio>
#include <cstdint>
#include <string>

int main() {
    if (MemoryPressure::PreferTemporaryBacking(true)) return 1;
    wchar_t folder[MAX_PATH] {};
    if (GetTempPathW(MAX_PATH, folder) == 0) return 2;
    const auto path = std::wstring(folder) + L"kyty-guest-mapped-stage3-" +
        std::to_wstring(GetCurrentProcessId()) + L".tmp";
    HANDLE file = CreateFileW(path.c_str(), GENERIC_READ | GENERIC_WRITE | GENERIC_EXECUTE,
        0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NOT_CONTENT_INDEXED | FILE_FLAG_DELETE_ON_CLOSE, nullptr);
    if (file == INVALID_HANDLE_VALUE) return 3;
    DWORD returned = 0;
    const bool sparse = DeviceIoControl(file, FSCTL_SET_SPARSE, nullptr, 0, nullptr, 0, &returned, nullptr) != 0;
    LARGE_INTEGER length {};
    length.QuadPart = 16LL * 1024 * 1024;
    if (!sparse || !SetFilePointerEx(file, length, nullptr, FILE_BEGIN) || !SetEndOfFile(file)) {
        CloseHandle(file); return 4;
    }
    HANDLE section = CreateFileMappingW(file, nullptr, PAGE_EXECUTE_READWRITE, 0, 0, nullptr);
    if (!section) { CloseHandle(file); return 5; }
    auto* a = static_cast<uint8_t*>(MapViewOfFile(section, FILE_MAP_READ | FILE_MAP_WRITE, 0, 0, 0));
    auto* b = static_cast<uint8_t*>(MapViewOfFile(section, FILE_MAP_READ | FILE_MAP_WRITE, 0, 0, 0));
    int status = 0;
    if (!a || !b) status = 6;
    else {
        const uint32_t offsets[] {0, 4096, 65536, 2 * 1024 * 1024, 15 * 1024 * 1024};
        for (unsigned i = 0; i < sizeof(offsets)/sizeof(offsets[0]); ++i)
            a[offsets[i]] = static_cast<uint8_t>(0x70 + i);
        for (unsigned i = 0; i < sizeof(offsets)/sizeof(offsets[0]); ++i)
            if (b[offsets[i]] != static_cast<uint8_t>(0x70 + i)) status = 7;
        b[2 * 1024 * 1024] = 0x42;
        if (a[2 * 1024 * 1024] != 0x42) status = 8;
        if (!FlushViewOfFile(a, 16 * 1024 * 1024)) status = 9;
    }
    if (b) UnmapViewOfFile(b);
    if (a) UnmapViewOfFile(a);
    CloseHandle(section);
    CloseHandle(file);
    if (GetFileAttributesW(path.c_str()) != INVALID_FILE_ATTRIBUTES) status = 10;
    if (status == 0) std::puts("GUEST_BACKING_ALIAS_SMOKE_PASS");
    else std::printf("GUEST_BACKING_ALIAS_SMOKE_FAIL=%d\\n", status);
    return status;
}
