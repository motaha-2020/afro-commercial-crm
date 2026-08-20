import { BadRequestException, Injectable } from '@nestjs/common';
import { OPPORTUNITY_STAGES, OPPORTUNITY_STATUSES } from '@acms/shared';
import { OpportunitiesService } from '../../opportunities/opportunities.service';
import type { AuthenticatedUser } from '../../auth/auth.types';

/**
 * Every change the assistant can make, in one place.
 *
 * This is an allow-list of verbs, not a generic dispatcher: a proposal names
 * one of these or it cannot be built at all. The model never reaches a service
 * method it was not given, and a new verb is a deliberate addition here rather
 * than a phrasing the model found.
 */
export const ACTIONS = {
  'opportunity.changeStage': {
    resource: 'Opportunity',
    label: 'تغيير مرحلة الفرصة',
    /** Arguments the proposal must carry, shown to the user field by field. */
    fields: { toStage: 'المرحلة الجديدة', reason: 'السبب' },
  },
  'opportunity.changeStatus': {
    resource: 'Opportunity',
    label: 'تغيير حالة الفرصة',
    fields: { status: 'الحالة الجديدة', exitReason: 'سبب الخروج', notes: 'ملاحظات' },
  },
  'opportunity.updateNextStep': {
    resource: 'Opportunity',
    label: 'تحديث الخطوة التالية للفرصة',
    fields: { nextStep: 'الخطوة التالية' },
  },
} as const;

export type ActionKey = keyof typeof ACTIONS;

export function isActionKey(value: unknown): value is ActionKey {
  return typeof value === 'string' && value in ACTIONS;
}

@Injectable()
export class ActionExecutorService {
  constructor(private readonly opportunities: OpportunitiesService) {}

  /**
   * Validates the proposal's body *before* a code is issued.
   *
   * A body that only fails at execution time would have been confirmed by a
   * person first, which makes the confirmation meaningless: they would have
   * approved something that could never run.
   */
  validate(action: ActionKey, body: Record<string, unknown>): Record<string, unknown> {
    switch (action) {
      case 'opportunity.changeStage': {
        const toStage = String(body.toStage ?? '');
        if (!(OPPORTUNITY_STAGES as readonly string[]).includes(toStage)) {
          throw new BadRequestException(
            `"${toStage}" ليست مرحلة معروفة. المراحل: ${OPPORTUNITY_STAGES.join('، ')}`,
          );
        }
        return { toStage, ...(body.reason ? { reason: String(body.reason) } : {}) };
      }

      case 'opportunity.changeStatus': {
        const status = String(body.status ?? '');
        if (!(OPPORTUNITY_STATUSES as readonly string[]).includes(status)) {
          throw new BadRequestException(
            `"${status}" ليست حالة معروفة. الحالات: ${OPPORTUNITY_STATUSES.join('، ')}`,
          );
        }
        return {
          status,
          ...(body.exitReason ? { exitReason: String(body.exitReason) } : {}),
          ...(body.notes ? { notes: String(body.notes) } : {}),
        };
      }

      case 'opportunity.updateNextStep': {
        const nextStep = String(body.nextStep ?? '').trim();
        // A mandatory field with no valid value invites invention: better to
        // refuse than to accept an empty string that reads as a decision.
        if (!nextStep) throw new BadRequestException('الخطوة التالية لا يمكن أن تكون فارغة.');
        return { nextStep };
      }

      default: {
        const exhaustive: never = action;
        throw new BadRequestException(`إجراء غير معروف: ${String(exhaustive)}`);
      }
    }
  }

  /**
   * Runs the change as the confirming user, through the same service the HTTP
   * route uses — so the stage rules, the notifications and the audit entry all
   * happen exactly as they would have if a person had clicked the button.
   */
  async execute(
    user: AuthenticatedUser,
    action: string,
    targetId: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    if (!isActionKey(action)) throw new BadRequestException(`إجراء غير معروف: ${action}`);

    switch (action) {
      case 'opportunity.changeStage':
        await this.opportunities.changeStage(user, targetId, body as never);
        return;
      case 'opportunity.changeStatus':
        await this.opportunities.changeStatus(user, targetId, body as never);
        return;
      case 'opportunity.updateNextStep':
        await this.opportunities.update(user, targetId, body as never);
        return;
    }
  }
}
