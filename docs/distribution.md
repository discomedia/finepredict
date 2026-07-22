# FinePredict distribution surfaces

## Embedded reports

Append `?embed=1` to a public report URL. Embed mode removes the site header and footer but does not change report content.

```html
<iframe
  id="finepredict-report"
  src="https://finepredict.netlify.app/reports/REPORT_SLUG?embed=1"
  title="FinePredict contract report"
  loading="lazy"
  style="width: 100%; min-height: 720px; border: 0"
></iframe>
<script>
  window.addEventListener("message", function (event) {
    if (event.origin !== "https://finepredict.netlify.app") return;
    if (event.data?.type !== "finepredict:resize") return;
    document.getElementById("finepredict-report").style.height =
      event.data.height + "px";
  });
</script>
```

Always validate `event.origin` before using resize messages.

## Browser extension

Run `pnpm --filter @finepredict/extension build`, then load `apps/extension/dist` as an unpacked Manifest V3 extension. On Polymarket event and Kalshi market pages, the extension adds a small **Check fine print** action. On `https://www.oddpool.com/arb-dashboard`, supported Kalshi/Polymarket rows gain a **Compare** button beside Oddpool's venue links. Both actions only prefill FinePredict; the user must explicitly select **Compare market rules** before any analysis starts.

Run `pnpm --filter @finepredict/extension package` to create the Chrome Web Store upload at `apps/extension/dist/finepredict-extension.zip`. The store developer account owns the permanent extension ID, signing, listing, privacy disclosure, and releases; never add Web Store OAuth credentials to the extension bundle or repository.

Google's Chrome Web Store policy currently disallows extensions that facilitate or promote real-money prediction markets. Treat this Oddpool integration as a developer-mode/internal distribution unless Google Developer Support confirms that the contract-research-only workflow is eligible. Do not risk the publisher account by describing the extension as unrelated to prediction markets. The immediate personal-use install is Chrome's **Load unpacked** flow with `apps/extension/dist`.

## Search and social rendering

Netlify serves static `robots.txt` and `sitemap.xml` files. The `report-meta` Edge Function reads public report data and replaces the generic metadata block with report-specific canonical, Open Graph, Twitter, and JSON-LD tags. Set `FINEPREDICT_API_BASE_URL` with Netlify's Functions scope if the API domain changes.
