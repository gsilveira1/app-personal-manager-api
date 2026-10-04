import { Test } from "@nestjs/testing";

import {
  CLIENT_DIRECTORY,
  USER_DIRECTORY,
  WORKOUT_SHEET_READER,
} from "../../common/ports";
import { PrismaService } from "../prisma/prisma.service";
import { AvailabilityBlocksController } from "./availability-blocks.controller";
import { AvailabilityBlocksService } from "./availability-blocks.service";
import { ConflictDetectorService } from "./conflict-detector.service";
import { PublicAvailabilityController } from "./public-availability.controller";
import { PublicAvailabilityService } from "./public-availability.service";
import { SessionExceptionsService } from "./session-exceptions.service";
import { SessionOccurrencesService } from "./session-occurrences.service";
import { SessionWorkoutsService } from "./session-workouts.service";
import { SessionsController } from "./sessions.controller";
import { SessionsService } from "./sessions.service";

/**
 * Resolves the providers CalendarModule declares against stubbed ports, so that a
 * missing `@Inject(TOKEN)` or provider fails here and not at application start-up.
 * CalendarModule itself is not imported: it pulls the other streams' modules.
 */
describe("calendar module wiring", () => {
  it("should resolve every controller with only the three ports and PrismaService from outside", async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        SessionsController,
        AvailabilityBlocksController,
        PublicAvailabilityController,
      ],
      providers: [
        SessionsService,
        SessionOccurrencesService,
        SessionExceptionsService,
        SessionWorkoutsService,
        ConflictDetectorService,
        AvailabilityBlocksService,
        PublicAvailabilityService,
        { provide: PrismaService, useValue: {} },
        { provide: USER_DIRECTORY, useValue: {} },
        { provide: CLIENT_DIRECTORY, useValue: {} },
        { provide: WORKOUT_SHEET_READER, useValue: {} },
      ],
    }).compile();

    expect(moduleRef.get(SessionsController)).toBeInstanceOf(
      SessionsController,
    );
    expect(moduleRef.get(AvailabilityBlocksController)).toBeInstanceOf(
      AvailabilityBlocksController,
    );
    expect(moduleRef.get(PublicAvailabilityController)).toBeInstanceOf(
      PublicAvailabilityController,
    );
  });
});
