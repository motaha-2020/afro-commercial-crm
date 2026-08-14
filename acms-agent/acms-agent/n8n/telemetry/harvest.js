/**
 * Extract one telemetry record per execution from n8n's own store.
 *
 * Runs inside the n8n container, prints JSON lines to stdout. Nothing is added
 * to the workflow: n8n already records prompt/completion tokens, timings and
 * every tool call, and a harvester sees the failed runs too — an in-workflow
 * emitter only fires when the run reaches it, which is exactly the case you
 * most want measured.
 *
 *   node harvest.js <sinceExecutionId>
 */
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const WF = 'acmsOrch01';
const since = Number(process.argv[2] || 0);

for (const s of ['', '-wal', '-shm']) {
  try { fs.copyFileSync('/home/node/.n8n/database.sqlite' + s, '/tmp/dbHarvest.sqlite' + s); } catch (e) {}
}
const db = new DatabaseSync('/tmp/dbHarvest.sqlite');

// n8n flattens an execution into an array where any value may be a numeric
// string pointing at another slot. Reading a field back means walking that.
function deref(arr, node, seen) {
  seen = seen || new Set();
  if (typeof node === 'string') {
    if (/^\d+$/.test(node) && Number(node) < arr.length) {
      if (seen.has(node)) return null;
      seen.add(node);
      return deref(arr, arr[Number(node)], seen);
    }
    return node;
  }
  if (Array.isArray(node)) return node.map((v) => deref(arr, v, new Set(seen)));
  if (node && typeof node === 'object') {
    const o = {};
    for (const k of Object.keys(node)) o[k] = deref(arr, node[k], new Set(seen));
    return o;
  }
  return node;
}

const AGENTS = ['sales_intelligence', 'financial_intelligence', 'executive_reporting',
  'compliance_and_approval', 'action_agent', 'report_agent'];

function classifyError(data) {
  // Match the provider's wording, never a bare status number. The first version
  // tested for /413/ and matched any figure containing those digits — a token
  // count, a duration, an id — and reported 190 oversized-context failures in a
  // history that had far fewer. Measurement code gets the same scrutiny as the
  // thing it measures.
  if (/Request too large/.test(data)) return 'context_too_large';
  if (/tokens per day \(TPD\)/.test(data)) return 'quota_daily';
  if (/Rate limit reached/.test(data)) return 'quota_minute';
  if (/ECONNREFUSED|ETIMEDOUT|socket hang up/.test(data)) return 'network';
  if (/Tool call validation failed/.test(data)) return 'tool_schema';
  return null;
}

const rows = db.prepare(
  'SELECT e.id, e.status, e.startedAt, e.stoppedAt, d.data ' +
  'FROM execution_entity e JOIN execution_data d ON d.executionId = e.id ' +
  'WHERE e.workflowId = ? AND e.id > ? ORDER BY e.id').all(WF, since);

for (const r of rows) {
  let arr;
  try { arr = JSON.parse(r.data); } catch (e) { continue; }

  // Token counts: every model call records its own, so they are summed.
  //
  // The key differs by provider and this is not cosmetic. The Groq node reports
  // 'tokenUsage' — counts returned by the API. The OpenAI node reports
  // 'tokenUsageEstimate' — counts n8n computed itself, because the response was
  // streamed and carried no usage block. Matching only the first name is what
  // made every OpenAI run read as zero tokens and zero model calls after the
  // provider switch. Both are collected, and 'estimated' is carried on the
  // record so a cost figure derived from these is never presented as measured.
  let prompt = 0, completion = 0, total = 0, calls = 0, estimated = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    for (const key of ['tokenUsage', 'tokenUsageEstimate']) {
      if (!(key in v)) continue;
      const u = deref(arr, v[key]);
      if (u && typeof u === 'object') {
        prompt += Number(u.promptTokens || 0);
        completion += Number(u.completionTokens || 0);
        total += Number(u.totalTokens || 0);
        calls += 1;
        if (key === 'tokenUsageEstimate') estimated += 1;
      }
    }
  }

  const dispatches = {};
  for (const a of AGENTS) {
    const n = (r.data.match(new RegExp('Calling ' + a + ' with input', 'g')) || []).length;
    if (n) dispatches[a] = n;
  }

  // Which data path the reads went through — the projection layer or ACMS direct.
  const qCalls = (r.data.match(/:3025\/q\//g) || []).length;
  const acmsCalls = (r.data.match(/:4010\/api\//g) || []).length;

  let sessionId = null, intent = null, route = null, specModel = null;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!sessionId && 'sessionId' in v) {
        const s = deref(arr, v.sessionId);
        if (typeof s === 'string') sessionId = s;
      }
      if (!route && 'route' in v && 'intent' in v) {
        route = deref(arr, v.route);
        const it = deref(arr, v.intent);
        intent = it && typeof it === 'object' ? it.intent : null;
      }
      // Which model the specialists ran on this turn. n8n stores the token
      // usage without the model name beside it — only node names survive — so
      // the gate's own decision is the only place the model is recoverable
      // after the fact. Since the router landed, a single price pair no longer
      // describes a run: two models with different prices are in play, and
      // without this field the split cannot be reconstructed later.
      if (!specModel && 'specModel' in v) {
        const m = deref(arr, v.specModel);
        if (typeof m === 'string') specModel = m;
      }
    }
    if (sessionId && route && specModel) break;
  }

  const ms = new Date(r.stoppedAt) - new Date(r.startedAt);
  console.log(JSON.stringify({
    exec: r.id,
    at: r.startedAt,
    ms: Number.isFinite(ms) ? ms : null,
    status: r.status,
    session: sessionId,
    intent,
    route,
    specModel,
    modelCalls: calls,
    estimatedCalls: estimated,
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total,
    dispatches,
    dispatchCount: Object.values(dispatches).reduce((a, b) => a + b, 0),
    qReads: qCalls,
    acmsReads: acmsCalls,
    limited: /Rate limit reached|Request too large/.test(r.data),
    errorClass: classifyError(r.data),
    bytes: r.data.length,
  }));
}
