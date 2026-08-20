import { Injectable } from '@nestjs/common';
import { OpportunitiesService } from '../../opportunities/opportunities.service';
import { PendingActionService } from '../pending/pending-action.service';
import { ACTIONS, ActionExecutorService, isActionKey } from './action-executor.service';
import type { AgentTool, SpecialistAgent, ToolContext } from './agent.types';
import type { AuthenticatedUser } from '../../auth/auth.types';

@Injectable()
export class ActionAgent implements SpecialistAgent {
  readonly key = 'action_agent';
  readonly description =
    'أي طلب تغيير، وكل بتّ في موافقة أو خصم. يقترح ولا ينفّذ.';

  readonly systemPrompt =
    'أنت وكيل "الإجراءات" في منظومة أفرو التجارية. مهمتك أن تبني اقتراح تغيير — ' +
    'وأنت لا تنفّذ شيئًا إطلاقًا.\n' +
    'استدعِ propose_change بالإجراء وكود السجل والحقول المطلوبة. الخادم هو من ' +
    'يتحقق ويصدر رمز التأكيد.\n' +
    'ممنوع أن تقول إن التغيير تمّ أو نُفِّذ أو أنه "قيد التنفيذ" — لم يحدث شيء ' +
    'حتى يكتب المستخدم الرمز.\n' +
    'ولو رجعت الأداة حقل error فالاقتراح لم يُنشأ أصلًا: قل ذلك صراحةً وأضف أنه ' +
    'لم يُنفَّذ أي تغيير، ولا تخترع كودًا بديلًا ولا تعيد المحاولة بكود من عندك.';

  constructor(
    private readonly pending: PendingActionService,
    private readonly executor: ActionExecutorService,
    private readonly opportunities: OpportunitiesService,
  ) {}

  tools(): AgentTool[] {
    return [this.propose()];
  }

  private propose(): AgentTool {
    return {
      definition: {
        name: 'propose_change',
        description:
          'يبني اقتراح تغيير ويعيد رمز تأكيد من أربعة أرقام. لا ينفّذ التغيير. ' +
          'الإجراءات المتاحة: ' +
          Object.entries(ACTIONS)
            .map(([key, meta]) => `${key} (${meta.label})`)
            .join('، '),
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: Object.keys(ACTIONS),
              description: 'الإجراء المطلوب.',
            },
            targetCode: {
              type: 'string',
              description: 'كود السجل المستهدف، مثل OPP-2026-000289.',
            },
            claimedName: {
              type: 'string',
              description:
                'اسم الحساب أو الفرصة كما ذكره المستخدم، إن ذكره. يُتحقق من مطابقته للكود.',
            },
            body: {
              type: 'object',
              description: 'حقول التغيير، مثل { "toStage": "BID_STRATEGY_SOLUTION" }.',
            },
          },
          required: ['action', 'targetCode', 'body'],
        },
      },
      run: async (args, ctx) => {
        const action = args.action;
        if (!isActionKey(action)) {
          return {
            error:
              `"${String(action)}" ليس إجراءً متاحًا. المتاح: ${Object.keys(ACTIONS).join('، ')}`,
          };
        }

        const meta = ACTIONS[action];
        const rawBody = (args.body ?? {}) as Record<string, unknown>;

        let body: Record<string, unknown>;
        try {
          // Validated before a code exists. A body that only fails on
          // execution would already have been confirmed by a person, and a
          // confirmation of something that cannot run is not a confirmation.
          body = this.executor.validate(action, rawBody);
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }

        try {
          const proposal = await this.pending.propose(
            ctx.user,
            {
              conversationId: ctx.conversationId,
              action,
              resource: meta.resource,
              targetCode: String(args.targetCode ?? ''),
              claimedName: args.claimedName ? String(args.claimedName) : undefined,
              body: body as Record<string, string | number | boolean>,
            },
            (user, resource, code) => this.resolveCode(user, resource, code),
          );

          ctx.ledger.record({
            tool: 'propose_change',
            resource: `اقتراح على ${proposal.targetCode}`,
            returned: 1,
            total: 1,
            truncated: false,
            codes: [proposal.targetCode],
          });

          return {
            proposed: true,
            executed: false,
            action: meta.label,
            targetCode: proposal.targetCode,
            // Field by field, labelled: approving a sentence is not approving
            // the request. A summary that reads correctly has hidden a wrong
            // field before.
            changes: Object.entries(proposal.body).map(([key, value]) => ({
              field: (meta.fields as Record<string, string>)[key] ?? key,
              value,
            })),
            confirmationCode: proposal.code,
            expiresAt: proposal.expiresAt,
            instruction: `اعرض الحقول أعلاه حقلًا حقلًا، ثم اطلب من المستخدم كتابة ${proposal.code} للتأكيد. لم يُنفَّذ أي تغيير بعد.`,
          };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      },
    };
  }

  /**
   * A code becomes an id only here, and only through the scoped list — so a
   * code outside the asker's visibility resolves to nothing, and a proposal
   * against it is refused before anyone is shown a confirmation code.
   */
  private async resolveCode(
    user: AuthenticatedUser,
    resource: string,
    code: string,
  ): Promise<{ id: string; name: string } | null> {
    if (resource !== 'Opportunity') return null;

    const { items } = await this.opportunities.list(user, { search: code } as never);
    const match: any = items.find((o: any) => o.code === code);
    if (!match) return null;

    // The name checked against the model's claim is the account's, because
    // "change the stage for Nile Contracting" names the company, not the
    // opportunity's internal title.
    return { id: match.id, name: match.account?.legalName ?? match.name };
  }
}
