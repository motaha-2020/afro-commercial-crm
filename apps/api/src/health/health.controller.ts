import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/guards';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  // Container orchestrators probe this without credentials.
  @Public()
  @Get()
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', database: 'up' };
  }
}
