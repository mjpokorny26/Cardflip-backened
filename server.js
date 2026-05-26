const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
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
  return data.access_token;
}

async function getSoldPrice(token, query) {
  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&filter=buyingOptions:{FIXED_PRICE}&sort=price&limit=10`;
  const res = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } });
  const data = await res.json();
  const items = data.itemSummaries || [];
  if (items.length === 0) return null;
  const prices = items.map(i => parseFloat(i.price?.value)).filter(p => !isNaN(p));
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  return { avg: avg.toFixed(2), count: prices.length, items };
}

async function getActiveListings(token, query, maxPrice) {
  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&filter=buyingOptions:{FIXED_PRICE},price:[0..${maxPrice}]&sort=price&limit=5`;
  const res = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } });
  const data = await res.json();
  return data.itemSummaries || [];
}

app.get("/api/flip", async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: "query is required" });
  try {
    const token = await getEbayToken();
    const soldData = await getSoldPrice(token, query);
    if (!soldData) return res.json({ flips: [], message: "No listings found" });
    const avgSold = parseFloat(soldData.avg);
    const buyTarget = (avgSold * 0.75).toFixed(2);
    const activeListings = await getActiveListings(token, query, buyTarget);
    const flips = activeListings.map(item => ({
      title: item.title,
      listPrice: item.price?.value,
      avgSoldPrice: avgSold,
      estimatedProfit: (avgSold - parseFloat(item.price?.value)).toFixed(2),
      profitPct: Math.round(((avgSold - parseFloat(item.price?.value)) / parseFloat(item.price?.value)) * 100),
      url: item.itemWebUrl,
      image: item.image?.imageUrl,
      condition: item.condition,
    }));
    res.json({ flips, avgSoldPrice: avgSold, soldCount: soldData.count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => res.send("CardFlip AI backend is running!"));
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
