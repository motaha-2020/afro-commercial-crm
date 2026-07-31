import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { BidsService } from './bids.service';
import { AssessmentService } from './assessment.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  AssessBidDto,
  CreateBidDto,
  CreateRequirementDto,
  RecordDecisionDto,
  UpdateBidDto,
  UpdateRequirementDto,
  UpdateWeightsDto,
} from './dto';

@Controller()
export class BidsController {
  constructor(
    private readonly bids: BidsService,
    private readonly assessment: AssessmentService,
  ) {}

  // --- bids and tenders -----------------------------------------------------

  @Get('opportunities/:opportunityId/bids')
  list(@CurrentUser() user: AuthenticatedUser, @Param('opportunityId') id: string) {
    return this.bids.listForOpportunity(user, id);
  }

  @Post('opportunities/:opportunityId/bids')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('opportunityId') id: string,
    @Body() dto: CreateBidDto,
  ) {
    return this.bids.create(user, id, dto);
  }

  @Patch('bids/:id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateBidDto,
  ) {
    return this.bids.update(user, id, dto);
  }

  @Delete('bids/:id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.bids.remove(user, id);
  }

  /** Cross-opportunity view: what closes soon, within the caller's scope. */
  @Get('bids/deadlines')
  deadlines(@CurrentUser() user: AuthenticatedUser, @Query('days') days?: string) {
    const window = Math.min(Math.max(Number(days) || 30, 1), 180);
    return this.bids.upcomingDeadlines(user, window);
  }

  // --- bid checklist --------------------------------------------------------

  @Post('bids/:bidId/requirements')
  addRequirement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bidId') bidId: string,
    @Body() dto: CreateRequirementDto,
  ) {
    return this.bids.addRequirement(user, bidId, dto);
  }

  @Patch('bid-requirements/:id')
  updateRequirement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateRequirementDto,
  ) {
    return this.bids.updateRequirement(user, id, dto);
  }

  @Delete('bid-requirements/:id')
  removeRequirement(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.bids.removeRequirement(user, id);
  }

  // --- Bid / No-Bid ---------------------------------------------------------

  @Get('opportunities/:opportunityId/bid-assessment')
  assessments(@CurrentUser() user: AuthenticatedUser, @Param('opportunityId') id: string) {
    return this.assessment.history(user, id);
  }

  @Post('opportunities/:opportunityId/bid-assessment')
  assess(
    @CurrentUser() user: AuthenticatedUser,
    @Param('opportunityId') id: string,
    @Body() dto: AssessBidDto,
  ) {
    return this.assessment.assess(user, id, dto);
  }

  @Post('bid-assessments/:id/decision')
  decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordDecisionDto,
  ) {
    return this.assessment.decide(user, id, dto);
  }

  // --- scoring weights (governed) -------------------------------------------

  @Get('bid-weights')
  weights() {
    return this.assessment.weightsView();
  }

  @Patch('bid-weights')
  setWeights(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateWeightsDto) {
    return this.assessment.updateWeights(user, dto);
  }
}
