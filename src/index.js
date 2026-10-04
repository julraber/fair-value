export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Erster Test der Alpha-Vantage-Verbindung
    if (url.pathname === "/api/alpha-vantage-test") {
      if (!env.ALPHA_VANTAGE_API_KEY) {
        return Response.json(
          {
            ok: false,
            error: "Der Alpha-Vantage-API-Key wurde noch nicht hinterlegt."
          },
          { status: 500 }
        );
      }

      const apiUrl = new URL("https://www.alphavantage.co/query");
      apiUrl.searchParams.set("function", "GLOBAL_QUOTE");
      apiUrl.searchParams.set("symbol", "AAPL");
      apiUrl.searchParams.set("apikey", env.ALPHA_VANTAGE_API_KEY);

      const apiResponse = await fetch(apiUrl);
      const data = await apiResponse.text();

      return new Response(data, {
        status: apiResponse.status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        }
      });
    }

    // Alle normalen Aufrufe laden weiterhin deine Website
    return env.ASSETS.fetch(request);
  }
};
