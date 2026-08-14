import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { DocumentCategory } from '@prisma/client';
import { DocumentsService } from './documents.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

class UploadMetaDto {
  @IsString()
  title!: string;

  @IsString()
  entityType!: string;

  @IsString()
  entityId!: string;

  @IsOptional()
  @IsEnum(DocumentCategory)
  category?: DocumentCategory;

  /** Set to append a new version to an existing document. */
  @IsOptional()
  @IsString()
  documentId?: string;
}

// 25 MB cap keeps a stray upload from exhausting memory; tenders and drawings
// in this domain sit well under it.
const MAX_BYTES = 25 * 1024 * 1024;

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  list(
    @Query('entityType') entityType: string,
    @Query('entityId') entityId: string,
  ) {
    return this.documents.listForEntity(entityType, entityId);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() meta: UploadMetaDto,
  ) {
    if (!file) throw new BadRequestException('A file is required');

    return this.documents.upload(
      user,
      {
        title: meta.title,
        category: meta.category,
        entityType: meta.entityType,
        entityId: meta.entityId,
        fileName: file.originalname,
        contentType: file.mimetype,
        buffer: file.buffer,
      },
      meta.documentId,
    );
  }

  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @Query('versionId') versionId: string | undefined,
    @Res() res: Response,
  ) {
    const { version, object } = await this.documents.getVersionForDownload(
      id,
      versionId,
    );
    res.setHeader('Content-Type', version.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(version.fileName)}"`,
    );
    res.setHeader('x-checksum-sha256', version.checksum);
    object.body.pipe(res);
  }
}
