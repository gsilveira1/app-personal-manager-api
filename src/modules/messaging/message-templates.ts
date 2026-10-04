import {
  NotificationTemplate,
  NotificationTemplateParams,
} from "../../common/types";

const TEMPLATES: Record<
  NotificationTemplate,
  (params: NotificationTemplateParams) => string
> = {
  WELCOME_ANAMNESIS: ({ name, link }) =>
    `Olá, ${name}! Seja bem-vindo à minha consultoria fitness. Para começarmos, preencha sua anamnese de saúde aqui: ${link ?? ""}.`,
  WORKOUT_LINK: ({ name, link }) =>
    `Fala, ${name}! Sua nova ficha de treinos está pronta. Acesse aqui: ${link ?? ""}.`,
  EXPIRATION_ALERT: ({ name }) =>
    `Olá, ${name}! Sua ficha atual está chegando ao fim. Em breve enviarei sua nova periodização!`,
};

/**
 * Renders the text of a notification. Deterministic: a retried job sends the same text.
 *
 * @throws {Error} When the template is unknown (a job produced by a newer or corrupted payload)
 *
 * @example
 * formatMessage("WORKOUT_LINK", { name: "Ana", link: "https://app/p/ana?token=..." })
 */
export function formatMessage(
  templateType: NotificationTemplate,
  params: NotificationTemplateParams,
): string {
  const render = TEMPLATES[templateType];
  if (!render) {
    throw new Error(`Unknown notification template: ${String(templateType)}`);
  }
  return render(params);
}
