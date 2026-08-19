import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { QuotationsService } from './quotations.service';
import { QuotationExpiryService } from './expiry.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequireRoles } from '../auth/guards';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  AddRfqRecipientsDto,
  CreateQuotationDto,
  CreateRfqDto,
  EvaluateQuotationDto,
  QuotationLineDto,
  SelectQuotationDto,
  UpdateQuotationDto,
  UpdateRfqDto,
} from './dto';

/**
 * Routed at the root rather than under one prefix: RFQs and quotations are
 * reached both through their opportunity and directly by id, the same shape
 * the scope and costing controllers already use.
 */
@Controller()
export class QuotationsController {
  constructor(
    private readonly quotations: QuotationsService,
    private readonly expiry: QuotationExpiryService,
  ) {}

  @Get('opportunities/:opportunityId/rfqs')
  listRfqs(
    @CurrentUser() user: AuthenticatedUser,
    @Param('opportunityId') opportunityId: string,
  ) {
    return this.quotations.listRfqs(user, opportunityId);
  }

  @Post('opportunities/:opportunityId/rfqs')
  createRfq(
    @CurrentUser() user: AuthenticatedUser,
    @Param('opportunityId') opportunityId: string,
    @Body() dto: CreateRfqDto,
  ) {
    return this.quotations.createRfq(user, opportunityId, dto);
  }

  @Patch('rfqs/:id')
  updateRfq(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateRfqDto,
  ) {
    return this.quotations.updateRfq(user, id, dto);
  }

  @Post('rfqs/:id/recipients')
  addRecipients(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddRfqRecipientsDto,
  ) {
    return this.quotations.addRecipients(user, id, dto);
  }

  @Get('opportunities/:opportunityId/quotations')
  listQuotations(
    @CurrentUser() user: AuthenticatedUser,
    @Param('opportunityId') opportunityId: string,
  ) {
    return this.quotations.listQuotations(user, opportunityId);
  }

  @Post('opportunities/:opportunityId/quotations')
  createQuotation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('opportunityId') opportunityId: string,
    @Body() dto: CreateQuotationDto,
  ) {
    return this.quotations.createQuotation(user, opportunityId, dto);
  }

  /** The supplier comparison screen's single source. */
  @Get('opportunities/:opportunityId/quotation-comparison')
  compare(
    @CurrentUser() user: AuthenticatedUser,
    @Param('opportunityId') opportunityId: string,
  ) {
    return this.quotations.compare(user, opportunityId);
  }

  @Get('quotations/:id')
  findQuotation(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.quotations.findQuotation(user, id);
  }

  @Patch('quotations/:id')
  updateQuotation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateQuotationDto,
  ) {
    return this.quotations.updateQuotation(user, id, dto);
  }

  @Post('quotations/:id/items')
  addLine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: QuotationLineDto,
  ) {
    return this.quotations.addLine(user, id, dto);
  }

  @Delete('quotations/:id/items/:lineId')
  removeLine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
  ) {
    return this.quotations.removeLine(user, id, lineId);
  }

  @Post('quotations/:id/evaluation')
  evaluate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: EvaluateQuotationDto,
  ) {
    return this.quotations.evaluate(user, id, dto);
  }

  @Post('quotations/:id/select')
  select(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SelectQuotationDto,
  ) {
    return this.quotations.select(user, id, dto);
  }

  @Delete('quotations/:id')
  removeQuotation(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.quotations.removeQuotation(user, id);
  }

  /**
   * Run the expiry sweep now.
   *
   * The job runs daily, and a job whose only trigger is the calendar is one
   * nobody ever sees fail. This is how it is proven on the server after a
   * deploy — and how procurement can ask "what lapses this week?" without
   * waiting for tomorrow morning.
   */
  @Post('quotations/expiry-scan')
  @RequireRoles('CEO', 'OWNER_BOARD', 'FINANCE', 'PROCUREMENT', 'SYSTEM_ADMIN')
  scanExpiring() {
    return this.expiry.warnExpiring();
  }

}
