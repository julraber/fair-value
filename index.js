const FMP_BASE_URL = "https://financialmodelingprep.com/stable";
const CACHE_SECONDS = 6 * 60 * 60;

class ApiError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positive(value) {
  const number = finite(value);
  return number !== null && number > 0 ? number : null;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function median(sortedValues) {
  const middle = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2
    ? sortedValues[middle]
    : (sortedValues[middle - 1] + sortedValues[middle]) / 2;
}

function quantile(sortedValues, percentile) {
  if (sortedValues.length === 1) return sortedValues[0];
  const position = (sortedValues.length - 1) * percentile;
  const base = Math.floor(position);
  const rest = position - base;
  const next = sortedValues[base + 1];
  return next === undefined
    ? sortedValues[base]
    : sortedValues[base] + rest * (next - sortedValues[base]);
}

function annualGrowth(currentEps, futureEps, years) {
  if (currentEps <= 0 || futureEps <= 0 || years <= 0) return null;
  return (Math.pow(futureEps / currentEps, 1 / years) - 1) * 100;
}

function looksLikeProviderError(data) {
  if (!data || Array.isArray(data)) return null;
  const message = String(
    data["Error Message"] ?? data.error ?? data.message ?? data.Information ?? ""
  );
  return message || null;
}

async function fmpFetch(path, params, apiKey) {
  const url = new URL(FMP_BASE_URL + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  url.searchParams.set("apikey", apiKey);

  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true }
    });
  } catch {
    throw new ApiError("PROVIDER_UNAVAILABLE", 502);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError("INVALID_PROVIDER_RESPONSE", 502);
  }

  const providerMessage = looksLikeProviderError(data);
  if (response.status === 429 || /limit|quota|too many|rate/i.test(providerMessage || "")) {
    throw new ApiError("DAILY_LIMIT", 429);
  }
  if (
    response.status === 401 ||
    response.status === 403 ||
    /invalid api|api key|authentication/i.test(providerMessage || "")
  ) {
    throw new ApiError("API_KEY_REJECTED", 502);
  }
  if (
    /subscription|upgrade|not available|restricted|premium/i.test(providerMessage || "")
  ) {
    throw new ApiError("NOT_SUPPORTED", 422);
  }
  if (!response.ok || providerMessage) {
    throw new ApiError("PROVIDER_ERROR", 502);
  }
  return data;
}

function chooseSearchResult(results, query) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const normalized = query.trim().toUpperCase();
  const exactSymbol = results.find(
    item => String(item.symbol || "").toUpperCase() === normalized
  );
  if (exactSymbol) return exactSymbol;

  const usExchanges = new Set(["NASDAQ", "NYSE", "AMEX"]);
  return (
    results.find(item => usExchanges.has(String(item.exchangeShortName || "").toUpperCase())) ||
    results[0]
  );
}

function buildPeBand(historicalRatios, currentPe) {
  const values = (Array.isArray(historicalRatios) ? historicalRatios : [])
    .map(item => positive(item.priceToEarningsRatio))
    .filter(value => value !== null && value < 500)
    .sort((a, b) => a - b)
    .slice(-5);

  if (values.length === 0 && currentPe) values.push(currentPe);
  if (values.length === 0) throw new ApiError("INCOMPLETE_DATA", 422);

  return {
    low: round(quantile(values, 0.25), 1),
    average: round(median(values), 1),
    high: round(quantile(values, 0.75), 1),
    values: values.map(value => round(value, 1))
  };
}

function chooseEstimate(estimates) {
  if (!Array.isArray(estimates) || estimates.length === 0) return null;
  const currentYear = new Date().getUTCFullYear();
  const usable = estimates
    .map(item => ({ ...item, year: Number(String(item.date || "").slice(0, 4)) }))
    .filter(item =>
      Number.isFinite(item.year) &&
      item.year > currentYear &&
      positive(item.epsLow) &&
      positive(item.epsAvg) &&
      positive(item.epsHigh)
    )
    .sort((a, b) => a.year - b.year);

  if (usable.length === 0) return null;
  return usable.reduce((best, item) => {
    const bestDistance = Math.abs(best.year - (currentYear + 5));
    const itemDistance = Math.abs(item.year - (currentYear + 5));
    return itemDistance < bestDistance ? item : best;
  });
}

function buildStockPayload(symbol, quoteRows, ttmRatioRows, historicalRatios, estimates) {
  const quote = Array.isArray(quoteRows) ? quoteRows[0] : null;
  const ttm = Array.isArray(ttmRatioRows) ? ttmRatioRows[0] : null;
  const price = positive(quote?.price);
  const eps = positive(ttm?.netIncomePerShareTTM);
  const currentPe = positive(ttm?.priceToEarningsRatioTTM) ||
    (price && eps ? price / eps : null);

  if (!quote || !price || !eps) throw new ApiError("INCOMPLETE_DATA", 422);

  const peBand = buildPeBand(historicalRatios, currentPe);
  const estimate = chooseEstimate(estimates);
  if (!estimate) throw new ApiError("NOT_SUPPORTED", 422);

  const currentYear = new Date().getUTCFullYear();
  const estimateYears = estimate.year - currentYear;
  const growthLow = annualGrowth(eps, positive(estimate.epsLow), estimateYears);
  const growthAverage = annualGrowth(eps, positive(estimate.epsAvg), estimateYears);
  const growthHigh = annualGrowth(eps, positive(estimate.epsHigh), estimateYears);

  if ([growthLow, growthAverage, growthHigh].some(value => value === null)) {
    throw new ApiError("INCOMPLETE_DATA", 422);
  }

  const latestRatio = Array.isArray(historicalRatios) ? historicalRatios[0] : null;
  const analystCount = finite(estimate.numAnalystsEps);

  return {
    ok: true,
    source: "Financial Modeling Prep",
    stock: {
      symbol,
      name: quote.name || symbol,
      price: round(price, 2),
      eps: round(eps, 2),
      currentPe: currentPe ? round(currentPe, 1) : null,
      currency: quote.currency || latestRatio?.reportedCurrency || "USD"
    },
    historicalPe: peBand,
    analystCount,
    estimate: {
      year: estimate.year,
      epsLow: round(Number(estimate.epsLow), 2),
      epsAverage: round(Number(estimate.epsAvg), 2),
      epsHigh: round(Number(estimate.epsHigh), 2)
    },
    scenarios: {
      conservative: {
        growth: round(growthLow, 1),
        pe: peBand.low,
        analystCount
      },
      realistic: {
        growth: round(growthAverage, 1),
        pe: peBand.average,
        analystCount
      },
      optimistic: {
        growth: round(growthHigh, 1),
        pe: peBand.high,
        analystCount
      }
    },
    updatedAt: new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(new Date())
  };
}

async function getStockData(query, apiKey) {
  const searchRows = await fmpFetch("/search-name", { query, limit: 10 }, apiKey);
  const result = chooseSearchResult(searchRows, query);
  if (!result?.symbol) throw new ApiError("NOT_FOUND", 404);
  const symbol = String(result.symbol).toUpperCase();

  const [quoteRows, ttmRatioRows, historicalRatios, estimates] = await Promise.all([
    fmpFetch("/quote", { symbol }, apiKey),
    fmpFetch("/ratios-ttm", { symbol }, apiKey),
    fmpFetch("/ratios", { symbol, period: "annual", limit: 5 }, apiKey),
    fmpFetch("/analyst-estimates", {
      symbol,
      period: "annual",
      page: 0,
      limit: 10
    }, apiKey)
  ]);

  return buildStockPayload(
    symbol,
    quoteRows,
    ttmRatioRows,
    historicalRatios,
    estimates
  );
}

function publicError(error) {
  const code = error instanceof ApiError ? error.code : "INTERNAL_ERROR";
  const status = error instanceof ApiError ? error.status : 500;
  const messages = {
    MISSING_QUERY: "Bitte einen Unternehmensnamen oder ein Börsenkürzel eingeben.",
    NOT_FOUND: "Die Aktie wurde nicht gefunden.",
    NOT_SUPPORTED: "Für diese Aktie sind im kostenlosen Tarif nicht alle benötigten Daten verfügbar.",
    INCOMPLETE_DATA: "Für diese Aktie fehlen einzelne Werte für die automatische Berechnung.",
    DAILY_LIMIT: "Das tägliche API-Kontingent ist derzeit ausgeschöpft.",
    API_KEY_REJECTED: "Der Finanzdatenanbieter hat die Anmeldung abgelehnt.",
    PROVIDER_UNAVAILABLE: "Der Finanzdatenanbieter ist momentan nicht erreichbar.",
    INVALID_PROVIDER_RESPONSE: "Der Finanzdatenanbieter hat eine ungültige Antwort geliefert.",
    PROVIDER_ERROR: "Der Finanzdatenanbieter konnte die Anfrage nicht verarbeiten.",
    INTERNAL_ERROR: "Die Finanzdaten konnten momentan nicht geladen werden."
  };
  return json({ ok: false, code, error: messages[code] }, status);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        workerVersion: "4",
        fmpConfigured: Boolean(env.FMP_API_KEY)
      });
    }

    if (url.pathname === "/api/stock") {
      if (request.method !== "GET") {
        return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, { Allow: "GET" });
      }
      if (!env.FMP_API_KEY) {
        return json({
          ok: false,
          code: "API_KEY_MISSING",
          error: "Der FMP-API-Schlüssel ist noch nicht konfiguriert."
        }, 500);
      }

      const query = (url.searchParams.get("q") || "").trim().slice(0, 80);
      if (!query) return publicError(new ApiError("MISSING_QUERY", 400));

      const cache = caches.default;
      const cacheKeyUrl = new URL(url);
      cacheKeyUrl.searchParams.set("q", query.toLowerCase());
      const cacheKey = new Request(cacheKeyUrl.toString(), { method: "GET" });
      const cached = await cache.match(cacheKey);
      if (cached) return cached;

      try {
        const payload = await getStockData(query, env.FMP_API_KEY);
        const response = json(payload, 200, {
          "Cache-Control": `public, max-age=${CACHE_SECONDS}`
        });
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
        return response;
      } catch (error) {
        return publicError(error);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
