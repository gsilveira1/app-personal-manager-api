import { formatMessage } from "./message-templates";

describe("formatMessage", () => {
  it("formats WELCOME_ANAMNESIS with name and link", () => {
    expect(
      formatMessage("WELCOME_ANAMNESIS", {
        name: "Carlos",
        link: "https://viviops.app/anamnesis/123",
      }),
    ).toBe(
      "Olá, Carlos! Seja bem-vindo à minha consultoria fitness. Para começarmos, preencha sua anamnese de saúde aqui: https://viviops.app/anamnesis/123.",
    );
  });

  it("formats WORKOUT_LINK with name and link", () => {
    expect(
      formatMessage("WORKOUT_LINK", {
        name: "Mariana",
        link: "https://viviops.app/workouts/456",
      }),
    ).toBe(
      "Fala, Mariana! Sua nova ficha de treinos está pronta. Acesse aqui: https://viviops.app/workouts/456.",
    );
  });

  it("formats EXPIRATION_ALERT with the name only", () => {
    const text = formatMessage("EXPIRATION_ALERT", { name: "Lucas" });
    expect(text).toContain("Lucas");
    expect(text).toContain("periodização");
  });

  it("throws on an unknown template instead of sending a generic text", () => {
    expect(() => formatMessage("NOPE" as never, { name: "X" })).toThrow(
      "Unknown notification template: NOPE",
    );
  });
});
