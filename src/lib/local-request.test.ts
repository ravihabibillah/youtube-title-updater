import assert from "node:assert/strict";
import test from "node:test";
import { isSameLocalOrigin } from "./local-request.ts";

test("accepts only configured local app origin", () => {
  const request = (origin: string | null) => ({ headers: new Headers(origin ? { origin } : {}) }) as Request;
  assert.equal(isSameLocalOrigin(request("http://127.0.0.1:8080")), true);
  assert.equal(isSameLocalOrigin(request("http://localhost:8080")), true);
  assert.equal(isSameLocalOrigin(request("http://localhost:3000")), false);
  assert.equal(isSameLocalOrigin(request("http://127.0.0.1.evil.example:8080")), false);
  assert.equal(isSameLocalOrigin(request("http://192.168.1.2:8080")), false);
  assert.equal(isSameLocalOrigin(request("https://attacker.example")), false);
  assert.equal(isSameLocalOrigin(request(null)), false);
});
