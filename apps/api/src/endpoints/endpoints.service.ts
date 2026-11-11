import { Injectable, NotFoundException } from '@nestjs/common';
import { EndpointStatus } from '@prisma/client';
import { generateEndpointSecret } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEndpointDto, UpdateEndpointDto } from './endpoints.dto';

@Injectable()
export class EndpointsService {
  constructor(private readonly prisma: PrismaService) {}

  create(tenantId: string, dto: CreateEndpointDto) {
    return this.prisma.endpoint.create({
      data: {
        tenantId,
        url: dto.url,
        description: dto.description,
        eventTypes: dto.eventTypes ?? [],
        secret: generateEndpointSecret(),
      },
    });
  }

  list(tenantId: string) {
    return this.prisma.endpoint.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
  }

  async get(tenantId: string, id: string) {
    const endpoint = await this.prisma.endpoint.findFirst({ where: { id, tenantId } });
    if (!endpoint) {
      throw new NotFoundException('Endpoint not found');
    }
    return endpoint;
  }

  async update(tenantId: string, id: string, dto: UpdateEndpointDto) {
    await this.get(tenantId, id);
    return this.prisma.endpoint.update({ where: { id }, data: dto });
  }

  async setStatus(tenantId: string, id: string, status: EndpointStatus) {
    await this.get(tenantId, id);
    return this.prisma.endpoint.update({
      where: { id },
      // Re-enabling clears the failure streak so the circuit breaker starts fresh.
      data: status === EndpointStatus.ACTIVE ? { status, consecutiveFailures: 0, disabledAt: null } : { status },
    });
  }

  async rotateSecret(tenantId: string, id: string) {
    await this.get(tenantId, id);
    return this.prisma.endpoint.update({ where: { id }, data: { secret: generateEndpointSecret() } });
  }

  async remove(tenantId: string, id: string) {
    await this.get(tenantId, id);
    await this.prisma.endpoint.delete({ where: { id } });
  }
}
