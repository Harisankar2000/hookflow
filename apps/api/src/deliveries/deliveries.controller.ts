import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { TenantId } from '../auth/tenant-id.decorator';
import { ListDeliveriesQuery } from './deliveries.dto';
import { DeliveriesService } from './deliveries.service';

@ApiTags('deliveries')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard)
@Controller('deliveries')
export class DeliveriesController {
  constructor(private readonly deliveries: DeliveriesService) {}

  @Get()
  list(@TenantId() tenantId: string, @Query() query: ListDeliveriesQuery) {
    return this.deliveries.list(tenantId, query);
  }

  @Post('replay-dead')
  @HttpCode(200)
  replayDead(@TenantId() tenantId: string) {
    return this.deliveries.replayDead(tenantId);
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.deliveries.get(tenantId, id);
  }

  @Post(':id/replay')
  @HttpCode(200)
  replay(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.deliveries.replay(tenantId, id);
  }
}
