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

// Get active listings via Browse API
async function getActiveListings(token, query) {
  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&filter=buyingOptions:{FIXED_PRICE}&sort=price&limit=50`;
  const res = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } });
  const data = await res.json();
  return data.itemSummaries || [];
}

// Get REAL sold prices via Finding API (GET method - simpler and more reliable)
async function getRealSoldPrices(query) {
  try {
    const encodedQuery = encodeURIComponent(query);
    const appId = encodeURIComponent(CLIENT_ID);
    const url = `https://svcs.ebay.com/services/search/FindingService/v1?OPERATION-NAME=findCompletedItems&SERVICE-VERSION=1.0.0&SECURITY-APPNAME=${appId}&RESPONSE-DATA-FORMAT=JSON&keywords=${encodedQuery}&itemFilter%280%29.name=SoldItemsOnly&itemFilter%280%29.value=true&itemFilter%281%29.name=ListingType&itemFilter%281%29.value=FixedPrice&paginationInput.entriesPerPage=50&sortOrder=EndTimeSoonest`;
    const res = await fetch(url);
    const text = await res.text();
    const data = JSON.parse(text);
    const items = data?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];
    console.log(`Finding API: ${items.length} sold for "${query}"`);
    return items.map(i => ({ title: i.title?.[0] || "", price: parseFloat(i.sellingStatus?.[0]?.currentPrice?.[0]?.__value__ || "0") })).filter(i => !isNaN(i.price) && i.price > 0);
  } catch(e) {
    console.error("Finding API error:", e.message);
    return [];
  }
}

function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Filter sold items to only those matching the same card
function filterRelevantSolds(soldItems, filters) {
  const { searchBrand, searchInserts, gradeNumber, mustMatchWords, yearMatch } = filters;
  return soldItems.filter(item => {
    const title = item.title.toLowerCase();
    if (mustMatchWords.length > 0 && !mustMatchWords.every(w => title.includes(w))) return false;
    if (searchBrand && !title.includes(searchBrand)) return false;
    if (gradeNumber && !title.includes(gradeNumber)) return false;
    if (searchInserts.length > 0) {
      const missing = searchInserts.filter(ins => !title.includes(ins));
      if (missing.length > 1) return false;
    }
    if (yearMatch) {
      const searchYear = parseInt(yearMatch);
      const titleYears = [...title.matchAll(/\b(19|20)\d{2}\b/g)].map(m => parseInt(m[0]));
      if (titleYears.length > 0) {
        const closest = titleYears.reduce((a, b) => Math.abs(b - searchYear) < Math.abs(a - searchYear) ? b : a);
        if (Math.abs(closest - searchYear) > 2) return false;
      }
    }
    return true;
  });
}

app.get("/api/flip", async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: "query is required" });

  try {
    const token = await getEbayToken();

    // Run both in parallel
    const [activeItems, allSoldItems] = await Promise.all([
      getActiveListings(token, query),
      getRealSoldPrices(query),
    ]);

    if (activeItems.length === 0) {
      return res.json({ flips: [], avgSoldPrice: "0", soldCount: 0, message: "No listings found" });
    }

    const JUNK_KEYWORDS = ["you pick", "pick your", "lot of", "reprint", "custom made", "express lane", "choose your", "complete your set", "pick one", "mystery", "wholesale", "bundle of", "random", "surprise", "blind", "multi", "break", "case", "box", "pack", "panini direct", "qty", "quantity"];
    const GRADE_KEYWORDS = ["psa", "bgs", "sgc", "cgc", "beckett"];
    const BRANDS = ["prizm", "topps chrome", "bowman chrome", "donruss optic", "optic", "mosaic", "select", "chronicles", "national treasures", "flawless", "immaculate", "spectra", "contenders", "hoops", "upper deck", "panini", "bowman", "topps"];
    const INSERTS = ["silver", "gold", "red", "blue", "green", "purple", "orange", "pink", "black", "holo", "refractor", "rookie", "auto", "autograph", "patch", "rpa", "fireworks", "hyper", "neon", "disco", "shimmer"];

    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(" ").filter(w => w.length > 2);
    const searchHasGrade = GRADE_KEYWORDS.some(g => queryLower.includes(g));
    const searchBrand = BRANDS.find(b => queryLower.includes(b));
    const searchInserts = INSERTS.filter(ins => queryLower.includes(ins));
    const gradeNumber = queryLower.match(/\b(10|9\.5|9|8\.5|8)\b/)?.[0];
    const yearMatch = query.match(/\b(19|20)\d{2}\b/)?.[0];
    const significantWords = queryWords
      .filter(w => !["card", "and", "the", "with", "for", "base", "gem", "mint"].includes(w))
      .sort((a, b) => b.length - a.length);
    const mustMatchWords = significantWords.slice(0, 3);

    const filters = { searchBrand, searchInserts, gradeNumber, mustMatchWords, yearMatch };

    // Filter sold items to same card type — this gives us a REAL median
    const relevantSolds = filterRelevantSolds(allSoldItems, filters);
    const soldPrices = relevantSolds.map(i => i.price);

    // Filter active listings to same card type
    const activePrices = activeItems
      .map(i => parseFloat(i.price?.value))
      .filter(p => !isNaN(p) && p > 0);

    // Use real sold median if we have enough data (3+ sales), otherwise fall back
    const soldMedian = soldPrices.length >= 3 ? median(soldPrices) : null;
    const activeMedian = median(activePrices);
    const targetPrice = soldMedian || activeMedian;

    if (targetPrice === 0) return res.json({ flips: [], avgSoldPrice: "0", soldCount: 0 });

    const flips = activeItems
      .filter(item => {
        const price = parseFloat(item.price?.value);
        const title = (item.title || "").toLowerCase();

        if (isNaN(price) || price <= 0) return false;
        if (price < 5) return false;
        if (price >= targetPrice * 0.88) return false;
        if (targetPrice - price < 4) return false;
        if ((targetPrice - price) / price > 0.95) return false;
        if (searchHasGrade && !GRADE_KEYWORDS.some(g => title.includes(g))) return false;
        if (gradeNumber && !title.includes(gradeNumber)) return false;
        if (searchBrand && !title.includes(searchBrand)) return false;
        if (searchInserts.length > 0) {
          const missing = searchInserts.filter(ins => !title.includes(ins));
          if (missing.length > 1) return false;
        }
        if (yearMatch) {
          const searchYear = parseInt(yearMatch);
          const titleYears = [...title.matchAll(/\b(19|20)\d{2}\b/g)].map(m => parseInt(m[0]));
          if (titleYears.length > 0) {
            const closest = titleYears.reduce((a, b) => Math.abs(b - searchYear) < Math.abs(a - searchYear) ? b : a);
            if (Math.abs(closest - searchYear) > 2) return false;
          }
        }
        if (JUNK_KEYWORDS.some(k => title.includes(k))) return false;
        if (!mustMatchWords.every(w => title.includes(w))) return false;
        if (title.length > 150) return false;

        return true;
      })
      .map(item => {
        const buyPrice = parseFloat(item.price?.value);
        const profit = targetPrice - buyPrice;
        return {
          title: item.title,
          listPrice: buyPrice.toFixed(2),
          avgSoldPrice: targetPrice.toFixed(2),
          estimatedProfit: profit.toFixed(2),
          profitPct: Math.round((profit / buyPrice) * 100),
          url: item.itemWebUrl,
          image: item.image?.imageUrl,
          condition: item.condition,
          dataSource: soldMedian ? `real sold data (${soldPrices.length} sales)` : `active listing median (fallback)`,
        };
      })
      .sort((a, b) => b.profitPct - a.profitPct)
      .slice(0, 10);

    res.json({
      flips,
      avgSoldPrice: targetPrice.toFixed(2),
      soldCount: soldPrices.length,
      activeCount: activePrices.length,
      dataSource: soldMedian ? `real sold data (${soldPrices.length} recent sales)` : "active listing median (fallback - need more sold data)",
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => res.send("CardFlip AI backend is running!"));
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("CardFlip backend running on port " + PORT));
