import assert from "node:assert/strict";
const mod = await import("./main.js");
const { lint } = mod; const app = mod.default;

const good = { x402Version: 1, error: "x", accepts: [{ scheme: "exact", network: "base", maxAmountRequired: "10000", resource: "https://a.example/x", description: "d", mimeType: "application/json", payTo: "0xc9dAFF1b2C1b8000B77f2c8a883D932bEE27eF40", maxTimeoutSeconds: 60, asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", extra: { name: "USD Coin", version: "2" } }] };
const bad = { x402Version: 1, accepts: [{ scheme: "exact", network: "eip155:8453", amount: "0.01", payTo: "0x123", maxTimeoutSeconds: 60, asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", extra: { name: "USDC", version: "2" } }] };
const v2hdr = { x402Version: 2, resource: { url: "https://a.example/x" }, accepts: [{ scheme: "exact", network: "eip155:8453", amount: "5000", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: "0xc9dAFF1b2C1b8000B77f2c8a883D932bEE27eF40", maxTimeoutSeconds: 60, extra: { name: "USD Coin", version: "2" } }] };

let mock;
globalThis.fetch = async (u, opts) => mock(String(u), opts);

mock = async () => new Response(JSON.stringify(good), { status: 402, headers: { "payment-required": btoa(JSON.stringify(v2hdr)) } });
let r = await lint("https://a.example/x");
assert.equal(r.ok, true, JSON.stringify(r.errors)); assert.equal(r.payloads.length, 2); assert.equal(r.payloads[1].accepts[0].usd, 0.01);
console.log("good:", r.ok, r.warnings);

mock = async () => new Response(JSON.stringify(bad), { status: 402 });
r = await lint("https://a.example/x");
assert.equal(r.ok, false); console.log("bad errors:\n " + r.errors.join("\n "));
assert.ok(r.errors.some((e) => e.includes("CAIP-2"))); assert.ok(r.errors.some((e) => e.includes('"amount"'))); assert.ok(r.errors.some((e) => e.includes("USD Coin"))); assert.ok(r.errors.some((e) => e.includes("payTo")));

r = await lint("http://a.example/x"); assert.equal(r.ok, false);
r = await lint("https://127.0.0.1/x"); assert.ok(r.errors[0].includes("private"));
r = await lint("https://localhost/x"); assert.ok(r.errors[0].includes("private"));

// paywall
let res = await app.fetch(new Request("https://lint.example/lint?url=https://a.example/x"));
assert.equal(res.status, 402);
const pw = await res.json(); assert.equal(pw.accepts[0].payTo, "0xc9dAFF1b2C1b8000B77f2c8a883D932bEE27eF40"); assert.equal(pw.accepts[0].maxAmountRequired, "5000");
const hdr = JSON.parse(atob(res.headers.get("payment-required"))); assert.equal(hdr.x402Version, 2); assert.equal(hdr.accepts[0].network, "eip155:8453");
// lint our own paywall with the linter
mock = async () => app.fetch(new Request("https://lint.example/lint"));
r = await lint("https://lint.example/lint"); assert.equal(r.ok, true, JSON.stringify(r.errors)); console.log("self-lint ok, warnings:", r.warnings);

// paid path: verify ok, settle ok
const calls = [];
mock = async (u, opts) => {
  if (u.startsWith("https://facilitator.payai.network")) { calls.push([u, JSON.parse(opts.body)]); return new Response(JSON.stringify(u.endsWith("/verify") ? { isValid: true, payer: "0xabc" } : { success: true, transaction: "0xtx", network: "base", payer: "0xabc" })); }
  return new Response(JSON.stringify(good), { status: 402 });
};
res = await app.fetch(new Request("https://lint.example/lint?url=https://a.example/x", { headers: { "x-payment": btoa(JSON.stringify({ x402Version: 1, scheme: "exact", network: "base", payload: {} })) } }));
assert.equal(res.status, 200); assert.ok(res.headers.get("x-payment-response"));
assert.equal(calls.length, 2); assert.equal(calls[0][1].paymentRequirements.payTo, "0xc9dAFF1b2C1b8000B77f2c8a883D932bEE27eF40");
// invalid payment -> 402, no settle
calls.length = 0;
mock = async (u) => { calls.push(u); return new Response(JSON.stringify({ isValid: false, invalidReason: "insufficient_funds" })); };
res = await app.fetch(new Request("https://lint.example/lint?url=https://a.example/x", { headers: { "payment-signature": btoa("{}") } }));
assert.equal(res.status, 402); assert.equal(calls.length, 1);
console.log("info:", (await (await app.fetch(new Request("https://lint.example/"))).json()).price);
console.log("ALL TESTS PASS");
