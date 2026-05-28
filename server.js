const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const CLIENT_ID = process.env.EBAY_CLIENT_ID;
const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;

async function getEbayToken() {
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Token failed: " + JSON.stringify(data));
  return data.access_token;
}

// ─── EXACT SET NAME DEFINITIONS ───────────────────────────────────────────────
// These are the EXACT strings that must appear in the title for each set.
// "Panini Prizm" will NOT match "Prizm Draft Picks" or "Donruss Optic Prizm"
const EXACT_SETS = {
  "panini prizm":         { must: ["prizm"], mustNot: ["draft picks", "draft pick", "donruss", "optic", "contenders", "select", "mosaic", "chronicles", "hoops", "spectra", "national treasures", "immaculate", "flawless"] },
  "prizm draft picks":    { must: ["prizm", "draft picks"], mustNot: [] },
  "bowman chrome":        { must: ["bowman chrome"], mustNot: ["topps chrome", "bowman platinum", "bowman sterling"] },
  "topps chrome":         { must: ["topps chrome"], mustNot: ["bowman chrome", "topps chrome update"] },
  "donruss optic":        { must: ["optic"], mustNot: ["prizm", "select", "mosaic"] },
  "panini select":        { must: ["select"], mustNot: ["prizm", "optic", "donruss"] },
  "panini mosaic":        { must: ["mosaic"], mustNot: ["prizm", "optic", "select"] },
  "upper deck":           { must: ["upper deck"], mustNot: [] },
  "national treasures":   { must: ["national treasures"], mustNot: [] },
  "panini contenders":    { must: ["contenders"], mustNot: ["optic contenders"] },
};

// ─── EXACT PARALLEL DEFINITIONS ───────────────────────────────────────────────
// When searching a specific parallel, ONLY that parallel is allowed.
// All competing parallels are rejected.
const PARALLEL_CONFLICTS = {
  "silver":       ["gold", "red", "blue", "green", "purple", "orange", "pink", "black", "bronze", "copper", "yellow", "teal", "hyper", "neon", "disco", "shimmer", "cracked ice", "tiger", "wave", "aqua", "ruby", "emerald", "sapphire"],
  "gold":         ["silver", "red", "blue", "green", "purple", "orange", "pink", "black", "bronze"],
  "red":          ["silver", "gold", "blue", "green", "purple", "orange", "pink", "black"],
  "blue":         ["silver", "gold", "red", "green", "purple", "orange", "pink", "black"],
  "green":        ["silver", "gold", "red", "blue", "purple", "orange", "pink", "black"],
  "purple":       ["silver", "gold", "red", "blue", "green", "orange", "pink", "black"],
  "orange":       ["silver", "gold", "red", "blue", "green", "purple", "pink", "black"],
  "black":        ["silver", "gold", "red", "blue", "green", "purple", "orange", "pink"],
  "hyper":        ["silver", "gold", "red", "blue", "green", "purple", "orange", "pink", "black"],
  "neon":         ["silver", "gold", "red", "blue", "green", "purple", "orange", "pink", "black"],
};

const JUNK_KEYWORDS = [
  "you pick", "pick your", "pick one", "choose your",
  "lot of", "bundle of", "multi", "wholesale",
  "reprint", "custom", "fake", "proxy",
  "express lane", "complete your set",
  "mystery", "surprise", "random", "blind",
  "break", "case break", "box break",
  "qty", "quantity", "bulk", "sealed", "pack",
  "panini direct", "fanatics",
  "non auto", "no auto", "non-auto", "without auto",
  "no patch", "non patch", "without patch",
  "base only", "unsigned", "not signed",
];

const GRADE_KEYWORDS = ["psa", "bgs", "sgc", "cgc"];

function strictFilter(items, query) {
  const queryLower = query.toLowerCase();

  // ── Detect what the search is asking for ──────────────────────────────────

  // Find exact set from query
  const matchedSet = Object.entries(EXACT_SETS).find(([name]) => queryLower.includes(name));
  const setRules = matchedSet ? matchedSet[1] : null;

  // Find parallel from query
  const searchedParallel = Object.keys(PARALLEL_CONFLICTS).find(p => new RegExp(`\\b${p}\\b`).test(queryLower));
  const conflictingParallels = searchedParallel ? PARALLEL_CONFLICTS[searchedParallel] : [];

  // Grade detection
  const gradeKeyword = GRADE_KEYWORDS.find(g => queryLower.includes(g));
  const gradeNumber = queryLower.match(/\b(10|9\.5|9|8\.5|8)\b/)?.[0];

  // Year detection
  const yearMatch = query.match(/\b(20\d{2}|19\d{2})\b/)?.[0];

  // Auto/patch detection
  const searchingAuto = queryLower.includes("auto");
  const searchingPatch = queryLower.includes("patch") || queryLower.includes("rpa");

  // Player name — longest non-keyword word in query
  const skipWords = ["panini", "topps", "bowman", "upper", "deck", "prizm", "chrome", "optic",
    "select", "mosaic", "silver", "gold", "auto", "patch", "refractor", "draft", "picks",
    "psa", "bgs", "sgc", "gem", "mint", "card", "the", "and", "with", "for", "base", "rpa"];
  const playerWords = queryLower.split(" ")
    .filter(w => w.length > 3 && !skipWords.includes(w) && !/^\d+$/.test(w));
  const primaryPlayerWord = playerWords.sort((a, b) => b.length - a.length)[0];

  return items.filter(item => {
    const price = parseFloat(item.price?.value);
    const title = (item.title || "").toLowerCase();

    // ── Basic sanity ─────────────────────────────────────────────────────────
    if (isNaN(price) || price < 5) return false;
    if (title.length > 130) return false;
    if (JUNK_KEYWORDS.some(k => title.includes(k))) return false;

    // ── Player name must appear ───────────────────────────────────────────────
    if (primaryPlayerWord && !title.includes(primaryPlayerWord)) return false;

    // ── EXACT SET matching ────────────────────────────────────────────────────
    if (setRules) {
      // All "must" words must be in title
      if (setRules.must.some(w => !title.includes(w))) return false;
      // None of the "mustNot" words can be in title
      if (setRules.mustNot.some(w => title.includes(w))) return false;
    }

    // ── PARALLEL matching ─────────────────────────────────────────────────────
    // Searched parallel must appear as a whole word
    if (searchedParallel && !new RegExp(`\\b${searchedParallel}\\b`).test(title)) return false;
    // Conflicting parallels must NOT appear
    if (conflictingParallels.some(p => new RegExp(`\\b${p}\\b`).test(title))) return false;

    // ── AUTO matching ─────────────────────────────────────────────────────────
    if (searchingAuto) {
      if (!title.includes("auto")) return false;
      if (["non auto","no auto","non-auto","without auto","unsigned","not signed"].some(k => title.includes(k))) return false;
    }

    // ── PATCH matching ────────────────────────────────────────────────────────
    if (searchingPatch) {
      if (!title.includes("patch") && !title.includes("rpa")) return false;
      if (["no patch","non patch","without patch"].some(k => title.includes(k))) return false;
    }

    // ── GRADE matching ────────────────────────────────────────────────────────
    if (gradeKeyword && !title.includes(gradeKeyword)) return false;
    if (gradeNumber && !new RegExp(`\\b${gradeNumber}\\b`).test(title)) return false;

    // ── YEAR matching ─────────────────────────────────────────────────────────
    if (yearMatch) {
      const sy = parseInt(yearMatch);
      const titleYears = [...title.matchAll(/\b(19|20)\d{2}\b/g)].map(m => parseInt(m[0]));
      if (titleYears.length > 0) {
        const closest = titleYears.reduce((a, b) => Math.abs(b - sy) < Math.abs(a - sy) ? b : a);
        if (Math.abs(closest - sy) > 1) return false;
      }
    }

    return true;
  });
}

async function getSpread(token, query) {
  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&filter=buyingOptions:{FIXED_PRICE}&sort=price&limit=50`;
  const res = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } });
  const data = await res.json();
  const rawItems = data.itemSummaries || [];
  if (rawItems.length === 0) return null;

  const filtered = strictFilter(rawItems, query);
  if (filtered.length < 4) return null;

  const prices = filtered.map(i => parseFloat(i.price?.value)).sort((a, b) => a - b);

  // Remove top and bottom 20% as outliers
  const trimCount = Math.max(1, Math.floor(prices.length * 0.20));
  const trimmedPrices = prices.slice(trimCount, prices.length - trimCount);
  if (trimmedPrices.length < 3) return null;

  const low = trimmedPrices[0];
  const high = trimmedPrices[trimmedPrices.length - 1];
  const spread = high - low;
  const spreadPct = Math.round((spread / low) * 100);

  // Must be at least 20% spread and $8 gap
  if (spreadPct < 20) return null;
  if (spread < 8) return null;

  // Hard cap — over 70% spread means different cards are mixed in
  if (spreadPct > 70) return null;

  const cheapest = filtered
    .sort((a, b) => parseFloat(a.price?.value) - parseFloat(b.price?.value))
    .slice(0, 3)
    .map(item => {
      const price = parseFloat(item.price?.value);
      return {
        title: item.title,
        price: price.toFixed(2),
        url: item.itemWebUrl,
        image: item.image?.imageUrl,
        condition: item.condition,
        savingsVsHigh: (high - price).toFixed(2),
        savingsPct: Math.round(((high - price) / high) * 100),
      };
    });

  return {
    query,
    priceRange: { low: low.toFixed(2), high: high.toFixed(2), spread: spread.toFixed(2), spreadPct, count: filtered.length },
    cheapest,
    soldSearchUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`,
  };
}

const SCAN_CATEGORIES = {
  basketball: [
    "2021 Panini Prizm Cade Cunningham Silver PSA 10",
    "2021 Panini Prizm Scottie Barnes Silver PSA 10",
    "2022 Panini Prizm Paolo Banchero Silver PSA 10",
    "2023 Panini Prizm Victor Wembanyama Silver PSA 10",
    "2022 Panini Prizm Jabari Smith Silver PSA 10",
    "2021 Panini Prizm Evan Mobley Silver PSA 10",
    "2023 Panini Prizm Scoot Henderson Silver PSA 10",
    "2022 Panini Prizm Keegan Murray Silver PSA 10",
    "2023 Panini Prizm Amen Thompson Silver PSA 10",
    "2022 Panini Prizm Jalen Williams Silver PSA 10",
  ],
  football: [
    "2023 Panini Prizm CJ Stroud Silver PSA 10",
    "2023 Panini Prizm Bryce Young Silver PSA 10",
    "2023 Panini Prizm Anthony Richardson Silver PSA 10",
    "2022 Panini Prizm Brock Purdy Silver PSA 10",
    "2023 Panini Prizm Puka Nacua Silver PSA 10",
    "2022 Panini Prizm Breece Hall Silver PSA 10",
    "2023 Panini Prizm Jahmyr Gibbs Silver PSA 10",
    "2023 Panini Prizm Jordan Addison Silver PSA 10",
    "2023 Panini Prizm Zay Flowers Silver PSA 10",
    "2023 Panini Prizm Jaxon Smith-Njigba Silver PSA 10",
  ],
  baseball: [
    "2022 Bowman Chrome Julio Rodriguez auto refractor PSA 10",
    "2022 Bowman Chrome Gunnar Henderson auto refractor PSA 10",
    "2023 Topps Chrome Corbin Carroll auto refractor",
    "2022 Topps Chrome Julio Rodriguez PSA 10",
    "2023 Bowman Chrome Paul Skenes auto refractor",
    "2023 Topps Chrome Gunnar Henderson PSA 10",
    "2022 Bowman Chrome Jeremy Pena auto refractor",
    "2023 Topps Chrome Ronald Acuna PSA 10",
    "2022 Bowman Chrome Bobby Miller auto refractor",
    "2023 Bowman Chrome Dylan Crews auto refractor",
  ],
  hockey: [
    "2022 Upper Deck Young Guns Connor Bedard PSA 10",
    "2021 Upper Deck Young Guns Mason McTavish PSA 10",
    "2022 Upper Deck Young Guns Shane Wright PSA 10",
    "2021 Upper Deck Young Guns Lucas Raymond PSA 10",
    "2021 Upper Deck Young Guns Moritz Seider PSA 10",
    "2022 Upper Deck Young Guns Matty Beniers PSA 10",
    "2023 Upper Deck Young Guns Connor Bedard PSA 10",
    "2021 Upper Deck Young Guns Cole Perfetti PSA 10",
    "2022 Upper Deck Young Guns Matthew Knies PSA 10",
    "2021 Upper Deck Young Guns Jamie Drysdale PSA 10",
  ],
};

app.get("/api/scan", async (req, res) => {
  const { sport } = req.query;
  if (!sport || !SCAN_CATEGORIES[sport]) return res.status(400).json({ error: "Invalid sport" });
  try {
    const token = await getEbayToken();
    const deals = [];
    for (const query of SCAN_CATEGORIES[sport]) {
      const result = await getSpread(token, query);
      if (result) deals.push(result);
    }
    deals.sort((a, b) => b.priceRange.spreadPct - a.priceRange.spreadPct);
    res.json({ deals, sport, total: deals.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/spread", async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: "query is required" });
  try {
    const token = await getEbayToken();
    const result = await getSpread(token, query);
    if (!result) return res.json({ message: "Not enough matching listings or spread too small" });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => res.send("CardFlip AI backend is running!"));
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("CardFlip backend running on port " + PORT));
