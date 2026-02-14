import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { SessionsModule } from './sessions/sessions.module';
import { FinancesModule } from './finances/finances.module';
import { ClientsModule } from './clients/clients.module';
import { WorkoutsModule } from './workouts/workouts.module';
import { PlansModule } from './plans/plans.module';
import { SettingsModule } from './settings/settings.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { EvaluationsModule } from './evaluations/evaluations.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
    UsersModule,
    PrismaModule,
    SessionsModule,
    FinancesModule,
    EvaluationsModule,
    ClientsModule,
    WorkoutsModule,
    PlansModule,
    SettingsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}