import { Module } from "@nestjs/common";
import { ANAMNESIS_REQUESTER } from "../../common/ports";
import { ClientDirectoryModule } from "../crm/client-directory.module";
import { IdentityModule } from "../identity/identity.module";
import { MessagingModule } from "../messaging/messaging.module";
import { AnamnesisController } from "./anamnesis.controller";
import { AnamnesisService } from "./anamnesis.service";
import { EvaluationsCalculatorService } from "./evaluations-calculator.service";
import { EvaluationsController } from "./evaluations.controller";
import { EvaluationsService } from "./evaluations.service";

/**
 * Anamneses and physical evaluations. Owns Assessment; provides ANAMNESIS_REQUESTER.
 * Contract: docs/api-contract-v2.md, section 6.5.
 */
@Module({
  imports: [IdentityModule, ClientDirectoryModule, MessagingModule],
  controllers: [EvaluationsController, AnamnesisController],
  providers: [
    EvaluationsService,
    EvaluationsCalculatorService,
    AnamnesisService,
    { provide: ANAMNESIS_REQUESTER, useExisting: AnamnesisService },
  ],
  exports: [ANAMNESIS_REQUESTER],
})
export class HealthModule {}
