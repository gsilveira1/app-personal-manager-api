import { MODULE_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import {
  ANAMNESIS_REQUESTER,
  CLIENT_DIRECTORY,
  NOTIFICATION_SENDER,
  USER_DIRECTORY,
} from "../../common/ports";
import { ClientDirectoryModule } from "../crm/client-directory.module";
import { IdentityModule } from "../identity/identity.module";
import { MessagingModule } from "../messaging/messaging.module";
import { PrismaService } from "../prisma/prisma.service";
import { AnamnesisController } from "./anamnesis.controller";
import { AnamnesisService } from "./anamnesis.service";
import { EvaluationsController } from "./evaluations.controller";
import { HealthModule } from "./health.module";

// The sibling modules belong to other streams; only their class identity matters here.
jest.mock("../crm/client-directory.module", () => ({
  ClientDirectoryModule: class ClientDirectoryModule {},
}));
jest.mock("../identity/identity.module", () => ({
  IdentityModule: class IdentityModule {},
}));
jest.mock("../messaging/messaging.module", () => ({
  MessagingModule: class MessagingModule {},
}));

const metadata = (key: string) => Reflect.getMetadata(key, HealthModule);

describe("HealthModule", () => {
  it("imports only the modules the dependency DAG allows", () => {
    expect(metadata(MODULE_METADATA.IMPORTS)).toEqual([
      IdentityModule,
      ClientDirectoryModule,
      MessagingModule,
    ]);
  });

  it("exports ANAMNESIS_REQUESTER and nothing else", () => {
    expect(metadata(MODULE_METADATA.EXPORTS)).toEqual([ANAMNESIS_REQUESTER]);
  });

  it("resolves its controllers and providers once the consumed ports are provided", async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: metadata(MODULE_METADATA.CONTROLLERS),
      providers: [
        ...metadata(MODULE_METADATA.PROVIDERS),
        { provide: PrismaService, useValue: {} },
        { provide: CLIENT_DIRECTORY, useValue: {} },
        { provide: USER_DIRECTORY, useValue: {} },
        { provide: NOTIFICATION_SENDER, useValue: {} },
      ],
    }).compile();

    expect(moduleRef.get(EvaluationsController)).toBeDefined();
    expect(moduleRef.get(AnamnesisController)).toBeDefined();
    expect(moduleRef.get(ANAMNESIS_REQUESTER)).toBe(
      moduleRef.get(AnamnesisService),
    );
  });
});
