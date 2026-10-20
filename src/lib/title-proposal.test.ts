import assert from "node:assert/strict";
import test from "node:test";
import { makeTitleProposal, validateTitle } from "./title-proposal.ts";

test("uses first non-empty description line", () => {
  assert.equal(makeTitleProposal("\n  First line  \nSecond line"), "First line");
});

test("empty description yields no proposal", () => {
  assert.equal(makeTitleProposal(" \n\t"), null);
});

test("does not silently truncate titles over YouTube limit", () => {
  assert.equal(makeTitleProposal("x".repeat(101)), "x".repeat(101));
  assert.equal(validateTitle("x".repeat(101)), "Title exceeds YouTube's 100-character limit");
});

test("counts Unicode code points for YouTube title limit", () => {
  assert.equal(validateTitle("🤔".repeat(100)), null);
  assert.notEqual(validateTitle("🤔".repeat(101)), null);
});

test("preserves unicode, punctuation and emoji", () => {
  assert.equal(makeTitleProposal("Kenapa ikan? 🤔 #shorts"), "Kenapa ikan? 🤔 #shorts");
});

test("normalizes CRLF and keeps original notebook first-line behavior", () => {
  assert.equal(makeTitleProposal("\r\nPertama. Kedua.\r\nDeskripsi"), "Pertama. Kedua.");
});
