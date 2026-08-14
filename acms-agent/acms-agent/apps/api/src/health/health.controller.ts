import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../documents/storage.service';
import { Public } from '../auth/guards';

/**
 * Liveness and readiness are deliberately different questions.
 *
 * Liveness: is the process alive? If this fails the container should be
 * restarted — so it must not touch the database, or a database outage would
 * make the orchestrator restart every healthy API container in a loop.
 *
 * Readiness: can this instance actually serve traffic? Checks dependencies and
 * answers 503 when the database is gone, so the instance is pulled out of
 * rotation instead of failing requests it was never going to fulfil.
 */
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // Container orchestrators probe these without credentials.
  @Public()
  @Get()
  check() {
    return this.ready();
  }

  @Public()
  @Get('live')
  live() {
    return {
      status: 'ok',
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      version: process.env.APP_VERSION ?? '0.1.0',
    };
  }

  @Public()
  @Get('ready')
  async ready() {
    const [database, storage] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(
        () => true,
        () => false,
      ),
      this.storage.ping(),
    ]);

    const body = {
      status: database && storage ? 'ok' : 'degraded',
      database: database ? 'up' : 'down',
      storage: storage ? 'up' : 'down',
    };

    // Storage down is degraded, not dead: everything except documents still
    // works. A missing database means the API can serve nothing.
    if (!database) throw new ServiceUnavailableException(body);
    return body;
  }
}
