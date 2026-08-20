import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AiChatService } from './chat/ai-chat.service';
import { SendMessageDto } from './chat/dto';
import { StorageService } from '../documents/storage.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * The assistant reads as whoever is asking — there is no service account and
 * no token handed between services, because the agent runs in this process and
 * already holds the caller.
 */
@Controller('ai')
export class AiController {
  constructor(
    private readonly chat: AiChatService,
    private readonly storage: StorageService,
  ) {}

  @Post('chat')
  send(@CurrentUser() user: AuthenticatedUser, @Body() dto: SendMessageDto) {
    return this.chat.send(user, dto.message, dto.conversationId);
  }

  /**
   * Downloads a report the assistant generated.
   *
   * The key is checked against the caller's own prefix rather than trusted:
   * report keys are guessable in shape, and a report is a scoped extract of
   * someone's pipeline — handing one to the wrong reader would undo every
   * scoping decision that produced it.
   */
  @Get('reports/:key')
  async downloadReport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
    @Res() res: Response,
  ): Promise<void> {
    const decoded = decodeURIComponent(key);
    if (!decoded.startsWith(`reports/${user.id}/`)) {
      throw new ForbiddenException('هذا التقرير ليس تقريرك.');
    }

    try {
      const object = await this.storage.get(decoded);
      res.setHeader('Content-Type', object.contentType ?? 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${decoded.split('/').pop() ?? 'report.csv'}"`,
      );
      object.body.pipe(res);
    } catch {
      throw new NotFoundException('التقرير غير موجود أو انتهت صلاحيته.');
    }
  }
}
