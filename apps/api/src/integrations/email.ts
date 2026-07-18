import { disco } from "@discomedia/utils";

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

/** Minimal Disco Mail client contract used for dependency-safe tests. */
export interface DiscoMailClient {
  send(
    input: {
      from: string;
      html: string;
      subject: string;
      text: string;
      to: string | string[];
    },
    options: { apiKey: string; idempotencyKey: string },
  ): Promise<{ emailId: string }>;
}

/** Disco Mail-backed production email delivery. */
export class DiscoMailEmailService implements EmailService {
  public readonly configured: boolean;

  /**
   * Creates a Disco Mail service that remains disabled without a key.
   *
   * @param apiKey - Optional Disco Mail API key.
   * @param fromEmail - Verified Disco Mail sender identity.
   * @param client - Disco Mail client implementation.
   */
  public constructor(
    private readonly apiKey: string | null,
    private readonly fromEmail: string,
    private readonly client: DiscoMailClient = disco.mail,
  ) {
    this.configured = Boolean(apiKey);
  }

  /** @inheritdoc */
  public async send(input: SendEmailInput): Promise<void> {
    if (!this.apiKey) {
      throw new Error(
        `FinePredict email: DISCO_MAIL_API_KEY is not configured.`,
      );
    }
    const result = await this.client.send(
      {
        from: this.fromEmail,
        html: input.html,
        subject: input.subject,
        text: input.text,
        to: input.to,
      },
      { apiKey: this.apiKey, idempotencyKey: input.idempotencyKey },
    );
    log("DiscoMailEmailService.send", `Delivered email through Disco Mail.`, {
      emailId: result.emailId,
      subject: input.subject,
    });
  }
}
