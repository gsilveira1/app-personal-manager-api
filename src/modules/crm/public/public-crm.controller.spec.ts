import { NotFoundException } from "@nestjs/common";

import { PublicCrmController } from "./public-crm.controller";

describe("PublicCrmController", () => {
  let controller: PublicCrmController;
  let leads: { create: jest.Mock };
  let plans: { findPublicByTrainer: jest.Mock };
  let users: { requireBySlug: jest.Mock };

  beforeEach(() => {
    leads = { create: jest.fn().mockResolvedValue({ id: "lead-1" }) };
    plans = {
      findPublicByTrainer: jest
        .fn()
        .mockResolvedValue({ presencial: [], consultoria: [] }),
    };
    users = { requireBySlug: jest.fn().mockResolvedValue({ id: "trainer-1" }) };
    controller = new PublicCrmController(
      leads as any,
      plans as any,
      users as any,
    );
  });

  it("POST /public/:slug/leads passes slug and body to the leads service", async () => {
    const dto = { name: "C", email: "c@x.com", phone: "1", interest: "online" };

    await expect(controller.createLead("vivi", dto as any)).resolves.toEqual({
      id: "lead-1",
    });
    expect(leads.create).toHaveBeenCalledWith("vivi", dto);
  });

  it("GET /public/:slug/plans resolves the trainer by slug", async () => {
    await controller.findPlans("vivi");

    expect(users.requireBySlug).toHaveBeenCalledWith("vivi");
    expect(plans.findPublicByTrainer).toHaveBeenCalledWith("trainer-1");
  });

  it("GET /public/:slug/plans answers 404 for an unknown slug", async () => {
    users.requireBySlug.mockRejectedValue(new NotFoundException());

    await expect(controller.findPlans("nobody")).rejects.toThrow(
      NotFoundException,
    );
    expect(plans.findPublicByTrainer).not.toHaveBeenCalled();
  });
});
