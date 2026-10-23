// Read-only Windows process virtual-memory census. No game execution, suspension,
// page protection changes, working-set trimming or calls inside the target process.
// Compile: clang++ -std=c++20 -Wall -Wextra -Werror tools/local/kyty-ram-census.cpp -o _Build/kyty-ram-census.exe
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <tlhelp32.h>
#include <psapi.h>
#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdio>
#include <cwchar>
#include <map>
#include <string>
#include <vector>

namespace {
constexpr uint64_t MiB = uint64_t{1} << 20;
constexpr uint64_t GiB = uint64_t{1} << 30;

struct Allocation {
    uintptr_t base = 0;
    DWORD type = 0;
    uint64_t committed = 0;
    uint64_t largest_region = 0;
    uint32_t regions = 0;
};

struct Census {
    uint64_t private_committed = 0;
    uint64_t mapped_committed = 0;
    uint64_t image_committed = 0;
    uint64_t other_committed = 0;
    uint64_t reserve_bytes = 0;
    uint64_t regions = 0;
    std::vector<Allocation> largest;
};

DWORD FindKytyProcess() {
    const HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) return 0;
    PROCESSENTRY32W entry{};
    entry.dwSize = sizeof(entry);
    DWORD found = 0;
    if (Process32FirstW(snap, &entry)) {
        do {
            if (_wcsicmp(entry.szExeFile, L"kyty_emulator.exe") == 0) {
                found = entry.th32ProcessID;
                break;
            }
        } while (Process32NextW(snap, &entry));
    }
    CloseHandle(snap);
    return found;
}

const char* TypeName(DWORD type) {
    switch (type) {
        case MEM_PRIVATE: return "PRIVATE";
        case MEM_MAPPED: return "MAPPED";
        case MEM_IMAGE: return "IMAGE";
        default: return "OTHER";
    }
}

Census Collect(HANDLE process) {
    SYSTEM_INFO info{};
    GetNativeSystemInfo(&info);
    const uintptr_t max_address = reinterpret_cast<uintptr_t>(info.lpMaximumApplicationAddress);
    uintptr_t address = reinterpret_cast<uintptr_t>(info.lpMinimumApplicationAddress);
    std::map<std::pair<uintptr_t, DWORD>, Allocation> groups;
    Census result;
    size_t failures = 0;
    while (address < max_address) {
        MEMORY_BASIC_INFORMATION region{};
        const SIZE_T got = VirtualQueryEx(process, reinterpret_cast<void*>(address), &region, sizeof(region));
        if (got == 0) {
            // A region may disappear during normal allocations/frees. Retry at next page,
            // but don't spend minutes probing an inaccessible process.
            if (++failures > 128 || max_address - address < 65536) break;
            address += 65536;
            continue;
        }
        failures = 0;
        const auto base = reinterpret_cast<uintptr_t>(region.BaseAddress);
        const auto size = static_cast<uint64_t>(region.RegionSize);
        if (size == 0 || base > UINTPTR_MAX - size) break;
        const auto next = base + static_cast<uintptr_t>(size);
        if (next <= address) break;
        address = next;
        ++result.regions;
        if (region.State == MEM_RESERVE) result.reserve_bytes += size;
        if (region.State != MEM_COMMIT) continue;
        switch (region.Type) {
            case MEM_PRIVATE: result.private_committed += size; break;
            case MEM_MAPPED:  result.mapped_committed += size; break;
            case MEM_IMAGE:   result.image_committed += size; break;
            default: result.other_committed += size; break;
        }
        const auto key = std::pair{reinterpret_cast<uintptr_t>(region.AllocationBase), region.Type};
        auto& group = groups[key];
        group.base = key.first;
        group.type = key.second;
        group.committed += size;
        group.largest_region = std::max(group.largest_region, size);
        ++group.regions;
    }
    result.largest.reserve(groups.size());
    for (const auto& [_, group] : groups) result.largest.push_back(group);
    std::sort(result.largest.begin(), result.largest.end(), [](const auto& a, const auto& b) {
        return a.committed > b.committed;
    });
    return result;
}

void Print(HANDLE process, DWORD pid) {
    PROCESS_MEMORY_COUNTERS_EX pm{};
    pm.cb = sizeof(pm);
    const bool process_ok = K32GetProcessMemoryInfo(process,
        reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&pm), sizeof(pm)) != 0;
    MEMORYSTATUSEX os{};
    os.dwLength = sizeof(os);
    const bool os_ok = GlobalMemoryStatusEx(&os) != 0;
    const auto census = Collect(process);
    std::printf("RAM_CENSUS_VERSION=2 PID=%lu READ_ONLY=1\n", static_cast<unsigned long>(pid));
    if (process_ok) {
        std::printf("RAM_CENSUS_PROCESS working_set_mib=%llu private_bytes_mib=%llu pagefile_usage_mib=%llu\n",
            static_cast<unsigned long long>(pm.WorkingSetSize / MiB),
            static_cast<unsigned long long>(pm.PrivateUsage / MiB),
            static_cast<unsigned long long>(pm.PagefileUsage / MiB));
    } else {
        std::printf("RAM_CENSUS_PROCESS unavailable error=%lu\n", static_cast<unsigned long>(GetLastError()));
    }
    if (os_ok) std::printf("RAM_CENSUS_HOST total_mib=%llu available_mib=%llu\n",
        static_cast<unsigned long long>(os.ullTotalPhys / MiB),
        static_cast<unsigned long long>(os.ullAvailPhys / MiB));
    std::printf("RAM_CENSUS_VIRTUAL private_commit_mib=%llu mapped_commit_mib=%llu image_commit_mib=%llu other_commit_mib=%llu reserve_gib=%.2f regions=%llu\n",
        static_cast<unsigned long long>(census.private_committed / MiB),
        static_cast<unsigned long long>(census.mapped_committed / MiB),
        static_cast<unsigned long long>(census.image_committed / MiB),
        static_cast<unsigned long long>(census.other_committed / MiB),
        static_cast<double>(census.reserve_bytes) / static_cast<double>(GiB),
        static_cast<unsigned long long>(census.regions));
    // Allocation-base cohorts reveal whether multi-GiB private commit lives in
    // one cache arena, medium-sized blocks, or numerous small host allocations.
    // Unlike the TOP 20 list these include every committed allocation group.
    constexpr std::array<uint64_t, 7> bounds {64 * 1024ull, 256 * 1024ull, MiB, 4 * MiB,
                                              16 * MiB, 64 * MiB, 256 * MiB};
    constexpr std::array<const char*, 8> labels {"lt64k", "64k_to_256k", "256k_to_1m",
        "1m_to_4m", "4m_to_16m", "16m_to_64m", "64m_to_256m", "ge256m"};
    for (const DWORD type : {MEM_PRIVATE, MEM_MAPPED}) {
        std::array<uint64_t, 8> counts{};
        std::array<uint64_t, 8> bytes{};
        for (const auto& allocation : census.largest) {
            if (allocation.type != type) continue;
            const size_t bucket = static_cast<size_t>(
                std::upper_bound(bounds.begin(), bounds.end(), allocation.committed) - bounds.begin());
            counts[bucket]++;
            bytes[bucket] += allocation.committed;
        }
        for (size_t bucket = 0; bucket < counts.size(); ++bucket) {
            std::printf("RAM_CENSUS_COHORT type=%s bucket=%s allocations=%llu committed_mib=%.2f\n",
                TypeName(type), labels[bucket], static_cast<unsigned long long>(counts[bucket]),
                static_cast<double>(bytes[bucket]) / static_cast<double>(MiB));
        }
    }
    // Always include the largest private owners, not only the global top 20.
    size_t private_listed = 0;
    for (const auto& a : census.largest) {
        if (private_listed >= 12) break;
        if (a.type != MEM_PRIVATE || a.committed < 8 * MiB) continue;
        std::printf("RAM_CENSUS_TOP_PRIVATE rank=%zu allocation_base=0x%llx commit_mib=%.2f regions=%u\n",
            ++private_listed, static_cast<unsigned long long>(a.base),
            static_cast<double>(a.committed) / static_cast<double>(MiB), a.regions);
    }
    // Ignore tiny allocations to keep the global output focused on large owners.
    size_t listed = 0;
    for (const auto& a : census.largest) {
        if (a.committed < 8 * MiB || listed >= 20) break;
        const size_t i = listed++;
        std::printf("RAM_CENSUS_TOP rank=%zu type=%s allocation_base=0x%llx commit_mib=%llu largest_region_mib=%llu regions=%u\n",
            i + 1, TypeName(a.type), static_cast<unsigned long long>(a.base),
            static_cast<unsigned long long>(a.committed / MiB),
            static_cast<unsigned long long>(a.largest_region / MiB), a.regions);
    }
    std::puts("RAM_CENSUS_NOTE MEM_MAPPED aliases may count the same physical pages repeatedly.");
    std::puts("RAM_CENSUS_NOTE VirtualQueryEx reports committed VIRTUAL address ranges, not real physical residency.");
    std::puts("RAM_CENSUS_NOTE PROCESS private bytes, process working set and mapped commit are NOT additive.");
    std::fflush(stdout);
}
} // namespace

int main(int argc, char** argv) {
    DWORD pid = 0;
    unsigned watch_seconds = 0;
    unsigned watch_count = 1;
    if (argc == 2 && std::string(argv[1]) == "--self") {
        pid = GetCurrentProcessId();
    } else if (argc == 2 && std::string(argv[1]) == "--synthetic") {
        // Isolated 64 MiB private + 64 MiB mapped fixture validates attribution.
        // All memory belongs to THIS profiler process, never Kyty.
        constexpr SIZE_T FixtureSize = 64u * 1024u * 1024u;
        auto* private_area = static_cast<uint8_t*>(VirtualAlloc(nullptr, FixtureSize,
            MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE));
        HANDLE section = CreateFileMappingW(INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE,
            0, static_cast<DWORD>(FixtureSize), nullptr);
        auto* mapped_area = section ? static_cast<uint8_t*>(MapViewOfFile(section,
            FILE_MAP_READ | FILE_MAP_WRITE, 0, 0, FixtureSize)) : nullptr;
        if (!private_area || !mapped_area) {
            if (private_area) VirtualFree(private_area, 0, MEM_RELEASE);
            if (mapped_area) UnmapViewOfFile(mapped_area);
            if (section) CloseHandle(section);
            std::fputs("RAM_CENSUS_SYNTHETIC_FAIL allocation\n", stderr);
            return 5;
        }
        for (SIZE_T i = 0; i < FixtureSize; i += 4096) {
            private_area[i] = 0x5a;
            mapped_area[i] = 0x5a;
        }
        const Census snapshot = Collect(GetCurrentProcess());
        const bool valid = snapshot.private_committed >= FixtureSize && snapshot.mapped_committed >= FixtureSize;
        Print(GetCurrentProcess(), GetCurrentProcessId());
        std::puts(valid ? "RAM_CENSUS_SYNTHETIC_PASS" : "RAM_CENSUS_SYNTHETIC_FAIL classification");
        UnmapViewOfFile(mapped_area);
        CloseHandle(section);
        VirtualFree(private_area, 0, MEM_RELEASE);
        return valid ? 0 : 6;
    } else if (argc == 3 && std::string(argv[1]) == "--pid") {
        try {
            const auto parsed = std::stoull(argv[2]);
            if (parsed == 0 || parsed > UINT32_MAX) return 2;
            pid = static_cast<DWORD>(parsed);
        } catch (...) {
            std::fputs("RAM_CENSUS_ERROR invalid pid\n", stderr);
            return 2;
        }
    } else if (argc == 4 && std::string(argv[1]) == "--watch") {
        // Safe, bounded sampling in a separate process: never suspends Kyty.
        try {
            const auto seconds = std::stoull(argv[2]);
            const auto count = std::stoull(argv[3]);
            if (seconds < 5 || seconds > 300 || count < 1 || count > 60) return 2;
            watch_seconds = static_cast<unsigned>(seconds);
            watch_count = static_cast<unsigned>(count);
        } catch (...) {
            std::fputs("RAM_CENSUS_ERROR invalid watch arguments\n", stderr);
            return 2;
        }
        pid = FindKytyProcess();
    } else if (argc == 1) {
        pid = FindKytyProcess();
    } else {
        std::fputs("Usage: kyty-ram-census.exe [--pid N | --self | --synthetic | --watch seconds count]\n", stderr);
        return 2;
    }
    if (!pid) {
        std::fputs("RAM_CENSUS_ERROR Kyty emulator is not running. No process was started.\n", stderr);
        return 3;
    }
    HANDLE process = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, pid);
    if (!process) {
        std::printf("RAM_CENSUS_ERROR cannot query process PID=%lu error=%lu\n",
            static_cast<unsigned long>(pid), static_cast<unsigned long>(GetLastError()));
        return 4;
    }
    for (unsigned i = 0; i < watch_count; ++i) {
        if (WaitForSingleObject(process, 0) == WAIT_OBJECT_0) {
            std::puts("RAM_CENSUS_STOP target process exited; no restart attempted.");
            break;
        }
        SYSTEMTIME now{};
        GetLocalTime(&now);
        std::printf("RAM_CENSUS_SNAPSHOT index=%u local=%04u-%02u-%02uT%02u:%02u:%02u\n",
            i + 1, now.wYear, now.wMonth, now.wDay, now.wHour, now.wMinute, now.wSecond);
        Print(process, pid);
        if (i + 1 < watch_count) Sleep(watch_seconds * 1000u);
    }
    CloseHandle(process);
    return 0;
}
