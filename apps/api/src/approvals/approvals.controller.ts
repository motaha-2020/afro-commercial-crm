import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { DiscountsService } from './discounts.service';
import { PoliciesService } from './policies.service';
import { ProposalsService } from './proposals.service';
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
