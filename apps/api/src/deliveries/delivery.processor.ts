import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { DeliveryStatus, EndpointStatus } from '@prisma/client';
import { Job, UnrecoverableError } from 'bullmq';
import { config } from '../config';
import { sign, SIGNATURE_HEADER, TIMESTAMP_HEADER } from '../common/signature';
import { PrismaService } from '../prisma/prisma.service';
import { backoffDelay } from './backoff';
import { DELIVERY_QUEUE, DeliveryJob } from './deliveries.constants';

interface AttemptResult {
  statusCode: number | null;
  error: string | null;
  responseBody: string | null;
  durationMs: number;
}

@Processor(DELIVERY_QUEUE, {
  concurrency: 10,
  settings: { backoffStrategy: (attemptsMade: number) => backoffDelay(attemptsMade) },
})
export class DeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(DeliveryProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<DeliveryJob>) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: job.data.deliveryId },
      include: { endpoint: true, event: true },
    });
    if (!delivery || delivery.status === DeliveryStatus.SUCCEEDED) {
      return;
    }

    const { endpoint, event } = delivery;
    if (endpoint.status !== EndpointStatus.ACTIVE) {
      await this.prisma.delivery.update({
        where: { id: delivery.id },
        data: {
          status: DeliveryStatus.DEAD,
          nextAttemptAt: null,
          completedAt: new Date(),
          lastError: `Endpoint is ${endpoint.status.toLowerCase()}`,
        },
      });
      return;
    }

    const body = JSON.stringify({
      id: event.id,
      type: event.type,
      createdAt: event.createdAt.toISOString(),
      data: event.payload,
    });
    const result = await this.send(endpoint.url, endpoint.secret, delivery.id, event.type, body);
    const attemptNumber = delivery.attemptCount + 1;
    const attempt = {
      deliveryId: delivery.id,
      attemptNumber,
      statusCode: result.statusCode,
      durationMs: result.durationMs,
      error: result.error,
      responseBody: result.responseBody,
    };

    if (!result.error) {
      await this.prisma.$transaction([
        this.prisma.deliveryAttempt.create({ data: attempt }),
        this.prisma.delivery.update({
          where: { id: delivery.id },
          data: {
            status: DeliveryStatus.SUCCEEDED,
            attemptCount: attemptNumber,
            lastStatusCode: result.statusCode,
            lastError: null,
            nextAttemptAt: null,
            completedAt: new Date(),
          },
        }),
        this.prisma.endpoint.update({ where: { id: endpoint.id }, data: { consecutiveFailures: 0 } }),
      ]);
      return { statusCode: result.statusCode };
    }

    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    const tripped = await this.prisma.$transaction(async (tx) => {
      const failing = await tx.endpoint.update({
        where: { id: endpoint.id },
        data: { consecutiveFailures: { increment: 1 } },
      });
      // Circuit breaker: stop sending to an endpoint that keeps failing.
      const trip = failing.consecutiveFailures >= config.circuitBreakerThreshold();
      if (trip) {
        await tx.endpoint.update({
          where: { id: endpoint.id },
          data: { status: EndpointStatus.DISABLED, disabledAt: new Date() },
        });
      }
      const dead = isLastAttempt || trip;
      await tx.deliveryAttempt.create({ data: attempt });
      await tx.delivery.update({
        where: { id: delivery.id },
        data: {
          status: dead ? DeliveryStatus.DEAD : DeliveryStatus.RETRYING,
          attemptCount: attemptNumber,
          lastStatusCode: result.statusCode,
          lastError: result.error,
          nextAttemptAt: dead ? null : new Date(Date.now() + backoffDelay(job.attemptsMade + 1, false)),
          completedAt: dead ? new Date() : null,
        },
      });
      return trip;
    });

    if (tripped) {
      this.logger.warn(`Endpoint ${endpoint.id} disabled after repeated failures`);
    }
    if (isLastAttempt || tripped) {
      // Moves the job to the failed set without further retries (the dead letter queue).
      throw new UnrecoverableError(result.error);
    }
    throw new Error(result.error);
  }

  private async send(
    url: string,
    secret: string,
    deliveryId: string,
    eventType: string,
    body: string,
  ): Promise<AttemptResult> {
    const timestamp = Math.floor(Date.now() / 1000);
    const startedAt = Date.now();
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'HookFlow/0.1',
          'x-hookflow-delivery': deliveryId,
          'x-hookflow-event': eventType,
          [TIMESTAMP_HEADER]: String(timestamp),
          [SIGNATURE_HEADER]: sign(secret, timestamp, body),
        },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(config.deliveryTimeoutMs()),
      });
      const responseBody = (await response.text()).slice(0, 1000);
      return {
        statusCode: response.status,
        error: response.ok ? null : `HTTP ${response.status}`,
        responseBody,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const cause = error as Error & { cause?: { code?: string } };
      const message =
        cause.name === 'TimeoutError'
          ? `Timed out after ${config.deliveryTimeoutMs()}ms`
          : (cause.cause?.code ?? cause.message);
      return { statusCode: null, error: message, responseBody: null, durationMs: Date.now() - startedAt };
    }
  }
}
