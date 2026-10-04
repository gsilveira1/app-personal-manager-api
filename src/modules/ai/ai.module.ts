import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { AiService } from "./ai.service";
import { AiController } from "./ai.controller";

/** Reads the trainer's `settings.aiInstructions` through USER_DIRECTORY (IdentityModule). */
@Module({
  imports: [IdentityModule],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
