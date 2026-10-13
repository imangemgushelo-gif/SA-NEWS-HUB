const BASE_URL = "https://api.tradingeconomics.com/calendar/country/united%20states";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60, s-maxage=300",
    },
  });
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

export async function onRequest({ env }) {
  const apiKey = env.TRADING_ECONOMICS_API_KEY;

  if (!apiKey) {
    return json({
      events: [],
      error: "The economic calendar feed is not configured yet.",
      setupRequired: true,
    }, 503);
  }

  const today = new Date();
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 7);
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() + 14);

  const url = new URL(`${BASE_URL}/${isoDate(start)}/${isoDate(end)}`);
  url.searchParams.set("c", apiKey);
  url.searchParams.set("f", "json");
  url.searchParams.set("importance", "2");

  try {
    const response = await fetch(url.toString(), {
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      return json({
        events: [],
        error: "The economic calendar provider could not be reached.",
        setupRequired: false,
      }, 502);
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
      return json({ events: [], error: "The provider returned an unexpected response." }, 502);
    }

    const keywords = [
      "non farm payroll",
      "nonfarm payroll",
      "employment change",
      "consumer price index",
      "cpi",
      "inflation rate",
      "fed interest rate decision",
      "federal funds rate",
      "fomc",
    ];

    const events = payload
      .filter((item) => {
        const name = `${item.Event || ""} ${item.Category || ""}`.toLowerCase();
        return keywords.some((keyword) => name.includes(keyword));
      })
      .map((item) => ({
        id: String(item.CalendarID || `${item.Date}-${item.Event}`),
        date: item.Date || "",
        country: item.Country || "United States",
        event: item.Event || item.Category || "Economic release",
        actual: item.Actual || "",
        forecast: item.Forecast || "",
        previous: item.Previous || "",
        importance: Number(item.Importance || 0),
        source: item.Source || "",
        sourceUrl: item.SourceURL || "",
        revised: item.Revised || "",
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    return json({ events, updatedAt: new Date().toISOString() });
  } catch {
    return json({
      events: [],
      error: "Unable to load the economic calendar right now.",
      setupRequired: false,
    }, 502);
  }
}
