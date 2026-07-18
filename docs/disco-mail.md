# Disco Mail API

`disco.mail` is a server-side TypeScript client for the hosted Disco Mail API. It is available from the package's main entry point and is intentionally excluded from `@discomedia/utils/frontend` so API keys are never bundled for browsers.

## Configure a key

Set one of these server-side environment variables. The client checks them in this order:

```bash
DISCO_MAIL_API_KEY="us_xxx"
DISCOMAIL_API_KEY="us_xxx" # legacy fallback
```

The production API root is `https://mail.discomedia.co/api/v1`. Pass `baseUrl` only when using a compatible non-production API root.

## Send email

```ts
import { disco } from "@discomedia/utils";

const result = await disco.mail.send(
  {
    to: "customer@example.net",
    from: "Disco Media <hello@discomedia.co>",
    subject: "Welcome",
    html: "<p>Welcome to Disco Media.</p>",
    text: "Welcome to Disco Media.",
  },
  {
    idempotencyKey: "welcome:user_123",
  },
);

console.log(result.emailId);
```

`to`, `from`, and at least one of `html` or `text` are required. Send either a non-empty `subject` or a `templateId`. The sender must use a verified domain that the API key can access. Attachments support up to 10 entries with a filename and base64 content.

For a one-off key or a compatible staging API, pass it as request options:

```ts
await disco.mail.send(
  {
    to: "customer@example.net",
    from: "Disco Media <hello@discomedia.co>",
    subject: "Receipt",
    text: "Thanks for your order.",
  },
  {
    apiKey: "us_xxx",
    baseUrl: "https://mail-staging.example.com/api/v1",
    idempotencyKey: "receipt:order_123",
  },
);
```

Use an idempotency key for transactional sends that may be retried. Reusing it with the same request returns the original email; reusing it with a different request is rejected by the API.

## Domain helpers

```ts
const domains = await disco.mail.listDomains();
const domain = await disco.mail.getDomain(domains[0].id);

const created = await disco.mail.createDomain({
  name: "mail.example.com",
  region: "us-east-1",
});

await disco.mail.verifyDomain(created.id);
```

After creating a domain, publish its returned DNS records and wait for its status to become `SUCCESS` before sending. Domain-scoped API keys only return and operate on their permitted domain.

## Errors

API failures throw `DiscoMailApiError`, with `code`, `status`, and a human-readable message. A missing key fails before a network request with instructions to pass `options.apiKey` or configure one of the supported environment variables.
