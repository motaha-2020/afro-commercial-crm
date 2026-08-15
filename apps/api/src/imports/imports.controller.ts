import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { IMPORT_DEFINITIONS } from '@acms/shared';
import { ImportEngineService } from './import-engine.service';
import { ImportCsvDto } from './dto';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * One set of endpoints for every import, keyed by resource.
 *
 * Adding a new importable thing is a definition plus an adapter — no new
 * routes, no new screen, no second copy of preview-then-commit to keep in step
 * with this one.
 */
@Controller('imports')
export class ImportsController {
  constructor(private readonly engine: ImportEngineService) {}

  /** What can be imported, and what each needs before it can be. */
  @Get()
  list() {
    return Object.values(IMPORT_DEFINITIONS).map((d) => ({
      resource: d.resource,
      scope: d.scope,
      contextType: d.contextType ?? null,
      tree: d.tree,
      columns: d.columns,
    }));
  }

  @Get(':resource/template')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  template(@Param('resource') resource: string) {
    return this.engine.template(resource);
  }

  /** Validates and writes nothing. The file is not stored either. */
  @Post(':resource/preview')
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('resource') resource: string,
    @Body() dto: ImportCsvDto,
    @Query('contextId') contextId?: string,
  ) {
    return this.engine.preview(user, resource, dto.csv, contextId);
  }

  /**
   * Re-validates from scratch, then writes all rows or none.
   *
   * It takes the file again rather than a token from the preview: a preview is
   * a claim about a moment that has passed, and a costing version approved in
   * between must stop the write even though the preview was clean.
   */
  @Post(':resource/commit')
  commit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('resource') resource: string,
    @Body() dto: ImportCsvDto,
    @Query('contextId') contextId?: string,
  ) {
    return this.engine.commit(user, resource, dto.csv, contextId);
  }
}
