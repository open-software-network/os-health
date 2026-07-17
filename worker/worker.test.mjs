import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStateChangeMessage,
  collectSnapshot,
  failureIds,
  sameFailures,
  shouldPostStateChange,
} from "./worker.mjs";

const snapshot = {
  checks: [
    { id: "healthy", label: "Healthy", state: "healthy", detail: "Ready", statusCode: 200 },
    { id: "failed", label: "Failed API", state: "unhealthy", detail: "HTTP 503", statusCode: 503 },
  ],
};

test("sorts the failing check ids", () => {
  assert.deepEqual(failureIds(snapshot), ["failed"]);
  assert.equal(sameFailures(["a", "b"], ["a", "b"]), true);
  assert.equal(sameFailures(["a"], ["b"]), false);
});

test("builds outage messages with state markers", () => {
  const incident = buildStateChangeMessage([], ["failed"], snapshot, "https://health.opensoftware.co");
  assert.match(incident, /outage detected/);
  assert.match(incident, /Failed API/);
  assert.match(incident, /\[os-health-outage\] failed/);
});

test("builds recovery messages with recovered check details", () => {
  const recovery = buildStateChangeMessage(["failed"], [], {
    checks: snapshot.checks.map((check) => ({ ...check, state: "healthy", detail: "Ready", statusCode: 200 })),
  }, "https://health.opensoftware.co");
  assert.match(recovery, /outage recovered/);
  assert.match(recovery, /All 2 production checks are healthy again/);
  assert.match(recovery, /Failed API/);
  assert.match(recovery, /\[os-health-recovery\] failed/);
});

test("posts new and changed outages and recoveries", () => {
  assert.equal(shouldPostStateChange(null, []), false);
  assert.equal(shouldPostStateChange(null, ["failed"]), true);
  assert.equal(shouldPostStateChange([], ["failed"]), true);
  assert.equal(shouldPostStateChange(["failed"], ["failed"]), false);
  assert.equal(shouldPostStateChange(["failed"], []), true);
  assert.equal(shouldPostStateChange(["failed"], ["other"]), true);
  assert.equal(shouldPostStateChange([], []), false);
});

test("treats the public June Chat portal as healthy on HTTP 200", async () => {
  const result = await collectSnapshot({
    fetchImpl: async (url) => {
      if (url === "https://chat.opensoftware.co/") {
        return new Response("June Chat", { status: 200 });
      }
      if (url.endsWith("/healthz")) {
        return Response.json({ success: true, data: { status: "healthy" } });
      }
      if (
        url.endsWith("/v1/dictate/cleanup")
        || url.endsWith("/v1/notes/generate")
        || url.endsWith("/v1/chat/completions")
      ) {
        return Response.json({ error_code: 3001 }, { status: 401 });
      }
      return new Response("OK", { status: 200 });
    },
  });

  const portal = result.checks.find((check) => check.id === "chat-portal");
  assert.deepEqual(portal, {
    id: "chat-portal",
    label: "June Chat portal",
    state: "healthy",
    latencyMs: portal.latencyMs,
    statusCode: 200,
    detail: "Public portal is reachable",
  });
});
