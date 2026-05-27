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

// Browse API - get active listings
async function getActiveListings(token, query) {
  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&filter=buyingOptions:{FIXED_PRICE}&sort=price&limit=25`;
  const res = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } });
  const data = await res.json();
  return data.itemSummaries || [];
}

// Finding API - get real sold/completed listings
async function getSoldListings(query) {
  const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<findCompletedItemsRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <keywords>${query}</keywords>
  <itemFilter>
    <name>SoldItemsOnly</name>
    <value>true</value>
  </itemFilter>
  <itemFilter>
    <name>ListingType</name>
    <value>FixedPrice</value>
  </itemFilter>
  <paginationInput>
    <entriesPerPage>25</entriesPerPage>
  </paginationInput>
</findCompletedItemsRequest>`;

  const res = await fetch("https://svcs.ebay.com/services/search/FindingService/v1?OPERATION-NAME=findCompletedItems&SERVICE-VERSION=1.0.0&SECURITY-APPNAME=" + CLIENT_ID + "&RESPONSE-DATA-FORMAT=JSON&REST-PAYLOAD", {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-SOA-OPERATION-NAME": "findCompletedItems",
      "X-EBAY-SOA-SECURITY-APPNAME": CLIENT_ID,
      "X-EBAY-SOA-RESPONSE-DATA-FORMAT": "JSON",
    },
    body: xmlBody,
  });

  const data = await res.json();
  try {
    const items = data.findCompletedItemsResponse[0].searchResult[0].item || [];
    return items;
  } catch {
    return [];
  }
}

function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function isSameCard(title1, title2) {
  // Extract key identifiers — year, player name words
  const clean = t => t.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").filter(w => w.length > 2);
  const words1 = clean(title1);
  const words2 = clean(title2);
  const shared = words1.filter(w => words2.includes(w));
  // Must share at least 40% of words to be considered the same card
  return shared.length / Math.max(words1.length, words2.length) >= 0.4;
}

app.get("/api/flip", async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: "query is required" });

  try {
    const token = await getEbayToken();

    // Get both active and sold listings in parallel
    const [activeItems, soldItems] = await Promise.all([
      getActiveListings(token, query),
      getSoldListings(query),
    ]);

    if (activeItems.length === 0) {
      return res.json({ flips: [], avgSoldPrice: "0", soldCount: 0, message: "No active listings found" });
    }

    // Calculate real sold price from Finding API
    let realSoldPrices = [];
    if (soldItems.length > 0) {
      realSoldPrices = soldItems
        .map(i => parseFloat(i.sellingStatus?.[0]?.currentPrice?.[0]?.__value__))
        .filter(p => !isNaN(p) && p > 0);
    }

    // Fall back to Browse API active listing median if no sold data
    const activePrices = activeItems
      .map(i => parseFloat(i.price?.value))
      .filter(p => !isNaN(p) && p > 0);

    const soldMedian = realSoldPrices.length >= 3 ? median(realSoldPrices) : null;
    const activeMedian = median(activePrices);
    const targetPrice = soldMedian || activeMedian;

    if (targetPrice === 0) {
      return res.json({ flips: [], avgSoldPrice: "0", soldCount: 0 });
    }

    // Suspicious keywords that indicate bulk/wrong listings
    const JUNK_KEYWORDS = ["you pick", "pick your", "lot ", "reprint", "custom", "express lane", "choose your", "complete your set", "pick one", "mystery", "wholesale", "bundle"];

    // Grading keywords — if search contains one, listing must too
    const GRADE_KEYWORDS = ["psa", "bgs", "sgc", "cgc", "beckett"];

    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(" ").filter(w => w.length > 2);

    // Extract the most important word (likely player last name — longest word)
    const keyWord = queryWords.sort((a, b) => b.length - a.length)[0];

    // Check if search includes a grading keyword
    const searchHasGrade = GRADE_KEYWORDS.some(g => queryLower.includes(g));

    const flips = activeItems
      .filter(item => {
        const price = parseFloat(item.price?.value);
        const title = (item.title || "").toLowerCase();

        if (isNaN(price) || price <= 0) return false;

        // Minimum $5 listing price
        if (price < 5) return false;

        // Must be below target price by at least 10%
        if (price >= targetPrice * 0.90) return false;

        // Profit must be at least $3
        if (targetPrice - price < 3) return false;

        // Profit % must be under 80% — anything higher is almost certainly wrong card
        if ((targetPrice - price) / price > 0.80) return false;

        // Must contain the key search word (e.g. player last name)
        if (keyWord && !title.includes(keyWord)) return false;

        // If search has a grade, listing must have a grade too
        if (searchHasGrade && !GRADE_KEYWORDS.some(g => title.includes(g))) return false;

        // Eliminate junk/bulk listings
        if (JUNK_KEYWORDS.some(k => title.includes(k))) return false;

        // Title must contain at least 60% of query words
        const matchedWords = queryWords.filter(w => title.includes(w));
        if (matchedWords.length / queryWords.length < 0.6) return false;

        return true;
      })
      .map(item => {
        const buyPrice = parseFloat(item.price?.value);
        const profit = targetPrice - buyPrice;
        const profitPct = Math.round((profit / buyPrice) * 100);
        return {
          title: item.title,
          listPrice: buyPrice.toFixed(2),
          avgSoldPrice: targetPrice.toFixed(2),
          estimatedProfit: profit.toFixed(2),
          profitPct,
          url: item.itemWebUrl,
          image: item.image?.imageUrl,
          condition: item.condition,
          dataSource: soldMedian ? "real sold data" : "active listing median",
          soldSampleSize: realSoldPrices.length,
        };
      })
      // Sort by profit % descending
      .sort((a, b) => b.profitPct - a.profitPct)
      // Cap at 10 results
      .slice(0, 10);

    res.json({
      flips,
      avgSoldPrice: targetPrice.toFixed(2),
      soldCount: realSoldPrices.length,
      activeCount: activePrices.length,
      dataSource: soldMedian ? "eBay sold listings (real data)" : "active listing median (fallback)",
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => res.send("CardFlip AI backend is running!"));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("CardFlip backend running on port " + PORT));
