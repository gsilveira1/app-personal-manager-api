import { DEFAULT_ACCOUNT_LIMITS, DEFAULT_DND } from "../../common/types";
import { buildUser } from "./testing";
import { toAdminUserView, toTrainerProfile, toUserView } from "./user-view";

describe("user views", () => {
  it("toUserView never exposes the password", () => {
    const view = toUserView(buildUser());
    expect(view).not.toHaveProperty("password");
    expect(JSON.stringify(view)).not.toContain("hashedpassword");
  });

  it("toUserView carries the account fields and resolved settings", () => {
    const view = toUserView(
      buildUser({ settings: { language: "en" }, setupCompleted: true }),
    );
    expect(view).toMatchObject({
      id: "user-uuid-1",
      email: "joao@example.com",
      role: "trainer",
      status: "ACTIVE",
      slug: "joao-silva",
      whatsappStatus: "PENDING",
      setupCompleted: true,
    });
    expect(view.settings.language).toBe("en");
    expect(view.settings.dnd).toEqual(DEFAULT_DND);
  });

  it("toUserView resolves defaults when settings is null", () => {
    expect(toUserView(buildUser({ settings: null })).settings.language).toBe(
      "pt-BR",
    );
  });

  it("toAdminUserView exposes limits and the student count, not the password", () => {
    const view = toAdminUserView(
      buildUser({
        settings: { limits: { ...DEFAULT_ACCOUNT_LIMITS, maxStudents: 5 } },
      }),
      7,
    );
    expect(view).toEqual({
      id: "user-uuid-1",
      name: "João Silva",
      email: "joao@example.com",
      slug: "joao-silva",
      role: "trainer",
      status: "ACTIVE",
      studentsCount: 7,
      limits: { maxStudents: 5, canUploadVideos: true, whatsappAlerts: true },
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
  });

  it("toTrainerProfile defaults the primary colour", () => {
    const profile = toTrainerProfile(buildUser({ primaryColor: null }));
    expect(profile).toEqual({
      id: "user-uuid-1",
      name: "João Silva",
      phone: null,
      slug: "joao-silva",
      status: "ACTIVE",
      primaryColor: "#10B981",
      logoUrl: null,
    });
  });
});
