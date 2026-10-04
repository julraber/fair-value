const FMP_BASE_URL = "https://financialmodelingprep.com/stable";
const CACHE_SECONDS = 6 * 60 * 60;
const ACCESS_COOKIE = "fv_access";
const FREE_STOCKS = [
  ["AAPL", "Apple Inc."], ["TSLA", "Tesla Inc."], ["AMZN", "Amazon.com Inc."],
  ["MSFT", "Microsoft Corporation"], ["NVDA", "NVIDIA Corporation"], ["GOOGL", "Alphabet Inc."],
  ["META", "Meta Platforms Inc."], ["NFLX", "Netflix Inc."], ["JPM", "JPMorgan Chase & Co."],
  ["V", "Visa Inc."], ["BAC", "Bank of America Corporation"], ["AMD", "Advanced Micro Devices Inc."],
  ["PYPL", "PayPal Holdings Inc."], ["DIS", "The Walt Disney Company"], ["T", "AT&T Inc."],
  ["PFE", "Pfizer Inc."], ["COST", "Costco Wholesale Corporation"], ["INTC", "Intel Corporation"],
  ["KO", "The Coca-Cola Company"], ["TGT", "Target Corporation"], ["NKE", "Nike Inc."],
  ["SPY", "SPDR S&P 500 ETF Trust"], ["BA", "The Boeing Company"], ["BABA", "Alibaba Group Holding Ltd."],
  ["XOM", "Exxon Mobil Corporation"], ["WMT", "Walmart Inc."], ["GE", "GE Aerospace"],
  ["CSCO", "Cisco Systems Inc."], ["VZ", "Verizon Communications Inc."], ["JNJ", "Johnson & Johnson"],
  ["CVX", "Chevron Corporation"], ["PLTR", "Palantir Technologies Inc."], ["SQ", "Block Inc."],
  ["SHOP", "Shopify Inc."], ["SBUX", "Starbucks Corporation"], ["SOFI", "SoFi Technologies Inc."],
  ["HOOD", "Robinhood Markets Inc."], ["RBLX", "Roblox Corporation"], ["SNAP", "Snap Inc."],
  ["UBER", "Uber Technologies Inc."], ["FDX", "FedEx Corporation"], ["ABBV", "AbbVie Inc."],
  ["ETSY", "Etsy Inc."], ["MRNA", "Moderna Inc."], ["LMT", "Lockheed Martin Corporation"],
  ["GM", "General Motors Company"], ["F", "Ford Motor Company"], ["RIVN", "Rivian Automotive Inc."],
  ["LCID", "Lucid Group Inc."], ["CCL", "Carnival Corporation"], ["DAL", "Delta Air Lines Inc."],
  ["UAL", "United Airlines Holdings Inc."], ["AAL", "American Airlines Group Inc."],
  ["TSM", "Taiwan Semiconductor Manufacturing Company"], ["SONY", "Sony Group Corporation"],
  ["ET", "Energy Transfer LP"], ["NOK", "Nokia Oyj"], ["MRO", "Marathon Oil Corporation"],
  ["COIN", "Coinbase Global Inc."], ["SIRI", "Sirius XM Holdings Inc."], ["RIOT", "Riot Platforms Inc."],
  ["CPRX", "Catalyst Pharmaceuticals Inc."], ["VWO", "Vanguard FTSE Emerging Markets ETF"],
  ["SPYG", "SPDR Portfolio S&P 500 Growth ETF"], ["ROKU", "Roku Inc."], ["VIAC", "Paramount Global"],
  ["ATVI", "Activision Blizzard Inc."], ["BIDU", "Baidu Inc."], ["DOCU", "DocuSign Inc."],
  ["ZM", "Zoom Communications Inc."], ["PINS", "Pinterest Inc."], ["TLRY", "Tilray Brands Inc."],
  ["WBA", "Walgreens Boots Alliance Inc."], ["MGM", "MGM Resorts International"], ["NIO", "NIO Inc."],
  ["C", "Citigroup Inc."], ["GS", "The Goldman Sachs Group Inc."], ["WFC", "Wells Fargo & Company"],
  ["ADBE", "Adobe Inc."], ["PEP", "PepsiCo Inc."], ["UNH", "UnitedHealth Group Inc."],
  ["CARR", "Carrier Global Corporation"], ["FUBO", "FuboTV Inc."], ["HCA", "HCA Healthcare Inc."],
  ["TWTR", "Twitter Inc."], ["BILI", "Bilibili Inc."], ["RKT", "Rocket Companies Inc."]
].map(([symbol, name]) => ({ symbol, name }));
const FREE_SYMBOLS = new Set(FREE_STOCKS.map(stock => stock.symbol));

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
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}

function berlinDatePassword(date = new Date()) {
  const parts = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).formatToParts(date);
  const value = type => parts.find(part => part.type === type)?.value || "";
  return `${value("day")}${value("month")}${value("year")}`;
}

function readCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return "";
}

function base64Url(buffer) {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function accessToken(datePassword, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(String(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`fair-value:${datePassword}`));
  return `${datePassword}.${base64Url(signature)}`;
}

function secureEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function hasAccess(request, env) {
  if (!env.FMP_API_KEY) return false;
  const datePassword = berlinDatePassword();
  const expected = await accessToken(datePassword, env.FMP_API_KEY);
  return secureEqual(readCookie(request, ACCESS_COOKIE), expected);
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

function classifyProviderFailure(response, message, stage) {
  const text = String(message || "");
  if (response.status === 429 || /limit|quota|too many|rate/i.test(text)) {
    throw new ApiError("DAILY_LIMIT", 429);
  }
  if (
    response.status === 401 ||
    response.status === 403 ||
    /invalid api|api key|authentication|unauthorized/i.test(text)
  ) {
    throw new ApiError("API_KEY_REJECTED", 502);
  }
  if (/subscription|upgrade|not available|restricted|premium/i.test(text)) {
    throw new ApiError("NOT_SUPPORTED", 422);
  }
  throw new ApiError(`INVALID_PROVIDER_RESPONSE_${stage}`, 502);
}

async function fmpFetch(path, params, apiKey, stage) {
  const url = new URL(FMP_BASE_URL + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  url.searchParams.set("apikey", String(apiKey).trim());

  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true }
    });
  } catch {
    throw new ApiError("PROVIDER_UNAVAILABLE", 502);
  }

  let rawText;
  try {
    rawText = await response.text();
  } catch {
    throw new ApiError(`INVALID_PROVIDER_RESPONSE_${stage}`, 502);
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    classifyProviderFailure(response, rawText.slice(0, 500), stage);
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

function searchStocks(query, limit = 10) {
  const normalizedQuery = query.trim().toUpperCase();
  if (!normalizedQuery) return [];
  return FREE_STOCKS
    .map(stock => {
      const symbol = stock.symbol.toUpperCase();
      const name = stock.name.toUpperCase();
      let score = 99;
      if (symbol === normalizedQuery) score = 0;
      else if (name === normalizedQuery) score = 1;
      else if (symbol.startsWith(normalizedQuery)) score = 2;
      else if (name.startsWith(normalizedQuery)) score = 3;
      else if (symbol.includes(normalizedQuery)) score = 4;
      else if (name.includes(normalizedQuery)) score = 5;
      return { ...stock, score };
    })
    .filter(stock => stock.score < 99)
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ score, ...stock }) => stock);
}

function resolveFreeStock(query) {
  const normalized = query.trim().toUpperCase();
  const exactSymbol = FREE_STOCKS.find(stock => stock.symbol === normalized);
  if (exactSymbol) return exactSymbol;
  const exactName = FREE_STOCKS.find(stock => stock.name.toUpperCase() === normalized);
  return exactName || searchStocks(query, 1)[0] || null;
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
  const stock = resolveFreeStock(query);
  if (!stock || !FREE_SYMBOLS.has(stock.symbol)) throw new ApiError("NOT_SUPPORTED", 422);
  const symbol = stock.symbol;

  const [quoteRows, ttmRatioRows, historicalRatios, estimates] = await Promise.all([
    fmpFetch("/quote", { symbol }, apiKey, "QUOTE"),
    fmpFetch("/ratios-ttm", { symbol }, apiKey, "RATIOS_TTM"),
    fmpFetch("/ratios", { symbol, period: "annual", limit: 5 }, apiKey, "RATIOS"),
    fmpFetch("/analyst-estimates", {
      symbol,
      period: "annual",
      page: 0,
      limit: 10
    }, apiKey, "ANALYST_ESTIMATES")
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
    PASSWORD_REQUIRED: "Für den automatischen Datenabruf ist ein gültiges Passwort erforderlich.",
    INTERNAL_ERROR: "Die Finanzdaten konnten momentan nicht geladen werden."
  };
  const invalidStage = code.startsWith("INVALID_PROVIDER_RESPONSE_")
    ? code.replace("INVALID_PROVIDER_RESPONSE_", "")
    : null;
  const message = invalidStage
    ? `FMP hat beim Schritt ${invalidStage} keine lesbare Datenantwort geliefert.`
    : messages[code];
  return json({ ok: false, code, error: message }, status);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        workerVersion: "8",
        fmpConfigured: Boolean(env.FMP_API_KEY)
      });
    }

    if (url.pathname === "/api/session") {
      if (request.method !== "GET") {
        return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, { Allow: "GET" });
      }
      return json({ ok: await hasAccess(request, env) });
    }

    if (url.pathname === "/api/login") {
      if (request.method !== "POST") {
        return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, { Allow: "POST" });
      }
      if (!env.FMP_API_KEY) {
        return json({ ok: false, code: "API_KEY_MISSING", error: "Der Zugang kann noch nicht geprüft werden." }, 500);
      }
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, code: "INVALID_REQUEST" }, 400);
      }
      const password = String(body?.password || "").replace(/\D/g, "");
      const today = berlinDatePassword();
      if (!secureEqual(password, today)) {
        return json({ ok: false, code: "INVALID_PASSWORD", error: "Das Passwort ist nicht korrekt." }, 401);
      }
      const token = await accessToken(today, env.FMP_API_KEY);
      return json({ ok: true }, 200, {
        "Set-Cookie": `${ACCESS_COOKIE}=${token}; Path=/; Max-Age=90000; HttpOnly; Secure; SameSite=Strict`
      });
    }

    if (url.pathname === "/api/stocks") {
      if (request.method !== "GET") {
        return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, { Allow: "GET" });
      }
      const stocks = [...FREE_STOCKS].sort((a, b) => a.name.localeCompare(b.name));
      return json({ ok: true, count: stocks.length, stocks }, 200, {
        "Cache-Control": "public, max-age=86400"
      });
    }

    if (url.pathname === "/api/search") {
      if (request.method !== "GET") {
        return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, { Allow: "GET" });
      }
      const query = (url.searchParams.get("q") || "").trim().slice(0, 80);
      if (!query) return publicError(new ApiError("MISSING_QUERY", 400));
      const results = searchStocks(query);
      return json({ ok: true, results }, 200, {
        "Cache-Control": "public, max-age=86400"
      });
    }

    if (url.pathname === "/api/stock") {
      if (request.method !== "GET") {
        return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, { Allow: "GET" });
      }
      if (!(await hasAccess(request, env))) {
        return json({
          ok: false,
          code: "PASSWORD_REQUIRED",
          error: "Bitte zuerst das aktuelle Passwort eingeben."
        }, 401);
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
