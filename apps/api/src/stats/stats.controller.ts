import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { TenantId } from '../auth/tenant-id.decorator';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('stats')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard)
@Controller('stats')
export class StatsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get(@TenantId() tenantId: string) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentAttempts = { delivery: { tenantId }, createdAt: { gte: since } };

    const [byStatus, endpoints, events, attempts, successfulAttempts] = await Promise.all([
      this.prisma.delivery.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
      this.prisma.endpoint.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
      this.prisma.event.count({ where: { tenantId } }),
      this.prisma.deliveryAttempt.aggregate({
        where: recentAttempts,
        _count: { _all: true },
        _avg: { durationMs: true },
      }),
      this.prisma.deliveryAttempt.count({ where: { ...recentAttempts, statusCode: { gte: 200, lt: 300 } } }),
    ]);

    const count = (rows: { status: string; _count: { _all: number } }[]) =>
      Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
    const totalAttempts = attempts._count._all;

    return {
      events,
      deliveries: count(byStatus),
      endpoints: count(endpoints),
      last24h: {
        attempts: totalAttempts,
        successRate: totalAttempts ? successfulAttempts / totalAttempts : null,
        avgDurationMs: attempts._avg.durationMs === null ? null : Math.round(attempts._avg.durationMs),
      },
    };
  }
}
