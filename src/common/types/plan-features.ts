/**
 * Catalogue of sellable plan features. Replaces the SystemFeature and PlanFeature
 * tables: `Plan.features` stores these keys in a String[] column.
 *
 * Adding a feature = adding an enum member and a catalogue entry (code change, no migration).
 */
export enum PlanFeatureKey {
  AI_WHATSAPP_BOT = "ai_whatsapp_bot",
  VIDEO_EXERCISE_UPLOAD = "video_exercise_upload",
  AUTOMATED_PIX = "automated_pix",
  POSTURE_CORRECTION = "posture_correction",
  ADVANCED_METRICS = "advanced_metrics",
}

export interface PlanFeatureDescriptor {
  key: PlanFeatureKey;
  /** Display name (pt-BR). */
  name: string;
  description: string;
}

export const PLAN_FEATURE_CATALOG: readonly PlanFeatureDescriptor[] = [
  {
    key: PlanFeatureKey.AI_WHATSAPP_BOT,
    name: "Assistente WhatsApp com IA",
    description:
      "Responde dúvidas e envia lembretes inteligentes para os alunos.",
  },
  {
    key: PlanFeatureKey.VIDEO_EXERCISE_UPLOAD,
    name: "Vídeos Customizados de Exercícios",
    description: "Permite anexar vídeos gravados pelo personal nos treinos.",
  },
  {
    key: PlanFeatureKey.AUTOMATED_PIX,
    name: "Cobrança Automática via PIX",
    description: "Gera QR Code dinâmico do MercadoPago/Asaas.",
  },
  {
    key: PlanFeatureKey.POSTURE_CORRECTION,
    name: "Módulo de Avaliação Postural",
    description: "Gera relatório de desvios posturais e assimetrias.",
  },
  {
    key: PlanFeatureKey.ADVANCED_METRICS,
    name: "Métricas Avançadas de Carga (1RM & Volume Load)",
    description: "Dashboard com gráficos de tonelagem e progressão.",
  },
];

export const PLAN_FEATURE_KEYS: readonly PlanFeatureKey[] =
  PLAN_FEATURE_CATALOG.map((feature) => feature.key);

/**
 * @example
 * isPlanFeatureKey("automated_pix") // true
 */
export function isPlanFeatureKey(value: unknown): value is PlanFeatureKey {
  return (
    typeof value === "string" &&
    (PLAN_FEATURE_KEYS as readonly string[]).includes(value)
  );
}

/**
 * Maps stored keys to catalogue entries, in catalogue order. Keys that are no longer
 * in the catalogue (a retired feature still stored on an old plan) are left out.
 *
 * @example
 * describePlanFeatures(["automated_pix"])[0].name // "Cobrança Automática via PIX"
 */
export function describePlanFeatures(
  keys: readonly string[],
): PlanFeatureDescriptor[] {
  return PLAN_FEATURE_CATALOG.filter((feature) => keys.includes(feature.key));
}
