import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";

import { USER_DIRECTORY, UserDirectory } from "../../../common/ports";
import { CreateLeadDto } from "../leads/create-lead.dto";
import { LeadsService } from "../leads/leads.service";
import { PublicPlans } from "../plans/plan.views";
import { PlansService } from "../plans/plans.service";

/**
 * Unauthenticated routes of the marketing site. The trainer is the `:slug` path
 * segment (`User.slug`); an unknown slug answers 404.
 */
@Controller("public/:slug")
export class PublicCrmController {
  constructor(
    private readonly leads: LeadsService,
    private readonly plans: PlansService,
    @Inject(USER_DIRECTORY) private readonly users: UserDirectory,
  ) {}

  @Post("leads")
  createLead(
    @Param("slug") slug: string,
    @Body() dto: CreateLeadDto,
  ): Promise<{ id: string }> {
    return this.leads.create(slug, dto);
  }

  @Get("plans")
  async findPlans(@Param("slug") slug: string): Promise<PublicPlans> {
    const trainer = await this.users.requireBySlug(slug);
    return this.plans.findPublicByTrainer(trainer.id);
  }
}
