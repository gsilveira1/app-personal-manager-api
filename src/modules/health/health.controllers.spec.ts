import { GUARDS_METADATA } from "@nestjs/common/constants";
import { JwtAuthGuard } from "../../common/auth";
import { AnamnesisController, magicTokenOf } from "./anamnesis.controller";
import { EvaluationsController } from "./evaluations.controller";

const guardsOf = (target: object): unknown[] =>
  Reflect.getMetadata(GUARDS_METADATA, target) ?? [];

describe("EvaluationsController", () => {
  const service = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const controller = new EvaluationsController(service as any);

  it("protects every route with the JWT guard", () => {
    expect(guardsOf(EvaluationsController)).toEqual([JwtAuthGuard]);
  });

  it("passes the authenticated user id to the service", async () => {
    const dto = { clientId: "c-1", date: "2026-10-03", weight: 65 };
    await controller.create("user-1", dto);
    await controller.findAll("user-1");
    await controller.findOne("user-1", "e-1");
    await controller.update("user-1", "e-1", { weight: 64 });
    await controller.remove("user-1", "e-1");

    expect(service.create).toHaveBeenCalledWith("user-1", dto);
    expect(service.findAll).toHaveBeenCalledWith("user-1");
    expect(service.findOne).toHaveBeenCalledWith("user-1", "e-1");
    expect(service.update).toHaveBeenCalledWith("user-1", "e-1", {
      weight: 64,
    });
    expect(service.remove).toHaveBeenCalledWith("user-1", "e-1");
  });
});

describe("AnamnesisController", () => {
  const service = {
    getFormMetadata: jest.fn(),
    submit: jest.fn(),
    listForClient: jest.fn(),
    createMagicLink: jest.fn(),
    requestReassessment: jest.fn(),
  };
  const controller = new AnamnesisController(service as any);
  const proto = AnamnesisController.prototype;

  afterEach(() => jest.clearAllMocks());

  it("keeps the student routes public (magic token only)", () => {
    expect(guardsOf(AnamnesisController)).toEqual([]);
    expect(guardsOf(proto.getFormMetadata)).toEqual([]);
    expect(guardsOf(proto.submit)).toEqual([]);
  });

  it("protects the trainer routes with the JWT guard", () => {
    expect(guardsOf(proto.listForClient)).toEqual([JwtAuthGuard]);
    expect(guardsOf(proto.createMagicLink)).toEqual([JwtAuthGuard]);
    expect(guardsOf(proto.requestReassessment)).toEqual([JwtAuthGuard]);
  });

  it("reads the magic token from the query string", async () => {
    await controller.getFormMetadata("abc", undefined);
    expect(service.getFormMetadata).toHaveBeenCalledWith("abc");
  });

  it("falls back to the Authorization bearer header", async () => {
    await controller.getFormMetadata(undefined, "Bearer abc");
    expect(service.getFormMetadata).toHaveBeenCalledWith("abc");
  });

  it("delegates the trainer routes with the authenticated user id", async () => {
    await controller.submit({ token: "abc" });
    await controller.listForClient("user-1", "c-1");
    await controller.createMagicLink("user-1", "c-1");
    await controller.requestReassessment("user-1", "c-1");

    expect(service.submit).toHaveBeenCalledWith({ token: "abc" });
    expect(service.listForClient).toHaveBeenCalledWith("user-1", "c-1");
    expect(service.createMagicLink).toHaveBeenCalledWith("user-1", "c-1");
    expect(service.requestReassessment).toHaveBeenCalledWith("user-1", "c-1");
  });
});

describe("magicTokenOf", () => {
  it("prefers the query token", () => {
    expect(magicTokenOf("q", "Bearer h")).toBe("q");
  });

  it("returns undefined when neither carries a token", () => {
    expect(magicTokenOf(undefined, undefined)).toBeUndefined();
    expect(magicTokenOf("", "Basic abc")).toBeUndefined();
    expect(magicTokenOf(["a", "b"], undefined)).toBeUndefined();
  });
});
