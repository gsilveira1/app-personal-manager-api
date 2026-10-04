import {
  describePlanFeatures,
  isPlanFeatureKey,
  PLAN_FEATURE_CATALOG,
  PlanFeatureKey,
} from "./plan-features";

describe("plan feature catalogue", () => {
  it("has exactly one entry per enum member", () => {
    const keys = PLAN_FEATURE_CATALOG.map((feature) => feature.key).sort();
    expect(keys).toEqual(Object.values(PlanFeatureKey).sort());
  });

  it("recognises catalogue keys only", () => {
    expect(isPlanFeatureKey("automated_pix")).toBe(true);
    expect(isPlanFeatureKey("max_students")).toBe(false);
    expect(isPlanFeatureKey(42)).toBe(false);
  });

  it("describes stored keys in catalogue order and skips retired ones", () => {
    const described = describePlanFeatures([
      "advanced_metrics",
      "retired_feature",
      "ai_whatsapp_bot",
    ]);
    expect(described.map((feature) => feature.key)).toEqual([
      PlanFeatureKey.AI_WHATSAPP_BOT,
      PlanFeatureKey.ADVANCED_METRICS,
    ]);
  });
});
