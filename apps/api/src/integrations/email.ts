import { Resend } from "resend";

import { log } from "../log.js";

/** Email delivery input shared by authentication and monitoring. */
export interface SendEmailInput {
  html: string;
  idempotencyKey: string;
  subject: string;
  text: string;
  to: string | string[];
}

/** Minimal email-delivery boundary used by FinePredict services. */
export interface EmailService {
  configured: boolean;
  send(input: SendEmailInput): Promise<void>;
}

/** Resend-backed production email delivery. */
export class ResendEmailService implements EmailService {
  public readonly configured: boolean;
  private readonly client: Resend | null;

  /**
   * Creates a Resend email service that remains disabled without a key.
   *
   * @param apiKey - Optional Resend API key.
   * @param fromEmail - Verified Resend sender identity.
   */
  public constructor(
    apiKey: string | null,
    private readonly fromEmail: string,
  ) {
    this.configured = Boolean(apiKey);
    this.client = apiKey ? new Resend(apiKey) : null;
  }

  /** @inheritdoc */
  public async send(input: SendEmailInput): Promise<void> {
    if (!this.client) {
      throw new Error(`FinePredict email: RESEND_API_KEY is not configured.`);
    }
    const result = await this.client.emails.send(
      {
        from: this.fromEmail,
        html: input.html,
        subject: input.subject,
        text: input.text,
        to: input.to,
      },
      { idempotencyKey: input.idempotencyKey },
    );
    if (result.error) {
      throw new Error(`FinePredict email: ${result.error.message}`);
    }
    log("ResendEmailService.send", `Delivered email through Resend.`, {
      emailId: result.data?.id ?? null,
      subject: input.subject,
    });
  }
}
