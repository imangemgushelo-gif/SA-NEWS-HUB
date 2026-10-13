const BASE_URL = "https://xoomar.com/api/markets/calendar";

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

export async function onRequest() {
  const today = new Date();
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 7);
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() + 30);

  const url = new URL(BASE_URL);
  url.searchParams.set("from", isoDate(start));
  url.searchParams.set("to", isoDate(end));
  url.searchParams.set("importance", "high");

  try {
    const response = await fetch(url.toString(), {
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      return json({
        events: [],
        error: "The free economic calendar provider could not be reached. Please try again later.",
        setupRequired: false,
      }, 502);
    }

    const payload = await response.json();
    if (!payload || !Array.isArray(payload.data)) {
      return json({ events: [], error: "The calendar provider returned an unexpected response." }, 502);
    }

    const keywords = [
      "nonfarm payroll",
      "non-farm payroll",
      "employment situation",
      "consumer price index",
      "cpi",
      "fomc",
      "fed rate decision",
      "federal funds rate",
      "fomc minutes",
    ];

    const events = payload.data
      .filter((item) => {
        const name = String(item.eventName || "").toLowerCase();
        return keywords.some((keyword) => name.includes(keyword));
      })
      .map((item) => ({
        id: String(item.id || `${item.scheduledAt}-${item.eventName}`),
        date: item.scheduledAt || "",
        country: "United States",
        event: item.eventName || "Economic release",
        actual: item.actual == null ? "" : String(item.actual),
        forecast: item.forecast == null ? "" : String(item.forecast),
        previous: item.previous == null ? "" : String(item.previous),
        importance: item.importance === "high" ? 3 : 0,
        source: item.source || "XOOMAR",
        sourceUrl: "https://xoomar.com/economic-calendar-api",
        period: item.periodLabel || "",
        unit: item.unit || "",
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    return json({
      events,
      updatedAt: payload.updatedAt || new Date().toISOString(),
      attribution: "Data: XOOMAR, using release schedules and figures from official agencies.",
      sourceUrl: "https://xoomar.com/economic-calendar-api",
    });
  } catch {
    return json({
      events: [],
      error: "Unable to load the economic calendar right now. Please try refreshing.",
      setupRequired: false,
    }, 502);
  }
}
