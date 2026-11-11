import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DeliveryStatus, EndpointStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { DELIVERY_QUEUE, DeliveryJob } from './deliveries.constants';
import { ListDeliveriesQuery } from './deliveries.dto';

@Injectable()
export class DeliveriesService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(DELIVERY_QUEUE) private readonly queue: Queue<DeliveryJob>,
  ) {}

  enqueue(deliveryId: string) {
    return this.queue.add(
      'deliver',
      { deliveryId },
      {
        jobId: `${deliveryId}-${Date.now()}`,
        attempts: config.maxAttempts(),
        backoff: { type: 'custom' },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    );
  }

  list(tenantId: string, query: ListDeliveriesQuery) {
    return this.prisma.delivery.findMany({
      where: { tenantId, status: query.status, endpointId: query.endpointId },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 50,
      include: {
        event: { select: { id: true, type: true } },
        endpoint: { select: { id: true, url: true } },
      },
    });
  }

  async get(tenantId: string, id: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id, tenantId },
      include: {
        event: true,
        endpoint: { select: { id: true, url: true, status: true } },
        attempts: { orderBy: { attemptNumber: 'asc' } },
      },
    });
    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }
    return delivery;
  }

  // Sends a finished delivery again with a fresh set of retries.
  async replay(tenantId: string, id: string) {
    const delivery = await this.get(tenantId, id);
    if (delivery.status === DeliveryStatus.PENDING || delivery.status === DeliveryStatus.RETRYING) {
      throw new ConflictException('Delivery is still in progress');
    }
    if (delivery.endpoint.status !== EndpointStatus.ACTIVE) {
      throw new BadRequestException('Enable the endpoint before replaying');
    }
    const updated = await this.prisma.delivery.update({
      where: { id },
      data: { status: DeliveryStatus.PENDING, nextAttemptAt: null, completedAt: null },
    });
    await this.enqueue(id);
    return updated;
  }

  // Replays everything in the dead letter queue for active endpoints.
  async replayDead(tenantId: string) {
    const dead = await this.prisma.delivery.findMany({
      where: { tenantId, status: DeliveryStatus.DEAD, endpoint: { status: EndpointStatus.ACTIVE } },
      select: { id: true },
      take: 1000,
    });
    const ids = dead.map((delivery) => delivery.id);
    await this.prisma.delivery.updateMany({
      where: { id: { in: ids } },
      data: { status: DeliveryStatus.PENDING, nextAttemptAt: null, completedAt: null },
    });
    await Promise.all(ids.map((id) => this.enqueue(id)));
    return { replayed: ids.length };
  }
}
