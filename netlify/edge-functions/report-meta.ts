import type { Context } from "@netlify/edge-functions";

/** Public report fields required to render social and structured metadata. */
interface MetadataReport {
  createdAt: string;
  markets: Array<{
    contract: { title: string; url: string };
    summary: { plainEnglish: string };
  }>;
  slug: string;
}

/** Public dispute fields required to render social and structured metadata. */
interface MetadataDispute {
  disputedWording: string;
  marketUrl: string;
  publishedAt: string | null;
  slug: string;
  title: string;
}

/** Metadata block markers shared with the SPA document. */
const METADATA_BLOCK_PATTERN =
  /<!-- finepredict:meta:start -->[\s\S]*?<!-- finepredict:meta:end -->/;

/**
 * Escapes a value for safe HTML attribute rendering.
 *
 * @param value - Untrusted metadata value.
 * @returns HTML-escaped text.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Produces a compact single-line social description.
 *
 * @param value - Source summary or disputed wording.
 * @returns Whitespace-normalized description capped for social previews.
 */
function createMetadataDescription(value: string): string {
  const description = value.replace(/\s+/g, " ").trim();
  return description.length > 220
    ? `${description.slice(0, 217).trimEnd()}…`
    : description;
}

/**
 * Creates semantic HTML that is present before the React application loads.
 *
 * @param heading - Plain-language question answered by the page.
 * @param title - Market or dispute title.
 * @param description - Verifiable contract summary or disputed wording.
 * @returns A crawler-visible article that React replaces when it mounts.
 */
function createPrerenderedArticle(
  heading: string,
  title: string,
  description: string,
): string {
  return `<article aria-label="FinePredict contract summary">
      <p>FinePredict</p>
      <h1>${escapeHtml(heading)}</h1>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(description)}</p>
    </article>`;
}

/**
 * Creates report-specific HTML metadata.
 *
 * @param report - Public FinePredict report.
 * @param canonicalUrl - Absolute canonical report URL.
 * @returns Canonical, social, and JSON-LD metadata markup.
 */
function createReportMetadata(
  report: MetadataReport,
  canonicalUrl: string,
): string {
  const title = report.markets
    .map((market) => market.contract.title)
    .join(" vs ");
  const description = createMetadataDescription(
    report.markets[0]?.summary.plainEnglish ??
      "Prediction-market contract terms, sources and deadlines.",
  );
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "AnalysisNewsArticle",
    headline: title,
    description,
    datePublished: report.createdAt,
    dateModified: report.createdAt,
    mainEntityOfPage: canonicalUrl,
    author: { "@type": "Organization", name: "FinePredict" },
    isBasedOn: report.markets.map((market) => market.contract.url),
  }).replaceAll("<", "\\u003c");
  const escapedTitle = escapeHtml(`${title} — FinePredict`);
  const escapedDescription = escapeHtml(description);
  const escapedCanonicalUrl = escapeHtml(canonicalUrl);
  return `<!-- finepredict:meta:start -->
    <link rel="canonical" href="${escapedCanonicalUrl}" />
    <meta name="description" content="${escapedDescription}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="FinePredict" />
    <meta property="og:url" content="${escapedCanonicalUrl}" />
    <meta property="og:title" content="${escapedTitle}" />
    <meta property="og:description" content="${escapedDescription}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escapedTitle}" />
    <meta name="twitter:description" content="${escapedDescription}" />
    <script type="application/ld+json">${structuredData}</script>
    <!-- finepredict:meta:end -->`;
}

/**
 * Creates dispute-specific HTML metadata.
 *
 * @param dispute - Published FinePredict dispute case.
 * @param canonicalUrl - Absolute canonical dispute URL.
 * @returns Canonical, social, and JSON-LD metadata markup.
 */
function createDisputeMetadata(
  dispute: MetadataDispute,
  canonicalUrl: string,
): string {
  const title = `${dispute.title} dispute — FinePredict`;
  const description = createMetadataDescription(dispute.disputedWording);
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: dispute.title,
    description,
    ...(dispute.publishedAt ? { datePublished: dispute.publishedAt } : {}),
    mainEntityOfPage: canonicalUrl,
    author: { "@type": "Organization", name: "FinePredict" },
    isBasedOn: dispute.marketUrl,
  }).replaceAll("<", "\\u003c");
  const escapedTitle = escapeHtml(title);
  const escapedDescription = escapeHtml(description);
  const escapedCanonicalUrl = escapeHtml(canonicalUrl);
  return `<!-- finepredict:meta:start -->
    <link rel="canonical" href="${escapedCanonicalUrl}" />
    <meta name="description" content="${escapedDescription}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="FinePredict" />
    <meta property="og:url" content="${escapedCanonicalUrl}" />
    <meta property="og:title" content="${escapedTitle}" />
    <meta property="og:description" content="${escapedDescription}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escapedTitle}" />
    <meta name="twitter:description" content="${escapedDescription}" />
    <script type="application/ld+json">${structuredData}</script>
    <!-- finepredict:meta:end -->`;
}

/**
 * Validates the small public report shape used by the renderer.
 *
 * @param value - Parsed API response.
 * @returns True when the response contains usable report metadata.
 */
function isMetadataReport(value: unknown): value is MetadataReport {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<MetadataReport>;
  return (
    typeof candidate.slug === "string" &&
    typeof candidate.createdAt === "string" &&
    Array.isArray(candidate.markets) &&
    candidate.markets.length > 0 &&
    candidate.markets.every(
      (market) =>
        typeof market?.contract?.title === "string" &&
        typeof market.contract.url === "string" &&
        typeof market?.summary?.plainEnglish === "string",
    )
  );
}

/**
 * Validates the public dispute shape used by the renderer.
 *
 * @param value - Parsed API response.
 * @returns True when the response contains usable dispute metadata.
 */
function isMetadataDispute(value: unknown): value is MetadataDispute {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<MetadataDispute>;
  return (
    typeof candidate.slug === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.disputedWording === "string" &&
    typeof candidate.marketUrl === "string" &&
    (typeof candidate.publishedAt === "string" ||
      candidate.publishedAt === null)
  );
}

/**
 * Enriches report responses with crawler-visible metadata and otherwise falls through.
 *
 * @param request - Incoming report request.
 * @param context - Netlify Edge Function request context.
 * @returns Original or metadata-enriched SPA response.
 */
export default async function reportMetadataEdgeFunction(
  request: Request,
  context: Context,
): Promise<Response> {
  const response = await context.next();
  if (!response.headers.get("content-type")?.includes("text/html")) {
    return response;
  }

  try {
    const requestUrl = new URL(request.url);
    const pathParts = requestUrl.pathname.split("/").filter(Boolean);
    const resourceType = pathParts[0];
    const slug = pathParts.at(-1);
    if (!slug || (resourceType !== "reports" && resourceType !== "disputes")) {
      return response;
    }
    const apiBaseUrl =
      Netlify.env.get("FINEPREDICT_API_BASE_URL") ??
      Netlify.env.get("VITE_API_BASE_URL") ??
      "https://finepredict-production.up.railway.app";
    const metadataResponse = await fetch(
      `${apiBaseUrl.replace(/\/$/, "")}/api/${resourceType}/${encodeURIComponent(slug)}`,
      { headers: { accept: "application/json" } },
    );
    if (!metadataResponse.ok) {
      return response;
    }
    const resource: unknown = await metadataResponse.json();
    const canonicalUrl = `${requestUrl.origin}/${resourceType}/${encodeURIComponent(slug)}`;
    const html = await response.text();
    let metadata: string;
    let prerenderedArticle: string;
    let title: string;
    if (resourceType === "reports" && isMetadataReport(resource)) {
      metadata = createReportMetadata(resource, canonicalUrl);
      title = resource.markets
        .map((market) => market.contract.title)
        .join(" vs ");
      prerenderedArticle = createPrerenderedArticle(
        "What does this market require?",
        title,
        resource.markets[0]?.summary.plainEnglish ??
          "Read the archived contract terms, source and deadline.",
      );
    } else if (resourceType === "disputes" && isMetadataDispute(resource)) {
      metadata = createDisputeMetadata(resource, canonicalUrl);
      title = `${resource.title} dispute`;
      prerenderedArticle = createPrerenderedArticle(
        "What wording was disputed?",
        resource.title,
        resource.disputedWording,
      );
    } else {
      return response;
    }
    const enrichedHtml = html
      .replace(METADATA_BLOCK_PATTERN, metadata)
      .replace(
        '<div id="root"></div>',
        `<div id="root">${prerenderedArticle}</div>`,
      )
      .replace(
        /<title>[\s\S]*?<\/title>/,
        `<title>${escapeHtml(title)} — FinePredict</title>`,
      );
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(enrichedHtml, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return response;
  }
}
