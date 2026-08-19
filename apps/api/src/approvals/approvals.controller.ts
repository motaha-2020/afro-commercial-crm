import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { DiscountsService } from './discounts.service';
import { PoliciesService } from './policies.service';
import { ProposalsService } from './proposals.service';
import { WorkflowsService } from './workflows.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { ApprovalPolicyKey } from '@acms/shared';
import {
  CreateDiscountRequestDto,
  CreateProposalDto,
  CreateProposalVersionDto,
  DecideDiscountDto,
  DecideDto,
  ListPoliciesQuery,
  MyQueueQuery,
  RaiseApprovalDto,
  SetPolicyDto,
  SubmitProposalVersionDto,
  CreateWorkflowDto,
  CreateRuleDto,
  CreateWorkflowStepDto,
  UpdateWorkflowDto,
  UpdateRuleDto,
  UpdateWorkflowStepDto,
} from './dto';

/**
 * The settings screen Afro asked for: limits that change per project, per
 * opportunity and per country, edited by a person rather than by a deploy.
 */
@Controller('approval-policies')
export class PoliciesController {
  constructor(private readonly policies: PoliciesService) {}

  @Get()
  effective(@CurrentUser() user: AuthenticatedUser, @Query() query: ListPoliciesQuery) {
    return this.policies.effective(user, query);
  }

  @Get(':key/history')
  history(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string) {
    return this.policies.history(user, key as ApprovalPolicyKey);
  }

  @Post()
  set(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetPolicyDto) {
    return this.policies.set(user, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.policies.remove(user, id);
  }
}

@Controller()
export class ApprovalsController {
  constructor(
    private readonly approvals: ApprovalsService,
    private readonly discounts: DiscountsService,
    private readonly proposals: ProposalsService,
  ) {}

  // --- approvals -----------------------------------------------------------

  @Get('approvals/my-queue')
  myQueue(@CurrentUser() user: AuthenticatedUser, @Query() query: MyQueueQuery) {
    return this.approvals.myQueue(user, query);
  }

  /** Declared before approvals/:id so the literal path is not read as an id. */
  @Get('approvals/my-queue/filters')
  myQueueFilters(@CurrentUser() user: AuthenticatedUser) {
    return this.approvals.myQueueFilters(user);
  }

  @Get('approvals/:id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.approvals.findOne(user, id);
  }

  @Post('approvals/:id/decide')
  decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DecideDto,
  ) {
    return this.approvals.decide(user, id, dto);
  }

  @Get('opportunities/:id/approval-preview')
  preview(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.approvals.preview(user, id);
  }

  @Post('opportunities/:id/approvals')
  raise(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RaiseApprovalDto,
  ) {
    return this.approvals.raise(user, id, dto);
  }

  // --- discounts -----------------------------------------------------------

  @Get('opportunities/:id/discounts')
  listDiscounts(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.discounts.list(user, id);
  }

  @Post('opportunities/:id/discounts')
  requestDiscount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateDiscountRequestDto,
  ) {
    return this.discounts.create(user, id, dto);
  }

  @Post('discounts/:id/decide')
  decideDiscount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DecideDiscountDto,
  ) {
    return this.discounts.decide(user, id, dto);
  }

  // --- proposals -----------------------------------------------------------

  @Get('opportunities/:id/proposals')
  listProposals(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.proposals.list(user, id);
  }

  @Post('opportunities/:id/proposals')
  createProposal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateProposalDto,
  ) {
    return this.proposals.create(user, id, dto);
  }

  @Post('proposals/:id/versions')
  addVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateProposalVersionDto,
  ) {
    return this.proposals.addVersion(user, id, dto);
  }

  @Post('proposal-versions/:id/submit')
  submitVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SubmitProposalVersionDto,
  ) {
    return this.proposals.submit(user, id, dto);
  }
}


/**
 * Editing the approval cycle itself.
 *
 * Until now the steps and the rules were seeded and then changed in the
 * database, which meant every ordinary administrative decision — a new country
 * with its own cycle, a threshold moved, an approver replaced — needed a
 * developer with production access. That is not a missing screen; it is a
 * governance decision taken outside the system that records governance
 * decisions, which is why every write here is audited.
 */
@Controller()
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get('workflows')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.workflows.list(user);
  }

  @Post('workflows')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateWorkflowDto) {
    return this.workflows.create(user, dto);
  }

  @Patch('workflows/:id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateWorkflowDto,
  ) {
    return this.workflows.update(user, id, dto);
  }

  @Post('workflows/:id/steps')
  addStep(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateWorkflowStepDto,
  ) {
    return this.workflows.addStep(user, id, dto);
  }

  @Patch('workflow-steps/:id')
  updateStep(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateWorkflowStepDto,
  ) {
    return this.workflows.updateStep(user, id, dto);
  }

  @Delete('workflow-steps/:id')
  removeStep(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.workflows.removeStep(user, id);
  }

  @Post('workflows/:id/rules')
  addRule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateRuleDto,
  ) {
    return this.workflows.addRule(user, id, dto);
  }

  @Patch('approval-rules/:id')
  updateRule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateRuleDto,
  ) {
    return this.workflows.updateRule(user, id, dto);
  }

  @Delete('approval-rules/:id')
  removeRule(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.workflows.removeRule(user, id);
  }
}
