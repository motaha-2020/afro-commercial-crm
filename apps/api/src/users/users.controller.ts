import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequireRoles } from '../auth/guards';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CreateUserDto, GrantRoleDto, UpdateUserDto } from './dto';

/**
 * User administration. Every route is limited to SYSTEM_ADMIN — creating an
 * account and granting it authority is itself an authoritative act, and it is
 * audited row by row.
 */
@Controller('users')
@RequireRoles('SYSTEM_ADMIN')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  /** Declared before :id so the literal path is not captured as an id. */
  @Get('meta')
  meta() {
    return this.users.meta();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.users.findOne(id);
  }

  @Post()
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateUserDto) {
    return this.users.create(actor, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.update(actor, id, dto);
  }

  @Post(':id/roles')
  grantRole(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: GrantRoleDto,
  ) {
    return this.users.grantRole(actor, id, dto);
  }

  @Delete(':id/roles/:role')
  revokeRole(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Param('role') role: string,
  ) {
    return this.users.revokeRole(actor, id, role);
  }

  @Post(':id/deactivate')
  deactivate(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.users.setActive(actor, id, false);
  }

  @Post(':id/reactivate')
  reactivate(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.users.setActive(actor, id, true);
  }

  @Post(':id/reset-password')
  resetPassword(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.users.resetPassword(actor, id);
  }
}
