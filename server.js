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
  return data.access_token;
}

app.get("/api/flip", async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: "query is required" });

  try {
    const token = await getEbayToken();

    // Get active listings sorted by price ascending, limit 20
    const searchUrl = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&filter=buyingOptions:{FIXED_PRICE}&sort=price&limit=20`;
    const searchRes = await fetch(searchUrl, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    const searchData = await searchRes.json();
    const items = searchData.itemSummaries || [];

    if (items.length === 0) {
      return res.json({ flips: [], avgSoldPrice: 0, soldCount: 0, message: "No listings found" });
    }

    // Calculate average price from all listings
    const prices = items.map(i => parseFloat(i.price?.value)).filter(p => !isNaN(p) && p > 0);
    if (prices.length === 0) return res.json({ flips: [], avgSoldPrice: 0, soldCount: 0 });

    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const medianPrice = prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)];

    // Show listings that are at least 10% below the median (much looser threshold)
    const flipThreshold = medianPrice * 0.90;

    const flips = items
      .filter(item => {
        const p = parseFloat(item.price?.value);
        return !isNaN(p) && p > 0 && p <= flipThreshold;
      })
      .map(item => {
        const buyPrice = parseFloat(item.price?.value);
        const estimatedProfit = medianPrice - buyPrice;
        const profitPct = Math.round((estimatedProfit / buyPrice) * 100);
        return {
          title: item.title,
          listPrice: buyPrice.toFixed(2),
          avgSoldPrice: medianPrice.toFixed(2),
          estimatedProfit: estimatedProfit.toFixed(2),
          profitPct,
          url: item.itemWebUrl,
          image: item.image?.imageUrl,
          condition: item.condition,
        };
      })
      .filter(f => f.profitPct > 5); // at least 5% profit

    res.json({ flips, avgSoldPrice: medianPrice.toFixed(2), soldCount: prices.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => res.send("CardFlip AI backend is running!"));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`CardFlip backend running on port ${PORT}`));
