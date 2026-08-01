import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { HandoverService } from './handover.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  AddDeviationDto,
  AddHandoverItemDto,
  CreateContractDto,
  CreateHandoverDto,
  DecideDeviationDto,
  RecordAwardDto,
  SignoffDto,
  UpdateContractDto,
  UpdateHandoverDto,
  UpdateHandoverItemDto,
} from './dto';

@Controller()
export class ContractsController {
  constructor(
    private readonly contracts: ContractsService,
    private readonly handover: HandoverService,
  ) {}

  // --- award ---------------------------------------------------------------

  @Get('opportunities/:id/awards')
  listAwards(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.contracts.listAwards(user, id);
  }

  @Post('opportunities/:id/awards')
  recordAward(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordAwardDto,
  ) {
    return this.contracts.recordAward(user, id, dto);
  }

  // --- contracts -----------------------------------------------------------

  @Get('opportunities/:id/contracts')
  list(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.contracts.list(user, id);
  }

  @Post('opportunities/:id/contracts')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateContractDto,
  ) {
    return this.contracts.create(user, id, dto);
  }

  @Get('contracts/:id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.contracts.findOne(user, id);
  }

  @Patch('contracts/:id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateContractDto,
  ) {
    return this.contracts.update(user, id, dto);
  }

  @Post('contracts/:id/review')
  review(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.contracts.review(user, id);
  }

  @Post('contracts/:id/deviations')
  addDeviation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddDeviationDto,
  ) {
    return this.contracts.addDeviation(user, id, dto);
  }

  @Post('deviations/:id/decide')
  decideDeviation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DecideDeviationDto,
  ) {
    return this.contracts.decideDeviation(user, id, dto);
  }

  // --- handover ------------------------------------------------------------

  @Get('opportunities/:id/handover-readiness')
  previewReadiness(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.handover.previewReadiness(user, id);
  }

  @Get('opportunities/:id/handovers')
  listHandovers(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.handover.list(user, id);
  }

  @Post('opportunities/:id/handovers')
  createHandover(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateHandoverDto,
  ) {
    return this.handover.create(user, id, dto);
  }

  @Get('handovers/:id')
  findHandover(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.handover.findOne(user, id);
  }

  @Patch('handovers/:id')
  updateHandover(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateHandoverDto,
  ) {
    return this.handover.update(user, id, dto);
  }

  @Post('handovers/:id/items')
  addItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddHandoverItemDto,
  ) {
    return this.handover.addItem(user, id, dto);
  }

  @Patch('handover-items/:id')
  updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateHandoverItemDto,
  ) {
    return this.handover.updateItem(user, id, dto);
  }

  @Post('handovers/:id/signoff')
  sign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SignoffDto,
  ) {
    return this.handover.sign(user, id, dto);
  }
}
