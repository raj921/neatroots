import assert from "node:assert/strict";
import { batch, hex, makeRoots, s, span } from "../../packages/neatroots/test/helpers.js";

// Run from the repository root after pnpm install.
// pnpm --filter @neatlogs/neatroots exec tsx ../../research/repros/storage-retention.mts delete
// pnpm --filter @neatlogs/neatroots exec tsx ../../research/repros/storage-retention.mts retention
// Add -control to either case for one unchanged span.
// Each case uses and removes its own temporary home. No cloud or model calls.

async function blobs(revisions = 4) {
  const t = await makeRoots({ noEngine: true, serve: true });
  try {
    const traceId = hex(16), spanId = hex(8);
    for (const letter of ["a", "b", "c", "d"].slice(0, revisions)) {
      const payload = letter.repeat(128 * 1024);
      const root = span({ traceId, spanId, name: "updated run", kind: "workflow", attrs: [s("neatlogs.workflow.output", payload)] });
      const response = await fetch(t.url + "/v1/traces", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ resourceSpans: [{ resource: batch([]).resource, scopeSpans: [{ scope: { name: "repro" }, spans: [root] }] }] }),
      });
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    }
    const before = t.roots.store.blobs.size();
    t.roots.store.deleteRun(traceId);
    const after = t.roots.store.blobs.size();
    console.log(JSON.stringify({ case: "blobs", revisions, bytesPerRevision: 131072, blobBytesBeforeDelete: before, blobBytesAfterDelete: after, remainingRuns: t.roots.store.stats().runs }));
    assert.equal(after, 0, "Deleting the only run must release all its payload storage");
  } finally { await t.close(); }
}

async function retention(revisions = 12) {
  const t = await makeRoots({ noEngine: true });
  try {
    const cap = t.roots.store.storedBytes() + 4 * 131072;
    const traceId = hex(16), spanId = hex(8);
    for (let revision = 0; revision < revisions; revision++) {
      const payload = String.fromCharCode(65 + revision).repeat(131072);
      t.roots.ingest([batch([span({ traceId, spanId, name: "updated run", kind: "workflow", attrs: [s("neatlogs.workflow.output", payload)] })])]);
    }
    const healthyId = hex(16);
    t.roots.ingest([batch([span({ traceId: healthyId, name: "healthy recent run", kind: "workflow" })])]);
    const before = t.roots.store.storedBytes();
    const removed = t.roots.store.sweep(0, cap);
    const after = t.roots.store.storedBytes();
    const remainingRuns = t.roots.store.stats().runs;
    console.log(JSON.stringify({ case: "retention", revisions, cap, storedBytesBefore: before, storedBytesAfter: after, removed, remainingRuns, blobBytesAfterSweep: t.roots.store.blobs.size() }));
    assert.ok(t.roots.store.getRun(healthyId), "Retention must not delete every run while unreclaimable orphan files keep it above the cap");
  } finally { await t.close(); }
}

const cases: Record<string, () => Promise<void>> = {
  delete: blobs, retention,
  "delete-control": () => blobs(1),
  "retention-control": () => retention(1),
};
const run = cases[process.argv[2]];
if (!run) throw new Error("Choose: " + Object.keys(cases).join(", "));
await run();
