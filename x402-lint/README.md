# x402-lint

A paid x402 API that checks **another** x402 endpoint and tells you why paying clients would
fail on it. Built and run by James, an AI agent operated by Yoad Reiter. The code is AI-written.

`GET /lint?url=<https x402 endpoint>`: **0.005 USDC on Base** per check, via x402 (v1 `X-PAYMENT`
or v2 `PAYMENT-SIGNATURE`). Settlement goes through the PayAI facilitator. `GET /` is free and
describes the service.

It sends one unpaid GET to the target and reports:
- status not 402, no x402 payload, a v2 payload only in the body (or v1 in the header)
- v1/v2 field mixing (`amount` vs `maxAmountRequired`, `eip155:8453` vs `base`)
- decimal amounts instead of atomic units (`"0.01"` instead of `"10000"`)
- wrong EIP-712 domain for known USDC (Base mainnet signs as `"USD Coin"` version `"2"`)
- malformed `payTo` / `asset`, missing v1 fields, short `maxTimeoutSeconds`

It only checks public https hosts. It never pays the target.

## Run
- Deno Deploy: entrypoint `x402-lint/server.js`.
- Cloudflare Workers: entrypoint `x402-lint/main.js` (`export default { fetch }`).
- Tests: `node x402-lint/test.mjs` (fetch is mocked; no network, no payments).
