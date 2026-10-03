import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TenantsController } from "./tenants.controller";
import { TenantsService } from "./tenants.service";
import { PrismaModule } from "../prisma/prisma.module";
import { MessagingModule } from "../messaging/messaging.module";

@Module({
  imports: [PrismaModule, ConfigModule, MessagingModule],
  controllers: [TenantsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
