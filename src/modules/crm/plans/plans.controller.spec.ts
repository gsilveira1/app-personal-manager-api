import { PLAN_FEATURE_CATALOG } from "../../../common/types";
import { PlanFeaturesController } from "./plan-features.controller";
import { PlansController } from "./plans.controller";

describe("PlansController", () => {
  const userId = "trainer-1";
  let plans: Record<string, jest.Mock>;
  let controller: PlansController;

  beforeEach(() => {
    plans = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    controller = new PlansController(plans as any);
  });

  it("delegates every route to the service with the user id", async () => {
    const dto = { type: "PRESENCIAL", name: "P", sessionsPerWeek: 1, price: 1 };

    await controller.create(userId, dto as any);
    await controller.findAll(userId);
    await controller.findOne(userId, "plan-1");
    await controller.update(userId, "plan-1", { price: 2 });
    await controller.remove(userId, "plan-1");

    expect(plans.create).toHaveBeenCalledWith(userId, dto);
    expect(plans.findAll).toHaveBeenCalledWith(userId);
    expect(plans.findOne).toHaveBeenCalledWith(userId, "plan-1");
    expect(plans.update).toHaveBeenCalledWith(userId, "plan-1", { price: 2 });
    expect(plans.remove).toHaveBeenCalledWith(userId, "plan-1");
  });
});

describe("PlanFeaturesController", () => {
  it("returns the code catalogue as { key, name, description }", () => {
    const features = new PlanFeaturesController().findAll();

    expect(features).toEqual([...PLAN_FEATURE_CATALOG]);
    expect(features).toHaveLength(5);
    expect(Object.keys(features[0]).sort()).toEqual([
      "description",
      "key",
      "name",
    ]);
  });
});
