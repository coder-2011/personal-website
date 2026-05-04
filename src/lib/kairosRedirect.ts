const KAIROS_APP_URL = "https://kairos-pi-two.vercel.app";

const SCRAPER_USER_AGENT_PATTERN =
  /\b(bot|crawler|spider|scraper|slurp|archiver|preview|facebookexternalhit|facebot|twitterbot|linkedinbot|discordbot|slackbot|whatsapp|telegrambot|embedly|quora link preview|pinterest|ahrefs|semrush|mj12bot|dotbot|bytespider|gptbot|google-extended|ccbot|claudebot|anthropic-ai|perplexitybot|youbot|applebot|bingbot|duckduckbot|baiduspider|yandexbot|sogou|exabot|ia_archiver|curl|wget|python-requests|go-http-client|httpie|postman|headlesschrome|playwright|puppeteer)\b/i;

function isScraperRequest(request: Request) {
  const userAgent = request.headers.get("user-agent") ?? "";

  if (!userAgent.trim()) {
    return true;
  }

  return SCRAPER_USER_AGENT_PATTERN.test(userAgent);
}

function getKairosDestination(requestUrl: URL) {
  const destination = new URL(KAIROS_APP_URL);
  const pathAfterKairos = requestUrl.pathname.replace(/^\/kairos\/?/, "");

  if (pathAfterKairos) {
    destination.pathname = `/${pathAfterKairos}`;
  }

  destination.search = requestUrl.search;

  return destination;
}

export function handleKairosRequest(request: Request) {
  if (isScraperRequest(request)) {
    return new Response("Not found", {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex"
      }
    });
  }

  return Response.redirect(getKairosDestination(new URL(request.url)), 302);
}
