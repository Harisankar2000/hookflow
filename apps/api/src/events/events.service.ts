import { Injectable, NotFoundException } from '@nestjs/common';
import { EndpointStatus, Prisma } from '@prisma/client';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { PrismaService } from '../prisma/prisma.service';
import { PublishEventDto } from './events.dto';

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deliveries: DeliveriesService,
  ) {}

  async publish(tenantId: string, dto: PublishEventDto, idempotencyKey?: string) {
    if (idempotencyKey) {
      const existing = await this.findByIdempotencyKey(tenantId, idempotencyKey);
      if (existing) {
        return { duplicate: true, event: existing };
      }
    }

    let event;
    try {
      // The event and its deliveries are written together, so an event is never
      // stored without the rows that record who must receive it.
      event = await this.prisma.$transaction(async (tx) => {
        const created = await tx.event.create({
          data: { tenantId, type: dto.type, payload: dto.payload as Prisma.InputJsonValue, idempotencyKey },
        });
        const endpoints = await tx.endpoint.findMany({
          where: {
            tenantId,
            status: EndpointStatus.ACTIVE,
            OR: [{ eventTypes: { isEmpty: true } }, { eventTypes: { has: dto.type } }],
          },
          select: { id: true },
        });
        const deliveries = await tx.delivery.createManyAndReturn({
          data: endpoints.map((endpoint) => ({ tenantId, eventId: created.id, endpointId: endpoint.id })),
          select: { id: true, endpointId: true, status: true },
        });
        return { ...created, deliveries };
      });
    } catch (error) {
      // Two requests with the same key raced; the unique index let only one through.
      if (idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.findByIdempotencyKey(tenantId, idempotencyKey);
        if (existing) {
          return { duplicate: true, event: existing };
        }
      }
      throw error;
    }

    await Promise.all(event.deliveries.map((delivery) => this.deliveries.enqueue(delivery.id)));
    return { duplicate: false, event };
  }

  list(tenantId: string) {
    return this.prisma.event.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { _count: { select: { deliveries: true } } },
    });
  }

  async get(tenantId: string, id: string) {
    const event = await this.prisma.event.findFirst({
      where: { id, tenantId },
      include: { deliveries: { include: { endpoint: { select: { id: true, url: true } } } } },
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  private findByIdempotencyKey(tenantId: string, idempotencyKey: string) {
    return this.prisma.event.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
      include: { deliveries: { select: { id: true, endpointId: true, status: true } } },
    });
  }
}
