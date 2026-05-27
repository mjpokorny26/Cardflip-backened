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

const JUNK_KEYWORDS = [
  "you pick", "pick your", "pick one", "choose your",
  "lot of", "bundle of", "multi", "wholesale",
  "reprint", "custom", "fake", "proxy",
  "express lane", "complete your set",
  "mystery", "surprise", "random", "blind",
  "break", "case break", "box break",
  "qty", "quantity", "bulk",
  "case", "sealed", "pack",
  "panini direct", "fanatics"
];

const GRADE_KEYWORDS = ["psa", "bgs", "sgc", "cgc", "beckett"];

const BRANDS = [
  "prizm", "topps chrome", "bowman chrome", "donruss optic",
  "optic", "mosaic", "select", "national treasures",
  "flawless", "immaculate", "spectra", "contenders",
  "hoops", "upper deck", "bowman", "topps"
];

const INSERTS = [
  "silver", "gold", "red", "blue", "green", "purple",
  "orange", "pink", "black", "white", "holo",
  "refractor", "auto", "autograph", "patch", "rpa",
  "hyper", "neon", "disco", "shimmer", "tiger",
  "wave", "fast break", "choice", "cracked ice"
];

function strictFilter(items, query) {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(" ").filter(w => w.length > 2);

  // Extract all components from query
  const searchBrand = BRANDS.find(b => queryLower.includes(b));
  const searchInserts = INSERTS.filter(i => queryLower.includes(i));
  const gradeKeyword = GRADE_KEYWORDS.find(g => queryLower.includes(g));
  const gradeNumber = queryLower.match(/\b(10|9\.5|9|8\.5|8)\b/)?.[0];
  const yearMatch = query.match(/\b(20\d{2}|19\d{2})\b/)?.[0];

  // Extract player name words (non-brand, non-insert, non-grade, non-year words)
  const stopWords = ["card", "and", "the", "with", "for", "base", "gem", "mint", "rc", "rookie", ...GRADE_KEYWORDS];
  const playerWords = queryWords.filter(w =>
    !stopWords.includes(w) &&
    !BRANDS.some(b => b.includes(w)) &&
    !INSERTS.includes(w) &&
    !GRADE_KEYWORDS.includes(w) &&
    !/^\d+$/.test(w)
  );

  // The most important player word (longest = most unique, e.g. "wembanyama" vs "victor")
  const primaryPlayerWord = playerWords.sort((a, b) => b.length - a.length)[0];

  return items.filter(item => {
    const price = parseFloat(item.price?.value);
    const title = (item.title || "").toLowerCase();

    // Price sanity
    if (isNaN(price) || price < 5) return false;

    // No junk listings
    if (JUNK_KEYWORDS.some(k => title.includes(k))) return false;

    // Title must not be keyword-stuffed
    if (title.length > 120) return false;

    // PLAYER: primary player word MUST be in title
    if (primaryPlayerWord && !title.includes(primaryPlayerWord)) return false;

    // BRAND: must be exact match — "prizm" listing must say "prizm"
    if (searchBrand && !title.includes(searchBrand)) return false;

    // INSERTS: ALL insert keywords from search must appear in listing title
    // e.g. "silver prizm" → title must contain "silver"
    // e.g. "gold auto patch" → title must contain "gold", "auto", "patch"
    if (searchInserts.length > 0) {
      const missingInserts = searchInserts.filter(ins => !title.includes(ins));
      if (missingInserts.length > 0) return false; // ZERO tolerance — all inserts must match
    }

    // GRADE: if searching PSA, listing must say PSA
    if (gradeKeyword && !title.includes(gradeKeyword)) return false;

    // GRADE NUMBER: must match exactly — no PSA 9 when searching PSA 10
    if (gradeNumber && !new RegExp(`\\b${gradeNumber}\\b`).test(title)) return false;

    // YEAR: must be within 1 year (not 2 — stricter)
    if (yearMatch) {
      const sy = parseInt(yearMatch);
      const titleYears = [...title.matchAll(/\b(19|20)\d{2}\b/g)].map(m => parseInt(m[0]));
      if (titleYears.length > 0) {
        const closest = titleYears.reduce((a, b) => Math.abs(b - sy) < Math.abs(a - sy) ? b : a);
        if (Math.abs(closest - sy) > 1) return false; // within 1 year only
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

  // Need at least 4 listings to calculate a meaningful spread
  if (filtered.length < 4) return null;

  const prices = filtered.map(i => parseFloat(i.price?.value)).sort((a, b) => a - b);

  // Remove outliers — ignore bottom 10% and top 10% prices
  const trimCount = Math.max(1, Math.floor(prices.length * 0.1));
  const trimmedPrices = prices.slice(trimCount, prices.length - trimCount);

  if (trimmedPrices.length < 3) return null;

  const low = trimmedPrices[0];
  const high = trimmedPrices[trimmedPrices.length - 1];
  const spread = high - low;
  const spreadPct = Math.round((spread / low) * 100);

  // Minimum 25% spread to show as a deal
  if (spreadPct < 25) return null;

  // Minimum $8 dollar spread — eliminates cheap card noise
  if (spread < 8) return null;

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
    priceRange: {
      low: low.toFixed(2),
      high: high.toFixed(2),
      spread: spread.toFixed(2),
      spreadPct,
      count: filtered.length,
    },
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
    "2022 Bowman Chrome Julio Rodriguez auto refractor",
    "2023 Bowman Chrome Jackson Holliday auto refractor",
    "2022 Bowman Chrome Gunnar Henderson auto refractor",
    "2023 Topps Chrome Corbin Carroll auto refractor",
    "2023 Bowman Chrome Dylan Crews auto refractor",
    "2022 Topps Chrome Julio Rodriguez PSA 10",
    "2023 Bowman Chrome Paul Skenes auto refractor",
    "2023 Topps Chrome Gunnar Henderson PSA 10",
    "2022 Bowman Chrome Jeremy Pena auto refractor",
    "2023 Topps Chrome Ronald Acuna PSA 10",
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
  if (!sport || !SCAN_CATEGORIES[sport]) {
    return res.status(400).json({ error: "Invalid sport" });
  }
  try {
    const token = await getEbayToken();
    const queries = SCAN_CATEGORIES[sport];
    const deals = [];
    for (const query of queries) {
      const result = await getSpread(token, query);
      if (result) deals.push(result);
    }
    deals.sort((a, b) => b.priceRange.spreadPct - a.priceRange.spreadPct);
    res.json({ deals, sport, total: deals.length });
  } catch (err) {
    console.error(err);
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
