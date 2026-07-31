import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ScopeService } from './scope.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  CreateAssumptionDto,
  CreateClarificationDto,
  CreateScopeItemDto,
  CreateScopePackageDto,
  UpdateAssumptionDto,
  UpdateClarificationDto,
  UpdateScopeItemDto,
  UpdateScopePackageDto,
} from './dto';

/**
 * Reads are nested under the opportunity (that is how the Scope tab loads);
 * writes to an existing row address it directly, since its id already implies
 * the opportunity and the service re-checks scope either way.
 */
@Controller()
export class ScopeController {
  constructor(private readonly scope: ScopeService) {}

  @Get('opportunities/:opportunityId/scope')
  overview(@CurrentUser() user: AuthenticatedUser, @Param('opportunityId') id: string) {
    return this.scope.overview(user, id);
  }

  // --- packages -------------------------------------------------------------

  @Post('opportunities/:opportunityId/scope/packages')
  createPackage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('opportunityId') id: string,
    @Body() dto: CreateScopePackageDto,
  ) {
    return this.scope.createPackage(user, id, dto);
  }

  @Patch('scope/packages/:id')
  updatePackage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateScopePackageDto,
  ) {
    return this.scope.updatePackage(user, id, dto);
  }

  @Delete('scope/packages/:id')
  removePackage(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.scope.removePackage(user, id);
  }

  // --- items ----------------------------------------------------------------

  @Post('scope/packages/:packageId/items')
  createItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('packageId') packageId: string,
    @Body() dto: CreateScopeItemDto,
  ) {
    return this.scope.createItem(user, packageId, dto);
  }

  @Patch('scope/items/:id')
  updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateScopeItemDto,
  ) {
    return this.scope.updateItem(user, id, dto);
  }

  @Delete('scope/items/:id')
  removeItem(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.scope.removeItem(user, id);
  }

  // --- assumptions ----------------------------------------------------------

  @Post('opportunities/:opportunityId/assumptions')
  createAssumption(
    @CurrentUser() user: AuthenticatedUser,
    @Param('opportunityId') id: string,
    @Body() dto: CreateAssumptionDto,
  ) {
    return this.scope.createAssumption(user, id, dto);
  }

  @Patch('assumptions/:id')
  updateAssumption(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateAssumptionDto,
  ) {
    return this.scope.updateAssumption(user, id, dto);
  }

  @Delete('assumptions/:id')
  removeAssumption(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.scope.removeAssumption(user, id);
  }

  // --- clarifications -------------------------------------------------------

  @Post('opportunities/:opportunityId/clarifications')
  createClarification(
    @CurrentUser() user: AuthenticatedUser,
    @Param('opportunityId') id: string,
    @Body() dto: CreateClarificationDto,
  ) {
    return this.scope.createClarification(user, id, dto);
  }

  @Patch('clarifications/:id')
  updateClarification(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateClarificationDto,
  ) {
    return this.scope.updateClarification(user, id, dto);
  }

  @Delete('clarifications/:id')
  removeClarification(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.scope.removeClarification(user, id);
  }
}
