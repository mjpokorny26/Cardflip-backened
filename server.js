cat > /mnt/user-data/outputs/server.js << 'ENDOFFILE'
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

// Each scan query has its own strict rules built in
// mustHave = ALL must appear in title
// mustNotHave = ANY of these kills the listing
const SCAN_CATEGORIES = {
  basketball: [
    {
      label: "2021 Panini Prizm Cade Cunningham Silver PSA 10",
      query: "2021 Panini Prizm Cade Cunningham Silver PSA 10",
      mustHave: ["prizm", "cunningham", "silver", "psa", "10"],
      mustNotHave: ["draft picks","optic","donruss","select","mosaic","instant impact","kaboom","fireworks","stained glass","monopoly","emergent","fearless","sensations","phenomenon","field level","gold","red","blue","green","purple","orange","black","hyper","neon","disco","shimmer","cracked ice","tiger","wave","non auto","lot","you pick","reprint","custom","express lane","qty"],
    },
    {
      label: "2022 Panini Prizm Paolo Banchero Silver PSA 10",
      query: "2022 Panini Prizm Paolo Banchero Silver PSA 10",
      mustHave: ["prizm", "banchero", "silver", "psa", "10"],
      mustNotHave: ["draft picks","optic","donruss","select","mosaic","instant impact","kaboom","fireworks","gold","red","blue","green","purple","orange","black","hyper","neon","disco","non auto","lot","you pick","reprint","express lane"],
    },
    {
      label: "2023 Panini Prizm Victor Wembanyama Silver PSA 10",
      query: "2023 Panini Prizm Victor Wembanyama Silver PSA 10",
      mustHave: ["prizm", "wembanyama", "silver", "psa", "10"],
      mustNotHave: ["draft picks","optic","donruss","select","mosaic","instant impact","kaboom","fireworks","stained glass","monopoly","gold","red","blue","green","purple","orange","black","hyper","neon","disco","shimmer","cracked ice","non auto","lot","you pick","reprint","express lane"],
    },
    {
      label: "2021 Panini Prizm Evan Mobley Silver PSA 10",
      query: "2021 Panini Prizm Evan Mobley Silver PSA 10",
      mustHave: ["prizm", "mobley", "silver", "psa", "10"],
      mustNotHave: ["draft picks","optic","donruss","select","mosaic","instant impact","gold","red","blue","green","purple","orange","black","hyper","neon","non auto","lot","you pick","reprint","express lane"],
    },
    {
      label: "2021 Donruss Optic Cade Cunningham Rated Rookie PSA 10",
      query: "2021 Donruss Optic Cade Cunningham Rated Rookie PSA 10",
      mustHave: ["optic", "cunningham", "rated rookie", "psa", "10"],
      mustNotHave: ["prizm","select","mosaic","silver","gold","red","blue","green","purple","orange","black","hyper","non auto","lot","you pick","reprint","express lane"],
    },
    {
      label: "2022 Donruss Optic Paolo Banchero Rated Rookie PSA 10",
      query: "2022 Donruss Optic Paolo Banchero Rated Rookie PSA 10",
      mustHave: ["optic", "banchero", "rated rookie", "psa", "10"],
      mustNotHave: ["prizm","select","mosaic","silver","gold","red","blue","green","purple","orange","black","non auto","lot","you pick","reprint","express lane"],
    },
    {
      label: "2023 Donruss Optic Victor Wembanyama Rated Rookie PSA 10",
      query: "2023 Donruss Optic Victor Wembanyama Rated Rookie PSA 10",
      mustHave: ["optic", "wembanyama", "rated rookie", "psa", "10"],
      mustNotHave: ["prizm","select","mosaic","silver","gold","red","blue","green","purple","orange","black","non auto","lot","you pick","reprint","express lane"],
    },
    {
      label: "2021 Panini Hoops Cade Cunningham Rookie PSA 10",
      query: "2021 Panini Hoops Cade Cunningham Rookie PSA 10",
      mustHave: ["hoops", "cunningham", "psa", "10"],
      mustNotHave: ["prizm","optic","donruss","select","mosaic","non auto","lot","you pick","reprint","express lane"],
    },
  ],
  football: [
    {
      label: "2023 Panini Prizm CJ Stroud Silver PSA 10",
      query: "2023 Panini Prizm CJ Stroud Silver PSA 10",
      mustHave: ["prizm", "stroud", "silver", "psa", "10"],
      mustNotHave: ["draft picks","optic","donruss","select","mosaic","instant impact","gold","red","blue","green","purple","orange","black","hyper","neon","disco","non auto","lot","you pick","reprint","express lane","qty"],
    },
    {
      label: "2023 Panini Prizm Bryce Young Silver PSA 10",
      query: "2023 Panini Prizm Bryce Young Silver PSA 10",
      mustHave: ["prizm", "young", "silver", "psa", "10"],
      mustNotHave: ["draft picks","optic","donruss","select","mosaic","gold","red","blue","green","purple","orange","black","hyper","neon","non auto","lot","you pick","reprint","express lane"],
    },
    {
      label: "2022 Panini Prizm Brock Purdy Silver PSA 10",
      query: "2022 Panini Prizm Brock Purdy Silver PSA 10",
      mustHave: ["prizm", "purdy", "silver", "psa", "10"],
      mustNotHave: ["draft picks","optic","donruss","select","mosaic","gold","red","blue","green","purple","orange","black","hyper","neon","non auto","lot","you pick","reprint","express lane"],
    },
    {
      label: "2023 Panini Prizm Puka Nacua Silver PSA 10",
      query: "2023 Panini Prizm Puka Nacua Silver PSA 10",
      mustHave: ["prizm", "nacua", "silver", "psa", "10"],
      mustNotHave: ["draft picks","optic","donruss","gold","red","blue","green","purple","orange","black","non auto","lot","you pick","reprint","express lane"],
    },
    {
      label: "2023 Donruss Optic CJ Stroud Rated Rookie PSA 10",
      query: "2023 Donruss Optic CJ Stroud Rated Rookie PSA 10",
      mustHave: ["optic", "stroud", "rated rookie", "psa", "10"],
      mustNotHave: ["prizm","select","mosaic","silver","gold","red","blue","green","purple","orange","black","non auto","lot","you pick","reprint","express lane"],
    },
    {
      label: "2023 Donruss Optic Bryce Young Rated Rookie PSA 10",
      query: "2023 Donruss Optic Bryce Young Rated Rookie PSA 10",
      mustHave: ["optic", "young", "rated rookie", "psa", "10"],
      mustNotHave: ["prizm","select","mosaic","silver","gold","red","blue","green","purple","orange","black","non auto","lot","you pick","reprint","express lane"],
    },
    {
      label: "2022 Donruss Optic Brock Purdy Rated Rookie PSA 10",
      query: "2022 Donruss Optic Brock Purdy Rated Rookie PSA 10",
      mustHave: ["optic", "purdy", "rated rookie", "psa", "10"],
      mustNotHave: ["prizm","select","mosaic","silver","gold","red","blue","green","purple","orange","black","non auto","lot","you pick","reprint","express lane"],
    },
    {
      label: "2023 Panini Score CJ Stroud Rookie PSA 10",
      query: "2023 Panini Score CJ Stroud Rookie PSA 10",
      mustHave: ["score", "stroud", "psa", "10"],
      mustNotHave: ["prizm","optic","donruss","non auto","lot","you pick","reprint","express lane"],
    },
  ],
  baseball: [
    {
      label: "2022 Bowman Chrome Julio Rodriguez Auto Refractor PSA 10",
      query: "2022 Bowman Chrome Julio Rodriguez auto refractor PSA 10",
      mustHave: ["bowman chrome", "rodriguez", "auto", "refractor", "psa", "10"],
      mustNotHave: ["topps chrome","bowman platinum","bowman sterling","non auto","no auto","unsigned","lot","you pick","reprint","express lane","gold refractor","red refractor","blue refractor","green refractor","purple refractor","orange refractor","black refractor","superfractor","atomic"],
    },
    {
      label: "2022 Bowman Chrome Gunnar Henderson Auto Refractor PSA 10",
      query: "2022 Bowman Chrome Gunnar Henderson auto refractor PSA 10",
      mustHave: ["bowman chrome", "henderson", "auto", "refractor", "psa", "10"],
      mustNotHave: ["topps chrome","bowman platinum","non auto","no auto","unsigned","lot","you pick","reprint","express lane","gold refractor","red refractor","blue refractor","green refractor","black refractor","superfractor"],
    },
    {
      label: "2023 Bowman Chrome Paul Skenes Auto Refractor PSA 10",
      query: "2023 Bowman Chrome Paul Skenes auto refractor PSA 10",
      mustHave: ["bowman chrome", "skenes", "auto", "refractor", "psa", "10"],
      mustNotHave: ["topps chrome","non auto","no auto","unsigned","lot","you pick","reprint","express lane","gold refractor","red refractor","blue refractor","superfractor"],
    },
    {
      label: "2022 Topps Chrome Julio Rodriguez PSA 10",
      query: "2022 Topps Chrome Julio Rodriguez PSA 10",
      mustHave: ["topps chrome", "rodriguez", "psa", "10"],
      mustNotHave: ["bowman chrome","bowman","auto","refractor","lot","you pick","reprint","express lane","gold","red","blue","green","purple","orange","black"],
    },
    {
      label: "2023 Topps Chrome Gunnar Henderson PSA 10",
      query: "2023 Topps Chrome Gunnar Henderson PSA 10",
      mustHave: ["topps chrome", "henderson", "psa", "10"],
      mustNotHave: ["bowman chrome","bowman","auto","lot","you pick","reprint","express lane","gold","red","blue","green","purple","orange","black"],
    },
    {
      label: "2023 Topps Chrome Corbin Carroll PSA 10",
      query: "2023 Topps Chrome Corbin Carroll PSA 10",
      mustHave: ["topps chrome", "carroll", "psa", "10"],
      mustNotHave: ["bowman","auto","lot","you pick","reprint","express lane","gold","red","blue","green","purple","orange","black"],
    },
    {
      label: "2023 Bowman Chrome Dylan Crews Auto Refractor PSA 10",
      query: "2023 Bowman Chrome Dylan Crews auto refractor PSA 10",
      mustHave: ["bowman chrome", "crews", "auto", "refractor", "psa", "10"],
      mustNotHave: ["topps chrome","non auto","no auto","unsigned","lot","you pick","reprint","express lane","gold refractor","red refractor","blue refractor","superfractor"],
    },
    {
      label: "2022 Topps Update Julio Rodriguez Rookie PSA 10",
      query: "2022 Topps Update Julio Rodriguez rookie PSA 10",
      mustHave: ["topps", "update", "rodriguez", "psa", "10"],
      mustNotHave: ["chrome","bowman","auto","lot","you pick","reprint","express lane"],
    },
  ],
  hockey: [
    {
      label: "2023 Upper Deck Young Guns Connor Bedard PSA 10",
      query: "2023 Upper Deck Young Guns Connor Bedard PSA 10",
      mustHave: ["upper deck", "young guns", "bedard", "psa", "10"],
      mustNotHave: ["opc","o-pee-chee","platinum","canvas","clear cut","lot","you pick","reprint","express lane","gold","silver","black","red"],
    },
    {
      label: "2022 Upper Deck Young Guns Shane Wright PSA 10",
      query: "2022 Upper Deck Young Guns Shane Wright PSA 10",
      mustHave: ["upper deck", "young guns", "wright", "psa", "10"],
      mustNotHave: ["opc","o-pee-chee","platinum","canvas","lot","you pick","reprint","express lane"],
    },
    {
      label: "2021 Upper Deck Young Guns Lucas Raymond PSA 10",
      query: "2021 Upper Deck Young Guns Lucas Raymond PSA 10",
      mustHave: ["upper deck", "young guns", "raymond", "psa", "10"],
      mustNotHave: ["opc","o-pee-chee","platinum","canvas","lot","you pick","reprint","express lane"],
    },
    {
      label: "2021 Upper Deck Young Guns Moritz Seider PSA 10",
      query: "2021 Upper Deck Young Guns Moritz Seider PSA 10",
      mustHave: ["upper deck", "young guns", "seider", "psa", "10"],
      mustNotHave: ["opc","o-pee-chee","platinum","canvas","lot","you pick","reprint","express lane"],
    },
    {
      label: "2022 Upper Deck Young Guns Matty Beniers PSA 10",
      query: "2022 Upper Deck Young Guns Matty Beniers PSA 10",
      mustHave: ["upper deck", "young guns", "beniers", "psa", "10"],
      mustNotHave: ["opc","o-pee-chee","platinum","canvas","lot","you pick","reprint","express lane"],
    },
    {
      label: "2021 Upper Deck Young Guns Mason McTavish PSA 10",
      query: "2021 Upper Deck Young Guns Mason McTavish PSA 10",
      mustHave: ["upper deck", "young guns", "mctavish", "psa", "10"],
      mustNotHave: ["opc","o-pee-chee","platinum","canvas","lot","you pick","reprint","express lane"],
    },
    {
      label: "2023 OPC Platinum Connor Bedard Rookie PSA 10",
      query: "2023 OPC Platinum Connor Bedard rookie PSA 10",
      mustHave: ["platinum", "bedard", "psa", "10"],
      mustNotHave: ["upper deck","young guns","lot","you pick","reprint","express lane"],
    },
    {
      label: "2022 OPC Platinum Shane Wright Rookie PSA 10",
      query: "2022 OPC Platinum Shane Wright rookie PSA 10",
      mustHave: ["platinum", "wright", "psa", "10"],
      mustNotHave: ["upper deck","young guns","lot","you pick","reprint","express lane"],
    },
  ],
};

// ─── STRICT FILTER ────────────────────────────────────────────────────────────
function strictFilter(items, cardDef) {
  const { mustHave, mustNotHave, query } = cardDef;

  // Grade from query
  const gradeNum = query.match(/\b(10|9\.5|9|8\.5|8)\b/)?.[0];
  const year = query.match(/\b(20\d{2}|19\d{2})\b/)?.[0];
  const searchYear = year ? parseInt(year) : null;

  return items.filter(item => {
    const price = parseFloat(item.price?.value);
    const title = (item.title || "").toLowerCase();

    if (isNaN(price) || price < 5) return false;
    if (title.length > 130) return false;

    // ALL mustHave words must appear in title
    if (mustHave.some(w => !title.includes(w))) return false;

    // ANY mustNotHave word kills the listing
    if (mustNotHave.some(w => title.includes(w))) return false;

    // Grade number must match exactly
    if (gradeNum && !new RegExp(`\\b${gradeNum}\\b`).test(title)) return false;

    // Year within 1 year
    if (searchYear) {
      const titleYears = [...title.matchAll(/\b(19|20)\d{2}\b/g)].map(m => parseInt(m[0]));
      if (titleYears.length > 0) {
        const closest = titleYears.reduce((a, b) => Math.abs(b - searchYear) < Math.abs(a - searchYear) ? b : a);
        if (Math.abs(closest - searchYear) > 1) return false;
      }
    }

    return true;
  });
}

// ─── SPREAD CALCULATOR ────────────────────────────────────────────────────────
async function getSpread(token, cardDef) {
  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(cardDef.query)}&filter=buyingOptions:{FIXED_PRICE}&sort=price&limit=50`;
  const res = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } });
  const data = await res.json();
  const raw = data.itemSummaries || [];
  if (raw.length === 0) return null;

  const filtered = strictFilter(raw, cardDef);
  if (filtered.length < 3) return null;

  const prices = filtered.map(i => parseFloat(i.price?.value)).sort((a, b) => a - b);

  // Remove top and bottom 15% outliers
  const trim = Math.max(1, Math.floor(prices.length * 0.15));
  const trimmed = prices.slice(trim, prices.length - trim);
  if (trimmed.length < 3) return null;

  const low = trimmed[0];
  const high = trimmed[trimmed.length - 1];
  const spread = high - low;
  const spreadPct = Math.round((spread / low) * 100);

  if (spreadPct < 15 || spread < 5) return null;
  if (spreadPct > 65) return null;

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
    query: cardDef.label,
    priceRange: { low: low.toFixed(2), high: high.toFixed(2), spread: spread.toFixed(2), spreadPct, count: filtered.length },
    cheapest,
    soldSearchUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(cardDef.query)}&LH_Sold=1&LH_Complete=1`,
  };
}

// ─── API ENDPOINTS ────────────────────────────────────────────────────────────
app.get("/api/scan", async (req, res) => {
  const { sport } = req.query;
  if (!sport || !SCAN_CATEGORIES[sport]) {
    return res.status(400).json({ error: "Invalid sport" });
  }
  try {
    const token = await getEbayToken();
    const results = await Promise.all(
      SCAN_CATEGORIES[sport].map(cardDef => getSpread(token, cardDef).catch(() => null))
    );
    const deals = results.filter(Boolean);
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
    // For custom search, build a simple cardDef
    const cardDef = {
      label: query,
      query,
      mustHave: query.toLowerCase().split(" ").filter(w => w.length > 3),
      mustNotHave: ["you pick","pick your","lot of","reprint","custom","express lane","non auto","no auto","unsigned","lot","qty","bundle"],
    };
    const result = await getSpread(token, cardDef);
    if (!result) return res.json({ message: "Not enough matching listings or spread too small" });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => res.send("CardFlip AI backend is running!"));
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("CardFlip backend running on port " + PORT));
ENDOFFILE
echo "done"
