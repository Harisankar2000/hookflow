import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EndpointStatus } from '@prisma/client';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { TenantId } from '../auth/tenant-id.decorator';
import { CreateEndpointDto, UpdateEndpointDto } from './endpoints.dto';
import { EndpointsService } from './endpoints.service';

@ApiTags('endpoints')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard)
@Controller('endpoints')
export class EndpointsController {
  constructor(private readonly endpoints: EndpointsService) {}

  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreateEndpointDto) {
    return this.endpoints.create(tenantId, dto);
  }

  @Get()
  list(@TenantId() tenantId: string) {
    return this.endpoints.list(tenantId);
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.endpoints.get(tenantId, id);
  }

  @Patch(':id')
  update(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEndpointDto) {
    return this.endpoints.update(tenantId, id, dto);
  }

  @Post(':id/pause')
  @HttpCode(200)
  pause(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.endpoints.setStatus(tenantId, id, EndpointStatus.PAUSED);
  }

  @Post(':id/enable')
  @HttpCode(200)
  enable(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.endpoints.setStatus(tenantId, id, EndpointStatus.ACTIVE);
  }

  @Post(':id/rotate-secret')
  @HttpCode(200)
  rotateSecret(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.endpoints.rotateSecret(tenantId, id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.endpoints.remove(tenantId, id);
  }
}
