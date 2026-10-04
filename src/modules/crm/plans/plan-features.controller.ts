import { Controller, Get, UseGuards } from "@nestjs/common";

import { JwtAuthGuard } from "../../../common/auth";
import {
  PLAN_FEATURE_CATALOG,
  PlanFeatureDescriptor,
} from "../../../common/types";

/** Catalogue of sellable plan features (replaces `/system-features`). */
@UseGuards(JwtAuthGuard)
@Controller("plan-features")
export class PlanFeaturesController {
  @Get()
  findAll(): PlanFeatureDescriptor[] {
    return [...PLAN_FEATURE_CATALOG];
  }
}
