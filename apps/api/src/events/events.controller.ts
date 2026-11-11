import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { TenantId } from '../auth/tenant-id.decorator';
import { PublishEventDto } from './events.dto';
import { EventsService } from './events.service';

@ApiTags('events')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard)
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post()
  @ApiHeader({ name: 'idempotency-key', required: false })
  async publish(
    @TenantId() tenantId: string,
    @Body() dto: PublishEventDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.events.publish(tenantId, dto, idempotencyKey || undefined);
    // 201 for a new event, 200 when the idempotency key matched an earlier one.
    reply.status(result.duplicate ? 200 : 201);
    return result;
  }

  @Get()
  list(@TenantId() tenantId: string) {
    return this.events.list(tenantId);
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.events.get(tenantId, id);
  }
}
