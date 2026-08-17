import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { RelationshipsService } from './relationships.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  CreateAccountRelationshipDto,
  UpdateAccountRelationshipDto,
} from './dto';

@Controller()
export class RelationshipsController {
  constructor(private readonly relationships: RelationshipsService) {}

  @Get('accounts/:id/relationships')
  list(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.relationships.list(user, id);
  }

  @Post('accounts/:id/relationships')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateAccountRelationshipDto,
  ) {
    return this.relationships.create(user, id, dto);
  }

  @Patch('relationships/:id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateAccountRelationshipDto,
  ) {
    return this.relationships.update(user, id, dto);
  }

  @Delete('relationships/:id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.relationships.remove(user, id);
  }
}
