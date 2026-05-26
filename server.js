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

async function searchListings(token, query, limit = 25) {
  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&filter=buyingOptions:{FIXED_PRICE}&sort=price&limit=${limit}`;
  const res = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } });
  const data = await res.json();
  return data.itemSummaries || [];
}

app.get("/api/flip", async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: "query is required" });

  try {
    const token = await getEbayToken();
    const items = await searchListings(token, query, 25);

    if (items.length === 0) {
      return res.json({ flips: [], avgSoldPrice: "0", soldCount: 0, allListings: [], message: "No listings found on eBay for this search." });
    }

    const priced = items
      .map(i => ({ ...i, numPrice: parseFloat(i.price?.value) }))
      .filter(i => !isNaN(i.numPrice) && i.numPrice > 0)
      .sort((a, b) => a.numPrice - b.numPrice);

    const prices = priced.map(i => i.numPrice);
    const median = prices[Math.floor(prices.length / 2)];
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    // Use the upper 40% of listings as the "sell target" — what patient sellers get
    const upperQuartileIndex = Math.floor(prices.length * 0.6);
    const sellTarget = prices[upperQuartileIndex] || avg;

    // Flips = bottom 40% of listings that are at least 8% below sell target
    const flipCutoff = sellTarget * 0.92;
    const flips = priced
      .filter(i => i.numPrice <= flipCutoff)
      .map(i => ({
        title: i.title,
        listPrice: i.numPrice.toFixed(2),
        avgSoldPrice: sellTarget.toFixed(2),
        estimatedProfit: (sellTarget - i.numPrice).toFixed(2),
        profitPct: Math.round(((sellTarget - i.numPrice) / i.numPrice) * 100),
        url: i.itemWebUrl,
        image: i.image?.imageUrl,
        condition: i.condition,
      }));

    // Also return ALL listings so frontend can show market overview
    const allListings = priced.slice(0, 10).map(i => ({
      title: i.title,
      listPrice: i.numPrice.toFixed(2),
      url: i.itemWebUrl,
      image: i.image?.imageUrl,
      condition: i.condition,
    }));

    res.json({
      flips,
      allListings,
      avgSoldPrice: sellTarget.toFixed(2),
      medianPrice: median.toFixed(2),
      soldCount: prices.length,
      priceRange: { low: prices[0].toFixed(2), high: prices[prices.length - 1].toFixed(2) },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => res.send("CardFlip AI backend is running!"));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`CardFlip backend running on port ${PORT}`));
// appended marker
