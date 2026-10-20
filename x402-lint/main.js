// x402-lint: a paid x402 API that checks another x402 endpoint's 402 response for the
// mistakes that make buyer bots bounce. Built and run by James, an AI agent operated by
// Yoad Reiter (GitHub @yoadreiter-commits). Runs on Deno Deploy or Cloudflare Workers.

const PAY_TO = "0xc9dAFF1b2C1b8000B77f2c8a883D932bEE27eF40"; // Yoad's Base USDC (SETUP.md S0)
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PRICE_ATOMIC = "5000"; // 0.005 USDC (6 decimals)
const FACILITATOR = "https://facilitator.payai.network";
const DESCRIPTION =
  "Lint any x402 endpoint: fetches its 402 and reports spec errors (amount units, extra.name/version, " +
  "v1/v2 field mixing, network ids, addresses) that make paying clients fail. Made by an AI agent.";

// Known USDC deployments: EIP-712 domain name and version the exact scheme must advertise.
const KNOWN_USDC = {
  "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { name: "USD Coin", version: "2" },
  "84532:0x036cbd53842c5426634e7929541ec2318f3dcf7e": { name: "USDC", version: "2" },
};
const V1_NETWORKS = {
  base: 8453, "base-sepolia": 84532, avalanche: 43114, "avalanche-fuji": 43113, polygon: 137,
  "polygon-amoy": 80002, arbitrum: 42161, "arbitrum-sepolia": 421614, sei: 1329, xlayer: 196,
  ethereum: 1, optimism: 10,
};

const inputSchema = {
  type: "http",
  method: "GET",
  queryParams: { url: { type: "string", description: "https URL of the x402 endpoint to check", required: true } },
  discoverable: true,
};
const outputSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" }, status: { type: "number" }, x402Version: { type: "number" },
    errors: { type: "array" }, warnings: { type: "array" }, accepts: { type: "array" },
  },
};

function requirementsV1(resource) {
  return {
    scheme: "exact", network: "base", maxAmountRequired: PRICE_ATOMIC, resource, description: DESCRIPTION,
    mimeType: "application/json", payTo: PAY_TO, maxTimeoutSeconds: 120, asset: USDC_BASE,
    outputSchema: { input: inputSchema, output: outputSchema }, extra: { name: "USD Coin", version: "2" },
  };
}
function requirementsV2() {
  return {
    scheme: "exact", network: "eip155:8453", amount: PRICE_ATOMIC, asset: USDC_BASE, payTo: PAY_TO,
    maxTimeoutSeconds: 120, extra: { name: "USD Coin", version: "2" },
  };
}
function paymentRequiredV2(resource, error) {
  return {
    x402Version: 2, error, resource: { url: resource, description: DESCRIPTION, mimeType: "application/json", serviceName: "x402-lint" },
    accepts: [requirementsV2()],
    extensions: { bazaar: { info: { input: inputSchema, output: outputSchema }, schema: { input: inputSchema, output: outputSchema } } },
  };
}

const b64encode = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
const b64decode = (s) => JSON.parse(decodeURIComponent(escape(atob(s))));
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json", ...headers } });

function paywall(resource, error) {
  const v2 = paymentRequiredV2(resource, error);
  return json({ x402Version: 1, error, accepts: [requirementsV1(resource)] }, 402, {
    "PAYMENT-REQUIRED": b64encode(v2),
  });
}

async function facilitator(path, body) {
  const r = await fetch(FACILITATOR + path, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { error: `facilitator ${r.status}: ${text.slice(0, 200)}` }; }
}

// ---- linter ----

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const ATOMIC = /^[0-9]+$/;

function chainOf(network) {
  if (typeof network !== "string") return null;
  const m = network.match(/^eip155:(\d+)$/);
  if (m) return Number(m[1]);
  return V1_NETWORKS[network] ?? null;
}

function lintAccept(a, version, i, errors, warnings) {
  const at = `accepts[${i}]`;
  if (!a || typeof a !== "object") { errors.push(`${at} is not an object`); return null; }
  if (a.scheme !== "exact") warnings.push(`${at}.scheme is "${a.scheme}"; most clients only pay "exact"`);
  const net = a.network;
  if (version === 1 && /^eip155:/.test(net ?? "")) errors.push(`${at}.network "${net}" is a v2 CAIP-2 id inside a v1 response; v1 uses names like "base"`);
  if (version === 2 && net in V1_NETWORKS) errors.push(`${at}.network "${net}" is a v1 name inside a v2 response; v2 uses CAIP-2 like "eip155:8453"`);
  const chain = chainOf(net);
  if (chain === null && !/^solana/.test(net ?? "")) warnings.push(`${at}.network "${net}" is not a network this linter knows`);

  const amountKey = version === 1 ? "maxAmountRequired" : "amount";
  const wrongKey = version === 1 ? "amount" : "maxAmountRequired";
  const amount = a[amountKey];
  if (amount === undefined) {
    errors.push(`${at}.${amountKey} is missing` + (a[wrongKey] !== undefined ? ` (found "${wrongKey}", the v${3 - version} name)` : ""));
  } else if (typeof amount !== "string") {
    errors.push(`${at}.${amountKey} must be a string of atomic units, got ${typeof amount}`);
  } else if (!ATOMIC.test(amount)) {
    errors.push(`${at}.${amountKey} "${amount}" is not atomic units; for USDC 0.01 is "10000"`);
  } else if (amount === "0") {
    warnings.push(`${at}.${amountKey} is 0`);
  }

  if (!/^solana/.test(net ?? "")) {
    if (!ADDR.test(a.payTo ?? "")) errors.push(`${at}.payTo "${a.payTo}" is not a 0x address`);
    if (!ADDR.test(a.asset ?? "")) errors.push(`${at}.asset "${a.asset}" is not a 0x token address`);
  }
  if (typeof a.maxTimeoutSeconds !== "number") errors.push(`${at}.maxTimeoutSeconds must be a number`);
  else if (a.maxTimeoutSeconds < 30) warnings.push(`${at}.maxTimeoutSeconds ${a.maxTimeoutSeconds} is short; slow facilitators may time out`);

  if (version === 1) {
    for (const k of ["resource", "description", "mimeType"]) if (typeof a[k] !== "string") errors.push(`${at}.${k} is required in v1`);
  }
  const known = KNOWN_USDC[`${chain}:${String(a.asset).toLowerCase()}`];
  if (a.scheme === "exact" && chain !== null) {
    const ex = a.extra ?? {};
    if (known) {
      if (ex.name !== known.name) errors.push(`${at}.extra.name is ${JSON.stringify(ex.name)}; this USDC signs with "${known.name}", so every signature will fail`);
      if (ex.version !== known.version) errors.push(`${at}.extra.version is ${JSON.stringify(ex.version)}; expected "${known.version}"`);
    } else if (!ex.name || !ex.version) {
      errors.push(`${at}.extra.name and extra.version (the token's EIP-712 domain) are required for exact on EVM`);
    }
  }
  const usd = known && ATOMIC.test(amount ?? "") ? Number(amount) / 1e6 : null;
  return { scheme: a.scheme, network: net, amount, usd, asset: a.asset, payTo: a.payTo };
}

function blockedHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (/^(10|127|0)\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h.includes(":")) return true; // no IPv6 literals
  return false;
}

export async function lint(target) {
  const errors = [], warnings = [];
  let u;
  try { u = new URL(target); } catch { return { ok: false, errors: ["url is not a valid URL"], warnings }; }
  if (u.protocol !== "https:") return { ok: false, errors: ["only https URLs are checked"], warnings };
  if (blockedHost(u.hostname)) return { ok: false, errors: ["private or local hosts are not checked"], warnings };

  let r, text;
  try {
    r = await fetch(u, { headers: { accept: "application/json", "user-agent": "x402-lint (AI agent James)" }, redirect: "follow", signal: AbortSignal.timeout(10000) });
    text = (await r.text()).slice(0, 200000);
  } catch (e) {
    return { ok: false, target: u.href, errors: [`fetch failed: ${e.message}`], warnings };
  }
  const out = { target: u.href, status: r.status };
  if (r.status !== 402) errors.push(`expected HTTP 402 for an unpaid GET, got ${r.status}` + (r.status === 405 ? " (try the route's real method; this linter sends GET)" : ""));

  let body = null, header = null;
  try { body = JSON.parse(text); } catch { if (r.status === 402) warnings.push("402 body is not JSON"); }
  const h = r.headers.get("payment-required");
  if (h) {
    try { header = b64decode(h); } catch { errors.push("PAYMENT-REQUIRED header is not base64 JSON"); }
  }
  const docs = [];
  if (header) docs.push(["PAYMENT-REQUIRED header", header]);
  if (body && (body.accepts || body.x402Version)) docs.push(["body", body]);
  if (r.status === 402 && docs.length === 0) errors.push("402 carries no x402 payload (no accepts in body, no PAYMENT-REQUIRED header)");

  out.payloads = [];
  for (const [where, doc] of docs) {
    const e = [], w = [];
    const v = doc.x402Version;
    if (v !== 1 && v !== 2) e.push(`x402Version is ${JSON.stringify(v)}; must be 1 or 2`);
    const version = v === 2 ? 2 : 1;
    if (where.startsWith("PAYMENT-REQUIRED") && v === 1) w.push("PAYMENT-REQUIRED header carries a v1 payload; v1 clients read the body, v2 clients expect v2 here");
    if (version === 2 && (typeof doc.resource !== "object" || !doc.resource?.url)) e.push("v2 requires resource.url");
    if (!Array.isArray(doc.accepts) || doc.accepts.length === 0) e.push("accepts must be a non-empty array");
    const accepts = (Array.isArray(doc.accepts) ? doc.accepts : []).map((a, i) => lintAccept(a, version, i, e, w));
    out.payloads.push({ where, x402Version: v, accepts });
    errors.push(...e.map((x) => `${where}: ${x}`));
    warnings.push(...w.map((x) => `${where}: ${x}`));
  }
  if (docs.length === 1 && docs[0][1].x402Version === 2 && docs[0][0] === "body") warnings.push("v2 payload only in the body; v2 clients read the PAYMENT-REQUIRED header");
  return { ok: errors.length === 0, ...out, errors, warnings, checkedBy: "x402-lint by James (AI agent)" };
}

// ---- HTTP ----

async function handle(req) {
  const url = new URL(req.url);
  if (url.pathname === "/" || url.pathname === "/info") {
    return json({
      service: "x402-lint", operator: "James, an AI agent run by Yoad Reiter (github.com/yoadreiter-commits)",
      description: DESCRIPTION, price: "0.005 USDC on Base per check", call: `GET ${url.origin}/lint?url=<https x402 endpoint>`,
      payTo: PAY_TO, facilitator: FACILITATOR, source: "https://github.com/yoadreiter-commits/james-agent-work",
    });
  }
  if (url.pathname !== "/lint") return json({ error: "not found; see /" }, 404);

  const resource = url.origin + "/lint";
  const target = url.searchParams.get("url");
  const v1Header = req.headers.get("x-payment");
  const v2Header = req.headers.get("payment-signature");
  if (!v1Header && !v2Header) return paywall(resource, "payment required");
  if (!target) return json({ error: "add ?url=<https x402 endpoint>; you were not charged" }, 400);

  let payload;
  try { payload = b64decode(v2Header || v1Header); } catch { return paywall(resource, "payment header is not base64 JSON"); }
  const version = v2Header ? 2 : 1;
  const requirements = version === 2 ? requirementsV2() : requirementsV1(resource);
  const reqBody = { x402Version: version, paymentPayload: payload, paymentRequirements: requirements };

  const verified = await facilitator("/verify", reqBody);
  if (!verified.isValid) return paywall(resource, `payment invalid: ${verified.invalidReason || verified.error || "unknown"}`);

  const report = await lint(target);
  const settled = await facilitator("/settle", reqBody);
  if (!settled.success) return paywall(resource, `settlement failed: ${settled.errorReason || settled.error || "unknown"}`);
  const receipt = b64encode({ success: true, transaction: settled.transaction, network: settled.network, payer: settled.payer });
  return json(report, 200, version === 2 ? { "PAYMENT-RESPONSE": receipt } : { "X-PAYMENT-RESPONSE": receipt });
}

export default { fetch: handle };
