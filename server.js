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

const JUNK_KEYWORDS = ["you pick", "pick your", "lot of", "reprint", "custom made", "express lane", "choose your", "complete your set", "pick one", "mystery", "wholesale", "bundle of", "random", "surprise", "blind", "break", "case", "box", "pack", "qty", "quantity"];
const GRADE_KEYWORDS = ["psa", "bgs", "sgc", "cgc"];

async function getSpread(token, query) {
  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&filter=buyingOptions:{FIXED_PRICE}&sort=price&limit=50`;
  const res = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } });
  const data = await res.json();
  const rawItems = data.itemSummaries || [];
  if (rawItems.length === 0) return null;

  const queryLower = query.toLowerCase();
  const BRANDS = ["prizm", "topps chrome", "bowman chrome", "donruss optic", "optic", "mosaic", "select", "national treasures", "flawless", "immaculate", "upper deck", "bowman", "topps"];
  const INSERTS = ["silver", "gold", "red", "blue", "green", "purple", "orange", "black", "holo", "refractor", "auto", "autograph", "patch", "rpa", "hyper", "neon", "disco"];

  const searchBrand = BRANDS.find(b => queryLower.includes(b));
  const searchInserts = INSERTS.filter(i => queryLower.includes(i));
  const gradeNumber = queryLower.match(/\b(10|9\.5|9|8\.5|8)\b/)?.[0];
  const yearMatch = query.match(/\b(19|20)\d{2}\b/)?.[0];
  const searchHasGrade = GRADE_KEYWORDS.some(g => queryLower.includes(g));
  const queryWords = queryLower.split(" ").filter(w => w.length > 2 && !["card","and","the","with","for","base","gem","mint"].includes(w));
  const mustMatchWords = queryWords.sort((a,b) => b.length - a.length).slice(0, 3);

  const filtered = rawItems.filter(item => {
    const price = parseFloat(item.price?.value);
    const title = (item.title || "").toLowerCase();
    if (isNaN(price) || price < 5) return false;
    if (JUNK_KEYWORDS.some(k => title.includes(k))) return false;
    if (searchHasGrade && !GRADE_KEYWORDS.some(g => title.includes(g))) return false;
    if (gradeNumber && !title.includes(gradeNumber)) return false;
    if (searchBrand && !title.includes(searchBrand)) return false;
    if (searchInserts.length > 0 && searchInserts.filter(i => !title.includes(i)).length > 1) return false;
    if (!mustMatchWords.every(w => title.includes(w))) return false;
    if (title.length > 150) return false;
    if (yearMatch) {
      const sy = parseInt(yearMatch);
      const years = [...title.matchAll(/\b(19|20)\d{2}\b/g)].map(m => parseInt(m[0]));
      if (years.length > 0 && Math.min(...years.map(y => Math.abs(y - sy))) > 2) return false;
    }
    return true;
  });

  if (filtered.length < 3) return null;

  const prices = filtered.map(i => parseFloat(i.price?.value)).sort((a,b) => a - b);
  const low = prices[0];
  const high = prices[prices.length - 1];
  const spread = high - low;
  const spreadPct = Math.round((spread / low) * 100);

  // Only return if spread is meaningful (at least 20% gap)
  if (spreadPct < 20) return null;

  const cheapest = filtered
    .sort((a,b) => parseFloat(a.price?.value) - parseFloat(b.price?.value))
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

// Pre-built deal scan categories
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
    "2021 Bowman Chrome Cade Cunningham auto",
    "2023 Panini Prizm Amen Thompson Silver PSA 10",
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
    "2022 Panini Prizm Christian Watson Silver PSA 10",
    "2023 Panini Prizm Zay Flowers Silver PSA 10",
  ],
  baseball: [
    "2022 Bowman Chrome Julio Rodriguez auto PSA 10",
    "2023 Bowman Chrome Jackson Holliday auto",
    "2022 Bowman Chrome Gunnar Henderson auto",
    "2023 Topps Chrome Corbin Carroll auto",
    "2022 Bowman Chrome Jordyn Adams auto",
    "2023 Bowman Chrome Dylan Crews auto",
    "2022 Topps Chrome Julio Rodriguez PSA 10",
    "2023 Bowman Chrome Paul Skenes auto",
    "2022 Bowman Chrome Jeremy Pena auto",
    "2023 Topps Chrome Gunnar Henderson PSA 10",
  ],
  hockey: [
    "2022 Upper Deck Young Guns Connor Bedard PSA 10",
    "2021 Upper Deck Young Guns Mason McTavish PSA 10",
    "2022 Upper Deck Young Guns Shane Wright PSA 10",
    "2021 Upper Deck Young Guns Lucas Raymond PSA 10",
    "2022 Upper Deck Young Guns Logan Cooley PSA 10",
    "2021 Upper Deck Young Guns Moritz Seider PSA 10",
    "2022 Upper Deck Young Guns Matty Beniers PSA 10",
    "2023 Upper Deck Young Guns Connor Bedard PSA 10",
    "2021 Upper Deck Young Guns Cole Perfetti PSA 10",
    "2022 Upper Deck Young Guns Matthew Knies PSA 10",
  ],
};

app.get("/api/scan", async (req, res) => {
  const { sport } = req.query;
  if (!sport || !SCAN_CATEGORIES[sport]) {
    return res.status(400).json({ error: "Invalid sport. Use: basketball, football, baseball, hockey" });
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
    if (!result) return res.json({ listings: [], message: "Not enough matching listings or spread too small" });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => res.send("CardFlip AI backend is running!"));
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("CardFlip backend running on port " + PORT));
