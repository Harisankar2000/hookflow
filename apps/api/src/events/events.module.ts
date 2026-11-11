import { Module } from '@nestjs/common';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [DeliveriesModule],
  controllers: [EventsController],
  providers: [EventsService],
})
export class EventsModule {}
