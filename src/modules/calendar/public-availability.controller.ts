import { Controller, Get, Param, Query } from "@nestjs/common";

import { AvailableSlot } from "./calendar.types";
import { parsePublicRange } from "./date-range";
import { PublicAvailabilityService } from "./public-availability.service";

/** Longest window one unauthenticated request may ask for (contract A16). */
export const MAX_PUBLIC_RANGE_DAYS = 92;

/** Endpoint 59 — public, the trainer is the `:slug` path segment. */
@Controller("public/:slug")
export class PublicAvailabilityController {
  constructor(private readonly availability: PublicAvailabilityService) {}

  /**
   * GET /public/:slug/availability?start=2025-03-01&end=2025-03-31
   * Returns free time slots, never client details.
   */
  @Get("availability")
  getAvailableSlots(
    @Param("slug") slug: string,
    @Query("start") start?: string,
    @Query("end") end?: string,
  ): Promise<AvailableSlot[]> {
    const range = parsePublicRange(start, end, MAX_PUBLIC_RANGE_DAYS);
    return this.availability.findAvailableSlots(slug, range);
  }
}
