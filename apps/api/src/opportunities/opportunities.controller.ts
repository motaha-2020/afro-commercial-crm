import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { OpportunitiesService } from './opportunities.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  ChangeStageDto,
  ChangeStatusDto,
  CreateOpportunityDto,
  ListOpportunitiesQuery,
  UpdateOpportunityDto,
} from './dto';

@Controller('opportunities')
export class OpportunitiesController {
  constructor(private readonly opportunities: OpportunitiesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListOpportunitiesQuery,
  ) {
    return this.opportunities.list(user, query);
  }

  /** Declared before :id so the literal path is not captured as an id. */
  @Get('owners')
  owners(@CurrentUser() user: AuthenticatedUser) {
    return this.opportunities.owners(user);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.opportunities.findOne(user, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOpportunityDto,
  ) {
    return this.opportunities.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateOpportunityDto,
  ) {
    return this.opportunities.update(user, id, dto);
  }

  @Post(':id/stage')
  changeStage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ChangeStageDto,
  ) {
    return this.opportunities.changeStage(user, id, dto);
  }

  @Post(':id/status')
  changeStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ChangeStatusDto,
  ) {
    return this.opportunities.changeStatus(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.opportunities.remove(user, id);
  }
}
