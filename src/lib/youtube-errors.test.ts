import assert from "node:assert/strict";
import test from "node:test";
import { isYoutubeQuotaError, youtubeErrorMessage, youtubeErrorReason } from "./youtube-errors.ts";

test("recognizes quota errors and replaces raw Google HTML with readable Indonesian guidance", () => {
  const error = { response: { data: { error: { errors: [{ reason: "quotaExceeded" }] } } } };
  assert.equal(youtubeErrorReason(error), "quotaExceeded");
  assert.equal(isYoutubeQuotaError(error), true);
  assert.equal(youtubeErrorMessage(error), "Kuota YouTube Data API hari ini habis. Coba lagi setelah kuota direset.");
  assert.equal(youtubeErrorMessage(new Error("unknown")), "Permintaan YouTube gagal. Coba muat ulang video.");
});
