#include "../../src/local/g2f-evaluate-diagnostics.h"
#include <cassert>
#include <cstdint>
#include <array>
using namespace G2FDiagnostics;

int main() {
  static_assert(SampleEvery==32);
  Counts c{};
  c.BeginLevel();
  assert(c.locate[LevelBatches]==1);
  for(uint64_t line : {0x1000ull,0x1000ull,0x1040ull,0x1000ull,0x1000ull}) c.NotePrefetch(line);
  assert(c.locate[PrefetchIssued]==5);
  assert(c.locate[AdjacentPrefetchDuplicates]==2);
  c.BeginLevel();
  c.NotePrefetch(0x1000);
  assert(c.locate[PrefetchIssued]==6);
  assert(c.locate[AdjacentPrefetchDuplicates]==2); // duplicate across levels must not count
  c.reader[ReadCalls]=8;
  c.reader[ReadWords]=20;
  c.reader[PageReuse]=3;
  c.reader[NewPage]=4;
  c.reader[CrossPageCalls]=1;
  c.reader[GranuleClear]=3;
  c.reader[WatcherChecks]=1;
  c.reader[WatcherAbsent]=0;
  c.reader[WatcherPresent]=1;
  c.reader[DirectSmallCalls]=5;
  c.reader[WatchedFallbackCalls]=2;
  c.reader[SpanAttempts]=2;
  c.reader[SpanSuccess]=1;
  c.reader[SpanFailure]=1;
  assert(ReaderConsistent(c));
  ++c.reader[WatcherAbsent];
  assert(!ReaderConsistent(c));
  --c.reader[WatcherAbsent];
  assert(ReaderConsistent(c));
  return 0;
}
