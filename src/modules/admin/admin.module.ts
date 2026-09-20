import { Module } from "@nestjs/common";
import { AdminTenantsService } from "./admin-tenants.service";
import { AdminTenantsController } from "./admin-tenants.controller";

@Module({
  controllers: [AdminTenantsController],
  providers: [AdminTenantsService],
  exports: [AdminTenantsService],
})
export class AdminModule {}
