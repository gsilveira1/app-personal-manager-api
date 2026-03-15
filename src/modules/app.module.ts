import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { SessionsModule } from './sessions/sessions.module';
import { ClientsModule } from './clients/clients.module';
import { WorkoutsModule } from './workouts/workouts.module';
import { PlansModule } from './plans/plans.module';
import { SettingsModule } from './settings/settings.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { EvaluationsModule } from './evaluations/evaluations.module';
import { LeadsModule } from './leads/leads.module';
import { GcsModule } from './gcs/gcs.module';
import { AvailabilityBlocksModule } from './availability-blocks/availability-blocks.module';
import { SystemFeaturesModule } from './system-features/system-features.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
    UsersModule,
    PrismaModule,
    SessionsModule,
    EvaluationsModule,
    ClientsModule,
    WorkoutsModule,
    PlansModule,
    SettingsModule,
    LeadsModule,
    GcsModule,
    AvailabilityBlocksModule,
    SystemFeaturesModule
  ],
  controllers: [],
  providers: [],
})
export class AppModule { }