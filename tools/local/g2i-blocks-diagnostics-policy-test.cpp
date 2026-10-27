#include "../../src/local/g2i-blocks-diagnostics.h"
#include <cassert>
#include <cstdint>

using namespace G2IBlocksDiagnostics;
int main(){
 static_assert(SampleEvery==64);
 Counts c{};
 c.counts[SampledCalls]=1;
 c.counts[Stages]=2;
 c.counts[Descriptors]=5;
 c.counts[WritableDescriptors]=2;
 c.counts[ReadonlyDescriptors]=3;
 c.counts[ReadonlyReused]=2;
 c.counts[ReadonlyResolves]=1;
 c.counts[WritableObtainCalls]=2;
 c.counts[UploadCalls]=2;
 c.counts[UploadBytes]=224;
 c.AddTime(WritableObtain,123);
 c.AddTime(WritableObtain,456);
 c.AddTime(FinalUpload,200);
 c.AddTime(FinalUpload,300);
 c.counts[CompletedCalls]=1;
 assert(Consistent(c));
 assert(c.cycles[WritableObtain]==579);
 assert(c.cycles[FinalUpload]==500);
 assert(c.timed_calls[WritableObtain]==2);
 assert(c.timed_calls[FinalUpload]==2);
 c.counts[WritableObtainCalls]=1;
 assert(!Consistent(c));
 c.counts[WritableObtainCalls]=2;
 c.counts[Descriptors]=6;
 assert(!Consistent(c));
 c.counts[Descriptors]=5;
 c.counts[ReadonlyResolves]=4;
 assert(!Consistent(c));
 c.counts[ReadonlyResolves]=1;
 assert(Consistent(c));
 return 0;
}
