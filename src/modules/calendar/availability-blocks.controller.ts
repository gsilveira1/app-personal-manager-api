import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import { CurrentUserId, JwtAuthGuard } from "../../common/auth";
import { AvailabilityBlocksService } from "./availability-blocks.service";
import { BlockView, MaterializedBlock } from "./calendar.types";
import { parseRequiredRange } from "./date-range";
import {
  CreateAvailabilityBlockDto,
  UpdateAvailabilityBlockDto,
} from "./dto/availability-block.dto";

/** Endpoints 66–69. `:id` is the stored block's UUID (`MaterializedBlock.blockId`). */
@UseGuards(JwtAuthGuard)
@Controller("availability-blocks")
export class AvailabilityBlocksController {
  constructor(private readonly service: AvailabilityBlocksService) {}

  @Post()
  create(
    @CurrentUserId() userId: string,
    @Body() dto: CreateAvailabilityBlockDto,
  ): Promise<BlockView> {
    return this.service.create(userId, dto);
  }

  /** GET /availability-blocks?start=2025-03-01&end=2025-03-31 — both bounds required. */
  @Get()
  findAll(
    @CurrentUserId() userId: string,
    @Query("start") start?: string,
    @Query("end") end?: string,
  ): Promise<MaterializedBlock[]> {
    const range = parseRequiredRange(start, end);
    return this.service.findAllForRange(userId, range.start, range.end);
  }

  @Patch(":id")
  update(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body() dto: UpdateAvailabilityBlockDto,
  ): Promise<BlockView> {
    return this.service.update(userId, id, dto);
  }

  @Delete(":id")
  remove(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
  ): Promise<BlockView> {
    return this.service.remove(userId, id);
  }
}
