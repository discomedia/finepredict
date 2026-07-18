import { describe, expect, it, vi } from "vitest";

import { DiscoMailEmailService, type DiscoMailClient } from "./email.js";

/**
 * Creates a typed Disco Mail fake around one send function.
 *
 * @param send - Send implementation to expose through the client boundary.
 * @returns Disco Mail client suitable for an email-service unit test.
 */
function createDiscoMailClient(send: DiscoMailClient["send"]): DiscoMailClient {
  return { send };
}

describe("Disco Mail email delivery", () => {
  it("sends from the configured FinePredict identity with idempotency", async () => {
    const send = vi.fn<DiscoMailClient["send"]>().mockResolvedValue({
      emailId: "email_test",
    });
    const service = new DiscoMailEmailService(
      "us_test",
      "FinePredict <hello@fp.discomedia.co>",
      createDiscoMailClient(send),
    );

    await service.send({
      html: "<p>Hello</p>",
      idempotencyKey: "finepredict-test",
      subject: "FinePredict test",
      text: "Hello",
      to: "reader@example.com",
    });

    expect(service.configured).toBe(true);
    expect(send).toHaveBeenCalledWith(
      {
        from: "FinePredict <hello@fp.discomedia.co>",
        html: "<p>Hello</p>",
        subject: "FinePredict test",
        text: "Hello",
        to: "reader@example.com",
      },
      { apiKey: "us_test", idempotencyKey: "finepredict-test" },
    );
  });

  it("fails clearly when Disco Mail is not configured", async () => {
    const service = new DiscoMailEmailService(
      null,
      "FinePredict <hello@fp.discomedia.co>",
      createDiscoMailClient(vi.fn<DiscoMailClient["send"]>()),
    );

    await expect(
      service.send({
        html: "<p>Hello</p>",
        idempotencyKey: "finepredict-test",
        subject: "FinePredict test",
        text: "Hello",
        to: "reader@example.com",
      }),
    ).rejects.toThrow(/DISCO_MAIL_API_KEY/);
  });
});
