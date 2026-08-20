/**
 * The report API the example worker talks to in tests — a real auxiliary
 * workerd worker (see vitest.config.ts: it is the example worker's outbound
 * service, so every `fetch(env.REPORT_API_URL + ...)` lands here over real
 * HTTP; no fetch mocking anywhere).
 *
 * Plain JS: the pool does not bundle auxiliary workers.
 *
 * Surface:
 * - GET  /data?to=<recipient>  -> the report payload (counted per recipient)
 * - POST /send {to, report}    -> 200 {delivered:true}; recipients named
 *      `flaky-<n>-...` get a 500 for their first n send attempts
 * - GET  /__counts?to=<recipient> -> {"data": n, "send": n}  (test observability)
 *
 * One instance serves the whole test run, so tests key everything on unique
 * recipients instead of resetting state.
 */

/** @type {Map<string, { data: number, send: number }>} */
const counts = new Map();

/** @param {string} to */
function countsFor(to) {
  const existing = counts.get(to);
  if (existing !== undefined) {
    return existing;
  }
  const created = { data: 0, send: 0 };
  counts.set(to, created);
  return created;
}

/**
 * @param {unknown} body
 * @param {number} [status]
 */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  /** @param {Request} request */
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/data") {
      const to = url.searchParams.get("to") ?? "";
      countsFor(to).data += 1;
      return json({ title: "Weekly metrics", rows: ["signups: 42", "churn: 1"] });
    }

    if (request.method === "POST" && url.pathname === "/send") {
      const body = await request.json();
      const to =
        typeof body === "object" && body !== null && typeof body.to === "string" ? body.to : "";
      const entry = countsFor(to);
      entry.send += 1;
      const flaky = /^flaky-(\d+)-/.exec(to);
      const failures = flaky === null ? 0 : Number(flaky[1]);
      if (entry.send <= failures) {
        return json({ error: "report gateway unavailable" }, 500);
      }
      return json({ delivered: true });
    }

    if (request.method === "GET" && url.pathname === "/__counts") {
      const to = url.searchParams.get("to") ?? "";
      return json(countsFor(to));
    }

    return json({ error: `unexpected egress: ${request.method} ${url.pathname}` }, 404);
  },
};
