import { ClientPaymentsService } from "./clients/client-payments.service";
import { ClientStoreService } from "./clients/client-store.service";
import { ClientsController } from "./clients/clients.controller";
import { ClientsService } from "./clients/clients.service";
import { LeadsService } from "./leads/leads.service";
import { FeatureCheckService } from "./plans/feature-check.service";
import { PlanFeaturesController } from "./plans/plan-features.controller";
import { PlansController } from "./plans/plans.controller";
import { PlansService } from "./plans/plans.service";
import { PublicCrmController } from "./public/public-crm.controller";

/** Shared by CrmModule and its wiring spec so the two cannot drift apart. */
export const CRM_CONTROLLERS = [
  ClientsController,
  PlansController,
  PlanFeaturesController,
  PublicCrmController,
];

export const CRM_PROVIDERS = [
  ClientStoreService,
  ClientsService,
  ClientPaymentsService,
  LeadsService,
  PlansService,
  FeatureCheckService,
];
