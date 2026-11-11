import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { config } from './config';
import { DeliveriesModule } from './deliveries/deliveries.module';
import { EndpointsModule } from './endpoints/endpoints.module';
import { EventsModule } from './events/events.module';
import { PrismaModule } from './prisma/prisma.module';
import { StatsModule } from './stats/stats.module';
import { TenantsModule } from './tenants/tenants.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRootAsync({ useFactory: () => ({ connection: config.redis() }) }),
    PrismaModule,
    TenantsModule,
    EndpointsModule,
    EventsModule,
    DeliveriesModule,
    StatsModule,
  ],
})
export class AppModule {}
