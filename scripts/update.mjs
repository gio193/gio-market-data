// Pulls market series from the FRED API and writes data.json.
// Runs on GitHub Actions (Node 20+, built-in fetch). Needs env FRED_API_KEY.
import { writeFileSync } from "node:fs";

const KEY = process.env.FRED_API_KEY;
if (!KEY) { console.error("Missing FRED_API_KEY"); process.exit(1); }

// key -> FRED series id. freq: how to compute change ("yoy" = % vs 12 months earlier, "prev" = vs prior reading)
const SERIES = {
  mort30:   { id: "MORTGAGE30US",   freq: "prev", note: "Freddie Mac PMMS, weekly" },
  mort15:   { id: "MORTGAGE15US",   freq: "prev", note: "Freddie Mac PMMS, weekly" },
  sp500:    { id: "SP500",          freq: "prev", note: "S&P 500, daily close" },
  nasdaq:   { id: "NASDAQ100",      freq: "prev", note: "Nasdaq-100, daily close" },
  chicago:  { id: "CHXRSA",         freq: "yoy",  note: "S&P Cotality Case-Shiller Chicago" },
  us:       { id: "CSUSHPINSA",     freq: "yoy",  note: "S&P Cotality Case-Shiller U.S. National" },
  sales:    { id: "EXHOSLUSM495S",  freq: "prev", note: "Existing-home sales, annual pace (NAR)" },
  listings: { id: "ACTLISCOUUS",    freq: "yoy",  note: "Active listings (Realtor.com)" },
  dom:      { id: "MEDDAYONMARUS",  freq: "yoy",  note: "Median days on market (Realtor.com)" },
  car72:    { id: "RIFLPBCIANM72NM",freq: "prev", note: "Fed G.19, new car loan 72-mo, quarterly" },
  personal: { id: "TERMCBPER24NS",  freq: "prev", note: "Fed G.19, personal loan 24-mo, quarterly" },
  card:     { id: "TERMCBCCINTNS",  freq: "prev", note: "Fed G.19, credit card (accounts assessed interest), quarterly" },
};

async function fetchSeries(id) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${KEY}&file_type=json&sort_order=desc&limit=400`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED ${id}: HTTP ${res.status}`);
  const json = await res.json();
  return (json.observations || [])
    .filter(o => o.value !== ".")
    .map(o => ({ date: o.date, value: parseFloat(o.value) })); // newest first
}

function monthsBetween(a, b) {
  const da = new Date(a), db = new Date(b);
  return (da.getFullYear() - db.getFullYear()) * 12 + (da.getMonth() - db.getMonth());
}

const out = { updated: new Date().toISOString(), series: {} };

for (const [key, cfg] of Object.entries(SERIES)) {
  try {
    const obs = await fetchSeries(cfg.id);
    if (!obs.length) throw new Error("no observations");
    const latest = obs[0];
    const entry = { id: cfg.id, note: cfg.note, value: latest.value, date: latest.date };
    if (cfg.freq === "yoy") {
      const yearAgo = obs.find(o => monthsBetween(latest.date, o.date) === 12) ||
                      obs.find(o => monthsBetween(latest.date, o.date) >= 12);
      if (yearAgo) entry.yoy = ((latest.value / yearAgo.value) - 1) * 100;
    } else if (obs[1]) {
      entry.prev = obs[1].value;
      entry.change = latest.value - obs[1].value;
    }
    out.series[key] = entry;
    console.log(`ok   ${key} ${latest.date} ${latest.value}`);
  } catch (e) {
    // One bad series must not break the rest. The page hides any tile with no data.
    console.error(`FAIL ${key}: ${e.message}`);
  }
}

if (!Object.keys(out.series).length) { console.error("No series fetched; keeping old data.json"); process.exit(1); }
writeFileSync("data.json", JSON.stringify(out, null, 2));
