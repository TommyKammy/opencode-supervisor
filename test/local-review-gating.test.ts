import assert from "node:assert/strict";
import test from "node:test";
import { localReviewBlocksReady } from "../src/core/supervisor";

test("localReviewBlocksReady blocks when recommendation is not ready on current head", () => {
  const blocked = localReviewBlocksReady(
    {
      local_review_head_sha: "abc123",
      local_review_findings_count: 0,
      local_review_recommendation: "changes_requested",
    },
    {
      headRefOid: "abc123",
    },
  );

  assert.equal(blocked, true);
});

test("localReviewBlocksReady does not block when recommendation is ready with zero findings", () => {
  const blocked = localReviewBlocksReady(
    {
      local_review_head_sha: "abc123",
      local_review_findings_count: 0,
      local_review_recommendation: "ready",
    },
    {
      headRefOid: "abc123",
    },
  );

  assert.equal(blocked, false);
});

test("localReviewBlocksReady does not block on verified severity alone when current findings are zero", () => {
  const blocked = localReviewBlocksReady(
    {
      local_review_head_sha: "abc123",
      local_review_findings_count: 0,
      local_review_recommendation: "ready",
      local_review_verified_max_severity: "high",
    },
    {
      headRefOid: "abc123",
    },
  );

  assert.equal(blocked, false);
});
