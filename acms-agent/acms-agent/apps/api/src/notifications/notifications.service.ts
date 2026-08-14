import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';

export interface NotifyInput {
  userId: string;
  type: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Direct notification to a specific user. */
  async notify(input: NotifyInput) {
    return this.prisma.notification.create({ data: input });
  }

  /**
   * Fans an event out to everyone an active NotificationRule targets — by role
   * or by explicit user. Callers raise domain events ("OPPORTUNITY_STAGE_CHANGED")
   * and governance decides, via rules, who hears about them.
   */
  async dispatchEvent(
    eventType: string,
    payload: { title: string; body?: string; entityType?: string; entityId?: string },
  ): Promise<number> {
    const rules = await this.prisma.notificationRule.findMany({
      where: { eventType, isActive: true, deletedAt: null },
    });
    if (rules.length === 0) return 0;

    const recipientIds = new Set<string>();
    for (const rule of rules) {
      if (rule.userTarget) {
        recipientIds.add(rule.userTarget);
      } else if (rule.roleTarget) {
        const users = await this.prisma.userRole.findMany({
          where: { role: rule.roleTarget },
          select: { userId: true },
        });
        users.forEach((u) => recipientIds.add(u.userId));
      }
    }

    if (recipientIds.size === 0) return 0;

    await this.prisma.notification.createMany({
      data: [...recipientIds].map((userId) => ({
        userId,
        type: eventType,
        title: payload.title,
        body: payload.body,
        entityType: payload.entityType,
        entityId: payload.entityId,
      })),
    });
    return recipientIds.size;
  }

  async listForUser(user: AuthenticatedUser, unreadOnly: boolean) {
    return this.prisma.notification.findMany({
      where: { userId: user.id, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async unreadCount(user: AuthenticatedUser): Promise<number> {
    return this.prisma.notification.count({
      where: { userId: user.id, readAt: null },
    });
  }

  async markRead(user: AuthenticatedUser, id: string) {
    // Scoped to the owner so one user cannot clear another's notifications.
    await this.prisma.notification.updateMany({
      where: { id, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { success: true };
  }

  async markAllRead(user: AuthenticatedUser) {
    await this.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { success: true };
  }
}
