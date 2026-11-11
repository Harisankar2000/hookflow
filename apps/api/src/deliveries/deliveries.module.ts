import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { DELIVERY_QUEUE } from './deliveries.constants';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';
import { DeliveryProcessor } from './delivery.processor';

@Module({
  imports: [BullModule.registerQueue({ name: DELIVERY_QUEUE })],
  controllers: [DeliveriesController],
  providers: [DeliveriesService, DeliveryProcessor],
  exports: [DeliveriesService],
})
export class DeliveriesModule {}
