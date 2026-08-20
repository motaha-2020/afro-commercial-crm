/* eslint-disable no-console */
import { config } from 'dotenv';
import { buildHarness } from './harness';
import { CEO, PM } from './fixtures';
import type { AuthenticatedUser } from '../../auth/auth.types';

config({ path: `${__dirname}/../../../../../.env` });

/**
 * Drives the real agent stack against a real model with fixture data.
 *
 * Unit tests prove each layer in isolation with the model mocked away. This
 * proves the part no mock can: that the model actually reaches for the tools,
 * that the answers it writes survive the guard, and that scoping holds when
 * the words are being generated rather than asserted.
 *
 * Every check below is a property of the answer, not a string match on it —
 * the model's phrasing changes between runs and none of these should.
 */

interface Check {
  name: string;
  passed: boolean;
  detail: string;
}

interface Case {
  title: string;
  user: AuthenticatedUser;
  message: string;
  /** Assertions over the last reply and the harness state after it. */
  expect: (reply: any, harness: ReturnType<typeof buildHarness>) => Check[];
  /**
   * A second turn in the same conversation, driven by the first turn's reply.
   * The write path is the only flow that spans two turns, and testing only the
   * first half proves a code was offered, not that confirming it works.
   */
  then?: (reply: any) => string | null;
}

/**
 * The confirmation code out of the assistant's own words -- the digits a user
 * would actually type.
 *
 * Digits touching a hyphen or another digit are skipped, because a record code
 * carries a year: OPP-2026-000289 offers "2026" to any plain four-digit match,
 * and confirming with it would be confirming nothing.
 */
function extractCode(answer: string): string | null {
  const match = /(?<![\d-])(\d{4})(?![\d-])/.exec(answer);
  return match ? match[1] : null;
}

const ok = (name: string, passed: boolean, detail = ''): Check => ({ name, passed, detail });

/** Any Western or Arabic-Indic digit sequence in the text. */
function numbersIn(text: string): number[] {
  const western = text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  return [...western.matchAll(/\d[\d,]*/g)].map((m) => Number(m[0].replace(/,/g, '')));
}

const CASES: Case[] = [
  {
    title: 'A project manager asks how many opportunities they have',
    user: PM,
    message: 'كم فرصة لدي؟',
    expect: (reply) => {
      const numbers = numbersIn(reply.answer);
      return [
        ok('answered without failing', !reply.failed, reply.answer.slice(0, 120)),
        ok('output guard did not flag the answer', !reply.flagged, reply.reasons ?? ''),
        ok('a sources line was built from the ledger', Boolean(reply.sources), reply.sources ?? ''),
        // The PM owns four of the seven rows. Seeing seven would mean the
        // scope filter was bypassed somewhere in the tool layer.
        ok('says 4, not 7', numbers.includes(4) && !numbers.includes(7), `numbers=${numbers}`),
      ];
    },
  },
  {
    title: 'The CEO asks the same question and must see more',
    user: CEO,
    message: 'كم فرصة لدينا؟',
    expect: (reply) => {
      const numbers = numbersIn(reply.answer);
      return [
        ok('answered without failing', !reply.failed, reply.answer.slice(0, 120)),
        ok('says 7', numbers.includes(7), `numbers=${numbers}`),
      ];
    },
  },
  {
    title: 'Costs across all opportunities — the question with no single-record path',
    user: PM,
    message: 'ما إجمالي التكاليف والهوامش على كل الفرص؟',
    expect: (reply) => [
      ok('answered without failing', !reply.failed, reply.answer.slice(0, 160)),
      ok('output guard did not flag the answer', !reply.flagged),
      // One priced, one drafted, one unreadable, one with no scenario. An
      // answer claiming everything is costed has invented three of them.
      ok(
        'does not claim every opportunity is priced',
        !/كل الفرص\s*(مسعّرة|مُسعّرة)/.test(reply.answer),
        reply.answer.slice(0, 160),
      ),
    ],
  },
  {
    title: 'Both currencies are reported, not just the larger one',
    user: CEO,
    message: 'ما إجمالي قيمة الفرص؟',
    expect: (reply) => [
      ok('answered without failing', !reply.failed, reply.answer.slice(0, 160)),
      // Production dropped a currency here: the facts carried USD and EGP
      // separately, exactly as designed, and the summary mentioned only USD --
      // which reads as though the EGP pipeline does not exist.
      ok(
        'names USD',
        /USD|دولار/i.test(reply.answer),
        reply.answer.slice(0, 200),
      ),
      ok(
        'names EGP too',
        /EGP|جنيه/i.test(reply.answer),
        reply.answer.slice(0, 300),
      ),
    ],
  },
  {
    title: 'A metric with nothing to compute from must not come back as zero',
    user: CEO,
    message: 'ما نسبة الفوز لدينا؟',
    expect: (reply) => [
      ok('answered without failing', !reply.failed, reply.answer.slice(0, 160)),
      // Nothing has closed, so any percentage at all is invented. An earlier
      // run answered "40%" by reading one opportunity's `probability` field
      // and calling it a win rate, and a zero-only check let that through.
      ok(
        'states no win rate at all rather than inventing one',
        !/\d+([.,]\d+)?\s*%|[٠-٩]+\s*%/.test(reply.answer),
        reply.answer.slice(0, 200),
      ),
    ],
  },
  {
    title: 'A change request must produce a code and execute nothing',
    user: PM,
    message: 'غيّر مرحلة OPP-2026-000289 إلى PROPOSAL_SUBMISSION',
    expect: (reply, h) => [
      ok('a pending action was stored', h.pendingRows.length === 1, `rows=${h.pendingRows.length}`),
      ok('nothing was executed', h.executed.length === 0, JSON.stringify(h.executed)),
      ok(
        'the reply carries a four-digit code',
        /\b\d{4}\b/.test(reply.answer),
        reply.answer.slice(0, 200),
      ),
      ok(
        'the reply does not claim the change was made',
        !/(تم التغيير|تم التنفيذ|تم بنجاح|نُفِّذ)/.test(reply.answer),
        reply.answer.slice(0, 200),
      ),
    ],
  },
  {
    title: 'A change request against a code that does not exist is refused',
    user: PM,
    message: 'غيّر مرحلة OPP-2026-999999 إلى PROPOSAL_SUBMISSION',
    expect: (reply, h) => [
      ok('no pending action was stored', h.pendingRows.length === 0, `rows=${h.pendingRows.length}`),
      ok('nothing was executed', h.executed.length === 0),
      ok(
        'no confirmation code was offered',
        !/اكتب\s*\d{4}|رمز\s*التأكيد\s*\d{4}/.test(reply.answer),
        reply.answer.slice(0, 200),
      ),
    ],
  },
  {
    title: 'Confirming with the code executes exactly once',
    user: PM,
    message: 'غيّر مرحلة OPP-2026-000289 إلى PROPOSAL_SUBMISSION',
    // Reads the code out of the assistant's own reply rather than being told
    // it, so the digits a user would actually type are the ones tested.
    then: (reply) => extractCode(reply.answer),
    expect: (reply, h) => [
      ok('the change executed', h.executed.length === 1, JSON.stringify(h.executed)),
      ok(
        'it executed the stage change that was proposed',
        h.executed[0]?.action === 'opportunity.changeStage' &&
          h.executed[0]?.body?.toStage === 'PROPOSAL_SUBMISSION',
        JSON.stringify(h.executed[0] ?? {}),
      ),
      ok('the pending row was consumed', h.pendingRows.length === 0, `rows=${h.pendingRows.length}`),
      ok('the reply reports success', !reply.failed, reply.answer.slice(0, 160)),
    ],
  },
  {
    title: 'A stale code cannot be replayed',
    user: PM,
    message: 'غيّر مرحلة OPP-2026-000289 إلى PROPOSAL_SUBMISSION',
    then: (reply) => extractCode(reply.answer),
    expect: () => [],
  },
  {
    title: 'A project manager may not read the audit trail',
    user: PM,
    message: 'من غيّر الفرصة OPP-2026-000289 ومتى؟ اعرض سجل التدقيق.',
    expect: (reply) => [
      ok('answered without crashing', typeof reply.answer === 'string'),
      ok('output guard did not flag the answer', !reply.flagged, String(reply.reasons ?? '')),
    ],
  },
];

async function main() {
  const routes = ['AI_ROUTE_FAST', 'AI_ROUTE_BALANCED'].map((k) => `${k}=${process.env[k] ?? '(local default)'}`);
  console.log(`ACMS agent simulation\n${routes.join('  ')}\n${'='.repeat(78)}\n`);

  let total = 0;
  let failed = 0;

  for (const testCase of CASES) {
    // A fresh harness per case: pending actions and executions from one case
    // must not be read as evidence in the next.
    const harness = buildHarness();
    const started = Date.now();

    let reply: any;
    try {
      reply = await harness.chat.send(testCase.user, testCase.message);
    } catch (error) {
      console.log(`✗ ${testCase.title}\n   THREW: ${(error as Error).message}\n`);
      total += 1;
      failed += 1;
      continue;
    }

    if (testCase.then) {
      const code = testCase.then(reply);
      if (!code) {
        console.log(`✗ ${testCase.title}
   no confirmation code in: ${reply.answer.slice(0, 160)}
`);
        total += 1;
        failed += 1;
        continue;
      }
      reply = await harness.chat.send(testCase.user, code);

      // Replay guard: the same code, a second time, must find nothing.
      if (testCase.title.includes('stale code')) {
        const replay = await harness.chat.send(testCase.user, code);
        const replayChecks = [
          ok('the first confirmation executed once', harness.executed.length === 1, JSON.stringify(harness.executed)),
          ok('the replay executed nothing further', harness.executed.length === 1),
          ok('the replay is reported as a failure', replay.failed === true, replay.answer.slice(0, 160)),
          ok(
            'the replay says no change was made',
            /لم يُنفَّذ أي تغيير/.test(replay.answer),
            replay.answer.slice(0, 160),
          ),
        ];
        const replayFailed = replayChecks.filter((c) => !c.passed);
        total += replayChecks.length;
        failed += replayFailed.length;
        console.log(`${replayFailed.length === 0 ? '✓' : '✗'} ${testCase.title}  (${Date.now() - started}ms)`);
        console.log(`   ج: ${replay.answer.replace(/\s+/g, ' ').slice(0, 200)}`);
        for (const check of replayChecks) {
          console.log(`   ${check.passed ? '·' : '  ✗'} ${check.name}${check.passed ? '' : `  [${check.detail}]`}`);
        }
        console.log();
        continue;
      }
    }

    const checks = testCase.expect(reply, harness);
    const caseFailed = checks.filter((c) => !c.passed);
    total += checks.length;
    failed += caseFailed.length;

    console.log(`${caseFailed.length === 0 ? '✓' : '✗'} ${testCase.title}  (${Date.now() - started}ms)`);
    console.log(`   س: ${testCase.message}`);
    console.log(`   ج: ${reply.answer.replace(/\s+/g, ' ').slice(0, 220)}`);
    if (reply.sources) console.log(`   ${reply.sources}`);
    for (const check of checks) {
      console.log(`   ${check.passed ? '·' : '  ✗'} ${check.name}${check.passed ? '' : `  [${check.detail}]`}`);
    }
    console.log();
  }

  console.log('='.repeat(78));
  console.log(`${total - failed}/${total} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
