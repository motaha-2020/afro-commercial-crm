import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { TargetsService } from './targets.service';
import { ListTargetsQuery, SetTargetDto } from './dto';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Reading a target is open to anyone who can see the deals behind it —
 * a salesperson should know the number they are measured against. Setting one
 * is not: the guard lives in the service, next to the audit entry that records
 * an attempt that was refused.
 */
@Controller('targets')
export class TargetsController {
  constructor(private readonly targets: TargetsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListTargetsQuery) {
    return this.targets.list(user, query);
  }

  /** Who this caller may set a target for. Empty for a caller who may not. */
  @Get('assignable')
  assignable(@CurrentUser() user: AuthenticatedUser) {
    return this.targets.assignable(user);
  }

  @Post()
  set(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetTargetDto) {
    return this.targets.set(user, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.targets.remove(user, id);
  }
}
