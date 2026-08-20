import { AiChatService } from './ai-chat.service';
import { IntentGateService } from '../gate/intent-gate.service';
import { EvidenceLedger } from '../evidence/evidence-ledger';
import type { AuthenticatedUser } from '../../auth/auth.types';

const user: AuthenticatedUser = {
  id: 'user-1',
  email: 'pm@afro.test',
  orgUnitId: 'unit-1',
  roles: [{ role: 'PROJECT_MANAGER' as never, scope: 'OWN' as never }],
};

function build(overrides: {
  answer?: string;
  failed?: boolean;
  deliver?: string[];
  claim?: { ok: boolean; message: string };
}) {
  const memory = {
    startOrGetConversation: jest.fn().mockResolvedValue({ id: 'conv-1' }),
    appendUserMessage: jest.fn().mockResolvedValue(undefined),
    appendAssistantMessage: jest.fn().mockResolvedValue(undefined),
  };

  const orchestrator = {
    handle: jest.fn(async (_q: string, _i: string, ctx: { ledger: EvidenceLedger }) => {
      const codes = overrides.deliver ?? [];
      if (codes.length > 0) {
        ctx.ledger.record({
          tool: 'list_opportunities',
          resource: 'الفرص',
          returned: codes.length,
          total: codes.length + 28,
          truncated: true,
          codes,
        });
      }
      return { answer: overrides.answer ?? 'ok', failed: overrides.failed ?? false };
    }),
  };

  const executor = { execute: jest.fn().mockResolvedValue(undefined) };

  const pending = {
    claim: jest.fn().mockResolvedValue(
      overrides.claim ?? { ok: false, message: 'لا يوجد إجراء معلّق — لم يُنفَّذ أي تغيير.' },
    ),
  };

  const service = new AiChatService(
    new IntentGateService(),
    orchestrator as never,
    pending as never,
    executor as never,
    memory as never,
  );

  return { service, memory, orchestrator, pending, executor };
}

describe('AiChatService', () => {
  it('handles a four-digit confirmation without consulting any agent', async () => {
    const { service, orchestrator, pending } = build({
      claim: { ok: true, message: 'تم تنفيذ changeStage على OPP-2026-000289.' },
    });

    const reply = await service.send(user, '4821');

    expect(pending.claim).toHaveBeenCalledWith(user, '4821', expect.any(Function));
    expect(orchestrator.handle).not.toHaveBeenCalled();
    expect(reply.failed).toBe(false);
  });

  it('never stores a confirmation turn in memory', async () => {
    const { service, memory } = build({ claim: { ok: true, message: 'تم.' } });

    await service.send(user, '4821');

    expect(memory.appendUserMessage).not.toHaveBeenCalled();
    expect(memory.appendAssistantMessage).not.toHaveBeenCalled();
  });

  it('builds the sources line from the ledger, including what was withheld', async () => {
    const { service } = build({
      answer: 'لديك فرص في مرحلة Bid منها OPP-2026-000289.',
      deliver: ['OPP-2026-000289', 'OPP-2026-000290'],
    });

    const reply = await service.send(user, 'كم فرصة لدي؟');

    expect(reply.sources).toBe('المصادر — الفرص: 2 من 30');
    expect(reply.flagged).toBe(false);
  });

  it('flags and does not store an answer citing a code no tool delivered', async () => {
    const { service, memory } = build({
      answer: 'الحساب ACC-000114 هو المرتبط بها.',
      deliver: ['OPP-2026-000289'],
    });

    const reply = await service.send(user, 'ما الحساب المرتبط؟');

    expect(reply.flagged).toBe(true);
    expect(reply.answer).toContain('لم تُسلَّم من أي أداة');
    expect(memory.appendAssistantMessage).not.toHaveBeenCalled();
  });

  it('does not store a failed turn — a stale error outlives its cause', async () => {
    const { service, memory } = build({ answer: 'تعذّر إكمال الطلب.', failed: true });

    const reply = await service.send(user, 'كم فرصة لدي؟');

    expect(reply.failed).toBe(true);
    expect(memory.appendAssistantMessage).not.toHaveBeenCalled();
  });

  it('stores a clean, evidence-backed turn', async () => {
    const { service, memory } = build({
      answer: 'لديك فرصتان: OPP-2026-000289 و OPP-2026-000290.',
      deliver: ['OPP-2026-000289', 'OPP-2026-000290'],
    });

    await service.send(user, 'كم فرصة لدي؟');

    expect(memory.appendUserMessage).toHaveBeenCalledWith('conv-1', 'كم فرصة لدي؟');
    expect(memory.appendAssistantMessage).toHaveBeenCalled();
  });
});
