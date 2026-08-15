import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { OpportunitiesService } from './opportunities.service';
import { OpportunityImportService } from './opportunity-import.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  ChangeStageDto,
  ChangeStatusDto,
  CreateOpportunityDto,
  ImportCsvDto,
  ListOpportunitiesQuery,
  UpdateOpportunityDto,
} from './dto';

@Controller('opportunities')
export class OpportunitiesController {
  constructor(
    private readonly opportunities: OpportunitiesService,
    private readonly imports: OpportunityImportService,
  ) {}

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

  // --- bulk import ---------------------------------------------------------

  @Get('import/template')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="opportunities-template.csv"')
  template() {
    return this.imports.template();
  }

  /** Validates and writes nothing. The file is not stored either. */
  @Post('import/preview')
  previewImport(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImportCsvDto,
  ) {
    return this.imports.preview(user, dto.csv);
  }

  /**
   * Re-validates from scratch and then writes all rows or none.
   *
   * It takes the file again rather than a token from the preview: a preview is
   * a claim about a moment that has passed, and importing against it would let
   * a customer archived in between be referenced by rows that were checked
   * before it went.
   */
  @Post('import/commit')
  commitImport(@CurrentUser() user: AuthenticatedUser, @Body() dto: ImportCsvDto) {
    return this.imports.commit(user, dto.csv);
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
