import { Injectable } from '@nestjs/common';
import { AiMessageRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AiMessage } from '../providers/ai-provider.interface';

/** How many recent turns the orchestrator rebuilds as context per call. */
const CONTEXT_WINDOW = 20;

/**
 * Session/conversation memory for the assistant. Deliberately dumb — it
 * stores and replays turns, it does not summarize or embed. Longer-term
 * "company knowledge" recall (the Memory Layer's other boxes in the
 * architecture) is a RAG concern that plugs in later without touching this.
 */
@Injectable()
export class AiMemoryService {
  constructor(private readonly prisma: PrismaService) {}

  async startOrGetConversation(userId: string, conversationId?: string) {
    if (conversationId) {
      const existing = await this.prisma.aiConversation.findFirst({
        where: { id: conversationId, userId },
      });
      if (existing) return existing;
    }
    return this.prisma.aiConversation.create({ data: { userId } });
  }

  async recentMessages(conversationId: string): Promise<AiMessage[]> {
    const rows = await this.prisma.aiMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: CONTEXT_WINDOW,
    });
    return rows
      .reverse()
      .map((row) => ({ role: row.role.toLowerCase() as AiMessage['role'], content: row.content }));
  }

  async appendUserMessage(conversationId: string, content: string) {
    await this.prisma.aiMessage.create({
      data: { conversationId, role: AiMessageRole.USER, content },
    });
  }

  async appendAssistantMessage(
    conversationId: string,
    content: string,
    meta: { task: string; provider: string; model: string },
  ) {
    await this.prisma.aiMessage.create({
      data: {
        conversationId,
        role: AiMessageRole.ASSISTANT,
        content,
        task: meta.task,
        provider: meta.provider,
        model: meta.model,
      },
    });
  }
}
