import { buildSmtpOptions } from "./smtp-options";

describe("buildSmtpOptions (review L8)", () => {
  it("development default: local Mailpit, no TLS, no auth (unchanged behaviour)", () => {
    expect(buildSmtpOptions({ NODE_ENV: "development" })).toEqual({
      host: "localhost",
      port: 1025,
      secure: false,
      ignoreTLS: true,
    });
  });

  it("an unset NODE_ENV is treated as non-production", () => {
    expect(buildSmtpOptions({})).toMatchObject({ ignoreTLS: true });
  });

  it("production never ignores TLS", () => {
    const options = buildSmtpOptions({
      NODE_ENV: "production",
      EMAIL_SMTP_HOST: "smtp.example.com",
      EMAIL_SMTP_PORT: "587",
    });

    expect(options).toEqual({
      host: "smtp.example.com",
      port: 587,
      secure: false,
    });
    expect(options).not.toHaveProperty("ignoreTLS");
  });

  it("production on port 465 defaults to implicit TLS", () => {
    expect(
      buildSmtpOptions({ NODE_ENV: "production", EMAIL_SMTP_PORT: "465" }),
    ).toMatchObject({ secure: true });
  });

  it.each([
    ["true", true],
    ["false", false],
  ])(
    "EMAIL_SMTP_SECURE=%s is honoured in every environment",
    (value, secure) => {
      for (const NODE_ENV of ["development", "production"]) {
        const options = buildSmtpOptions({
          NODE_ENV,
          EMAIL_SMTP_PORT: "465",
          EMAIL_SMTP_SECURE: value,
        });
        expect(options.secure).toBe(secure);
      }
    },
  );

  it("EMAIL_SMTP_SECURE=true switches ignoreTLS off outside production too", () => {
    expect(
      buildSmtpOptions({ NODE_ENV: "development", EMAIL_SMTP_SECURE: "true" }),
    ).not.toHaveProperty("ignoreTLS");
  });

  it("rejects an EMAIL_SMTP_SECURE that is not true/false", () => {
    expect(() => buildSmtpOptions({ EMAIL_SMTP_SECURE: "yes" })).toThrow(
      /EMAIL_SMTP_SECURE/,
    );
  });

  it("adds auth when user and password are set, and stops ignoring TLS", () => {
    const options = buildSmtpOptions({
      NODE_ENV: "development",
      EMAIL_SMTP_USER: "mailer",
      EMAIL_SMTP_PASSWORD: "s3cret",
    });

    expect(options.auth).toEqual({ user: "mailer", pass: "s3cret" });
    expect(options).not.toHaveProperty("ignoreTLS");
  });

  it.each([
    [{ EMAIL_SMTP_USER: "mailer" }],
    [{ EMAIL_SMTP_PASSWORD: "s3cret" }],
  ])("rejects half-configured credentials %j", (env) => {
    expect(() => buildSmtpOptions(env)).toThrow(
      /EMAIL_SMTP_USER and EMAIL_SMTP_PASSWORD/,
    );
  });
});
