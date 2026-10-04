export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/alpha-vantage-test") {
      if (!env.ALPHA_VANTAGE_API_KEY) {
        return Response.json(
          {
            ok: false,
            error: "Der API-Schlüssel ist derzeit nicht konfiguriert."
          },
          {
            status: 500,
            headers: { "Cache-Control": "no-store" }
          }
        );
      }

      const apiUrl = new URL("https://www.alphavantage.co/query");
      apiUrl.searchParams.set("function", "GLOBAL_QUOTE");
      apiUrl.searchParams.set("symbol", "AAPL");
      apiUrl.searchParams.set("apikey", env.ALPHA_VANTAGE_API_KEY);

      try {
        const apiResponse = await fetch(apiUrl);
        let data;

        try {
          data = await apiResponse.json();
        } catch {
          return Response.json(
            {
              ok: false,
              error: "Alpha Vantage hat keine gültige JSON-Antwort geliefert."
            },
            {
              status: 502,
              headers: { "Cache-Control": "no-store" }
            }
          );
        }

        if (
          !apiResponse.ok ||
          data.Information ||
          data.Note ||
          data["Error Message"]
        ) {
          return Response.json(
            {
              ok: false,
              error:
                "Alpha Vantage hat die Anfrage abgelehnt oder das kostenlose Kontingent ist nicht verfügbar."
            },
            {
              status: 502,
              headers: { "Cache-Control": "no-store" }
            }
          );
        }

        return Response.json(
          {
            ok: true,
            data
          },
          {
            headers: { "Cache-Control": "no-store" }
          }
        );
      } catch {
        return Response.json(
          {
            ok: false,
            error: "Die Verbindung zum Finanzdatenanbieter ist fehlgeschlagen."
          },
          {
            status: 502,
            headers: { "Cache-Control": "no-store" }
          }
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};
