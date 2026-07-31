import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CostingService } from './costing.service';
import { LibraryService } from './library.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  CreateBoqItemDto,
  CreateBreakdownDto,
  CreateCostElementDto,
  CreatePackageDto,
  CreateResourceDto,
  CreateScenarioDto,
  CreateVersionDto,
  RejectVersionDto,
  UpdateBoqItemDto,
  UpdateBreakdownDto,
  UpdatePackageDto,
  UpdateScenarioDto,
} from './dto';

@Controller()
export class CostingController {
  constructor(
    private readonly costing: CostingService,
    private readonly library: LibraryService,
  ) {}

  // --- scenarios ------------------------------------------------------------

  @Get('opportunities/:opportunityId/costing')
  scenarios(@CurrentUser() user: AuthenticatedUser, @Param('opportunityId') id: string) {
    return this.costing.listScenarios(user, id);
  }

  @Post('opportunities/:opportunityId/costing')
  createScenario(
    @CurrentUser() user: AuthenticatedUser,
    @Param('opportunityId') id: string,
    @Body() dto: CreateScenarioDto,
  ) {
    return this.costing.createScenario(user, id, dto);
  }

  @Patch('costing/scenarios/:id')
  updateScenario(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateScenarioDto,
  ) {
    return this.costing.updateScenario(user, id, dto);
  }

  @Post('costing/scenarios/:id/select')
  select(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.costing.selectScenario(user, id);
  }

  // --- versions -------------------------------------------------------------

  @Post('costing/scenarios/:id/versions')
  createVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateVersionDto,
  ) {
    return this.costing.createVersion(user, id, dto);
  }

  @Get('costing/versions/:id')
  version(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.costing.versionDetail(user, id);
  }

  @Post('costing/versions/:id/submit')
  submit(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.costing.submitVersion(user, id);
  }

  @Post('costing/versions/:id/approve')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.costing.approveVersion(user, id);
  }

  @Post('costing/versions/:id/reject')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectVersionDto,
  ) {
    return this.costing.rejectVersion(user, id, dto);
  }

  // --- packages, BOQ, breakdown --------------------------------------------

  @Post('costing/versions/:id/packages')
  createPackage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreatePackageDto,
  ) {
    return this.costing.createPackage(user, id, dto);
  }

  @Patch('costing/packages/:id')
  updatePackage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePackageDto,
  ) {
    return this.costing.updatePackage(user, id, dto);
  }

  @Delete('costing/packages/:id')
  removePackage(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.costing.removePackage(user, id);
  }

  @Post('costing/packages/:id/items')
  createItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateBoqItemDto,
  ) {
    return this.costing.createBoqItem(user, id, dto);
  }

  @Patch('costing/items/:id')
  updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateBoqItemDto,
  ) {
    return this.costing.updateBoqItem(user, id, dto);
  }

  @Delete('costing/items/:id')
  removeItem(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.costing.removeBoqItem(user, id);
  }

  @Post('costing/items/:id/breakdown')
  addBreakdown(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateBreakdownDto,
  ) {
    return this.costing.addBreakdown(user, id, dto);
  }

  @Patch('costing/breakdown/:id')
  updateBreakdown(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateBreakdownDto,
  ) {
    return this.costing.updateBreakdown(user, id, dto);
  }

  @Delete('costing/breakdown/:id')
  removeBreakdown(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.costing.removeBreakdown(user, id);
  }

  // --- libraries ------------------------------------------------------------

  @Get('cost-elements')
  elements(@Query('category') category?: string) {
    return this.library.listElements(category);
  }

  @Post('cost-elements')
  createElement(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCostElementDto) {
    return this.library.createElement(user, dto);
  }

  @Get('resources')
  resources(
    @Query('type') type?: string,
    @Query('asOf') asOf?: string,
    @Query('code') code?: string,
  ) {
    return this.library.listResources({ type, asOf, code });
  }

  @Post('resources')
  createResource(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateResourceDto) {
    return this.library.createResource(user, dto);
  }

  @Get('resources/:code/history')
  history(@Param('code') code: string) {
    return this.library.priceHistory(code);
  }
}
