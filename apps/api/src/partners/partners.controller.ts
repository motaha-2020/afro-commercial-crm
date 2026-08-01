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
import { PartnersService } from './partners.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  AddPartnerTypeDto,
  BlacklistPartnerDto,
  ChangeApprovalStatusDto,
  CreatePartnerDto,
  ListPartnersQuery,
  RatePartnerDto,
  UpdatePartnerDto,
} from './dto';

@Controller('partners')
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListPartnersQuery) {
    return this.partners.list(user, query);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.partners.findOne(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePartnerDto) {
    return this.partners.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePartnerDto,
  ) {
    return this.partners.update(user, id, dto);
  }

  @Patch(':id/ratings')
  rate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RatePartnerDto,
  ) {
    return this.partners.rate(user, id, dto);
  }

  @Patch(':id/approval')
  changeApproval(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ChangeApprovalStatusDto,
  ) {
    return this.partners.changeApproval(user, id, dto);
  }

  @Patch(':id/blacklist')
  setBlacklist(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: BlacklistPartnerDto,
  ) {
    return this.partners.setBlacklist(user, id, dto);
  }

  @Post(':id/types')
  addType(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddPartnerTypeDto,
  ) {
    return this.partners.addType(user, id, dto);
  }

  @Delete(':id/types/:type')
  removeType(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('type') type: string,
  ) {
    return this.partners.removeType(user, id, type);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.partners.remove(user, id);
  }
}
