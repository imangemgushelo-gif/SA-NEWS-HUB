const BASE_URL = "https://www.financecalendar.com/wp-json/fc/v1/calendar";

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

function eventMatches(item) {
  const name = String(item.name || item.title || item.event || item.series || "").toLowerCase();
  const series = String(item.series || "").toLowerCase();
  const category = String(item.category || "").toLowerCase();
  return (
    /non.?farm payroll|employment situation|jobs report/.test(name) ||
    /consumer price index|\bcpi\b/.test(name) ||
    /producer price index|\bppi\b/.test(name) ||
    /fomc|federal funds rate|fed rate decision|fed interest rate/.test(name) ||
    ["nfp", "jobs", "cpi", "ppi", "fomc"].includes(series) ||
    /central.?bank|monetary.?policy/.test(category) && /federal reserve|fomc/.test(name)
  );
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
  url.searchParams.set("impact", "high");
  url.searchParams.set("limit", "500");

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
    const records = Array.isArray(payload) ? payload : (payload.events || payload.data || payload.calendar);
    if (!Array.isArray(records)) {
      return json({ events: [], error: "The calendar provider returned an unexpected response." }, 502);
    }

    const events = records
      .filter(eventMatches)
      .map((item) => ({
        id: String(item.id || item.slug || `${item.time_utc || item.date || ""}-${item.name || item.title || item.series || "event"}`),
        date: item.time_utc || item.date || item.datetime || "",
        country: "United States",
        event: item.name || item.title || item.event || item.series || "Economic release",
        actual: item.actual == null ? "" : String(item.actual),
        forecast: item.consensus == null ? "" : String(item.consensus),
        previous: item.prior == null ? (item.previous == null ? "" : String(item.previous)) : String(item.prior),
        importance: String(item.impact || item.importance || "").toLowerCase() === "high" ? 3 : 0,
        source: "FinanceCalendar",
        sourceUrl: item.url || "https://www.financecalendar.com/api/",
        unit: item.unit || "",
        period: item.period || item.period_label || "",
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    return json({
      events,
      updatedAt: payload.updatedAt || payload.updated_at || new Date().toISOString(),
      attribution: "Data: FinanceCalendar",
      sourceUrl: "https://www.financecalendar.com/api/",
    });
  } catch {
    return json({
      events: [],
      error: "Unable to load the economic calendar right now. Please try refreshing.",
      setupRequired: false,
    }, 502);
  }
}
