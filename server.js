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

// ─── EXACT SET RULES ──────────────────────────────────────────────────────────
// Each set defines words that MUST appear and words that must NOT appear.
// This prevents cross-set contamination entirely.
const EXACT_SETS = {
  "panini prizm base": {
    must: ["prizm"],
    mustNot: [
      // Other Panini brands
      "draft picks", "draft pick", "donruss", "optic", "contenders", "select",
      "mosaic", "chronicles", "hoops", "spectra", "national treasures",
      "immaculate", "flawless", "certified", "score", "absolute",
      // Named Prizm inserts — these are NOT base silver cards
      "instant impact", "kaboom", "fireworks", "stained glass", "monopoly",
      "emergent", "fearless", "sensations", "phenomenon", "field level",
      "dominance", "fast break", "choice", "scope", "lucky envelopes",
      "mojo", "camo", "tiger", "wave", "cracked ice", "laser", "disco",
      "shimmer", "hyper", "neon", "the 100", "on card", "all day",
      "power players", "prizms of the past", "top of the class",
      "take flight", "leveling up", "all systems go",
    ],
  },
  "panini prizm draft picks": {
    must: ["prizm", "draft picks"],
    mustNot: ["donruss", "optic", "select", "mosaic", "instant impact", "kaboom"],
  },
  "donruss optic": {
    must: ["optic"],
    mustNot: ["prizm", "select", "mosaic", "chronicles", "spectra"],
  },
  "panini select": {
    must: ["select"],
    mustNot: ["prizm", "optic", "donruss", "mosaic"],
  },
  "panini mosaic": {
    must: ["mosaic"],
    mustNot: ["prizm", "optic", "donruss", "select"],
  },
  "panini hoops": {
    must: ["hoops"],
    mustNot: ["prizm", "optic", "donruss", "select", "mosaic"],
  },
  "panini score": {
    must: ["score"],
    mustNot: ["prizm", "optic", "donruss", "select"],
  },
  "bowman chrome": {
    must: ["bowman chrome"],
    mustNot: ["topps chrome", "bowman platinum", "bowman sterling", "bowman draft", "bowman best", "bowman's best"],
  },
  "bowman draft": {
    must: ["bowman draft"],
    mustNot: ["bowman chrome", "topps chrome"],
  },
  "topps chrome": {
    must: ["topps chrome"],
    mustNot: ["bowman chrome", "topps chrome update", "bowman"],
  },
  "topps chrome update": {
    must: ["topps chrome", "update"],
    mustNot: ["bowman"],
  },
  "topps update": {
    must: ["topps", "update"],
    mustNot: ["chrome", "bowman"],
  },
  "topps base": {
    must: ["topps"],
    mustNot: ["chrome", "update", "bowman", "heritage", "allen", "ginter", "archives"],
  },
  "topps heritage": {
    must: ["topps heritage"],
    mustNot: ["chrome", "bowman"],
  },
  "upper deck young guns": {
    must: ["upper deck", "young guns"],
    mustNot: ["opc", "o-pee-chee", "platinum", "canvas"],
  },
  "opc platinum": {
    must: ["opc platinum", "o-pee-chee platinum"],
    mustNot: ["upper deck"],
  },
  "panini contenders": {
    must: ["contenders"],
    mustNot: ["optic contenders", "prizm", "mosaic", "select"],
  },
  "national treasures": {
    must: ["national treasures"],
    mustNot: [],
  },
  "flawless": {
    must: ["flawless"],
    mustNot: ["national treasures"],
  },
  "immaculate": {
    must: ["immaculate"],
    mustNot: ["national treasures", "flawless"],
  },
};

// ─── PARALLEL CONFLICT MAP ────────────────────────────────────────────────────
// When searching a parallel, ALL conflicting parallels are rejected.
const PARALLEL_CONFLICTS = {
  "silver":     ["gold", "red", "blue", "green", "purple", "orange", "pink", "black", "bronze",
                 "copper", "yellow", "teal", "hyper", "neon", "disco", "shimmer", "cracked ice",
                 "tiger", "wave", "aqua", "ruby", "emerald", "sapphire", "mojo", "camo",
                 "laser", "scope", "pulsar", "explosion", "tie dye", "white"],
  "gold":       ["silver", "red", "blue", "green", "purple", "orange", "pink", "black", "bronze",
                 "copper", "hyper", "neon"],
  "red":        ["silver", "gold", "blue", "green", "purple", "orange", "pink", "black",
                 "hyper", "neon", "disco"],
  "blue":       ["silver", "gold", "red", "green", "purple", "orange", "pink", "black"],
  "green":      ["silver", "gold", "red", "blue", "purple", "orange", "pink", "black"],
  "purple":     ["silver", "gold", "red", "blue", "green", "orange", "pink", "black"],
  "orange":     ["silver", "gold", "red", "blue", "green", "purple", "pink", "black"],
  "black":      ["silver", "gold", "red", "blue", "green", "purple", "orange", "pink"],
  "hyper":      ["silver", "gold", "red", "blue", "green", "purple", "orange", "pink", "black",
                 "neon", "disco", "shimmer"],
  "neon":       ["silver", "gold", "red", "blue", "green", "purple", "orange", "pink", "black",
                 "hyper", "disco"],
  "refractor":  ["gold refractor", "red refractor", "blue refractor", "green refractor",
                 "purple refractor", "orange refractor", "pink refractor", "black refractor",
                 "atomic refractor", "superfractor", "prism refractor"],
};

// ─── JUNK KEYWORDS ────────────────────────────────────────────────────────────
const JUNK = [
  "you pick", "pick your", "pick one", "choose your", "lot of", "bundle of",
  "multi", "wholesale", "reprint", "custom", "fake", "proxy", "express lane",
  "complete your set", "mystery", "surprise", "random", "blind", "break",
  "case break", "box break", "qty", "quantity", "bulk", "sealed", "pack",
  "panini direct", "fanatics", "non auto", "no auto", "non-auto", "without auto",
  "no patch", "non patch", "without patch", "base only", "unsigned", "not signed",
  "lot", "variation sp", "short print sp",
];

const GRADES = ["psa", "bgs", "sgc", "cgc"];

// ─── STRICT FILTER ────────────────────────────────────────────────────────────
function strictFilter(items, query) {
  const q = query.toLowerCase();

  // Detect set — find the most specific matching set (longest key wins)
  const matchedSetKey = Object.keys(EXACT_SETS)
    .filter(k => q.includes(k))
    .sort((a, b) => b.length - a.length)[0];
  const setRules = matchedSetKey ? EXACT_SETS[matchedSetKey] : null;

  // Detect parallel
  const searchedParallel = Object.keys(PARALLEL_CONFLICTS)
    .find(p => new RegExp(`\\b${p}\\b`).test(q));
  const conflicts = searchedParallel ? PARALLEL_CONFLICTS[searchedParallel] : [];

  // Grade
  const gradeKw = GRADES.find(g => q.includes(g));
  const gradeNum = q.match(/\b(10|9\.5|9|8\.5|8)\b/)?.[0];

  // Year
  const yearStr = query.match(/\b(20\d{2}|19\d{2})\b/)?.[0];
  const year = yearStr ? parseInt(yearStr) : null;

  // Auto / patch
  const wantsAuto = q.includes("auto");
  const wantsPatch = q.includes("patch") || q.includes("rpa");

  // Player — longest word not in the skip list
  const skip = new Set([
    "panini","topps","bowman","upper","deck","prizm","chrome","optic","select",
    "mosaic","silver","gold","auto","patch","refractor","draft","picks","young",
    "guns","psa","bgs","sgc","gem","mint","card","the","and","with","for","base",
    "rpa","rated","rookie","hoops","score","contenders","donruss","flawless",
    "immaculate","national","treasures","opc","platinum","heritage","update",
    "series","cup","certified","absolute","spectra","chronicles",
  ]);
  const playerWord = q.split(" ")
    .filter(w => w.length > 3 && !skip.has(w) && !/^\d/.test(w))
    .sort((a, b) => b.length - a.length)[0];

  return items.filter(item => {
    const price = parseFloat(item.price?.value);
    const t = (item.title || "").toLowerCase();

    if (isNaN(price) || price < 5) return false;
    if (t.length > 130) return false;
    if (JUNK.some(k => t.includes(k))) return false;

    // Player name must appear
    if (playerWord && !t.includes(playerWord)) return false;

    // Set rules — must contain all required words, must not contain any excluded words
    if (setRules) {
      if (setRules.must.some(w => !t.includes(w))) return false;
      if (setRules.mustNot.some(w => t.includes(w))) return false;
    }

    // Parallel — must appear as whole word
    if (searchedParallel && !new RegExp(`\\b${searchedParallel}\\b`).test(t)) return false;

    // Conflicting parallels — none can appear
    if (conflicts.some(p => {
      // Handle multi-word conflicts like "gold refractor"
      return t.includes(p);
    })) return false;

    // Auto must be genuine
    if (wantsAuto) {
      if (!t.includes("auto")) return false;
      if (["non auto","no auto","non-auto","without auto","unsigned","not signed"].some(k => t.includes(k))) return false;
    }

    // Patch must be genuine
    if (wantsPatch) {
      if (!t.includes("patch") && !t.includes("rpa")) return false;
      if (["no patch","non patch","without patch"].some(k => t.includes(k))) return false;
    }

    // Grade keyword
    if (gradeKw && !t.includes(gradeKw)) return false;

    // Grade number — exact match with word boundary
    if (gradeNum && !new RegExp(`\\b${gradeNum}\\b`).test(t)) return false;

    // Year — within 1 year only
    if (year) {
      const titleYears = [...t.matchAll(/\b(19|20)\d{2}\b/g)].map(m => parseInt(m[0]));
      if (titleYears.length > 0) {
        const closest = titleYears.reduce((a, b) => Math.abs(b - year) < Math.abs(a - year) ? b : a);
        if (Math.abs(closest - year) > 1) return false;
      }
    }

    return true;
  });
}

// ─── SPREAD CALCULATOR ────────────────────────────────────────────────────────
async function getSpread(token, query) {
  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&filter=buyingOptions:{FIXED_PRICE}&sort=price&limit=50`;
  const res = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } });
  const data = await res.json();
  const raw = data.itemSummaries || [];
  if (raw.length === 0) return null;

  const filtered = strictFilter(raw, query);
  if (filtered.length < 4) return null;

  const prices = filtered.map(i => parseFloat(i.price?.value)).sort((a, b) => a - b);
  const trim = Math.max(1, Math.floor(prices.length * 0.20));
  const trimmed = prices.slice(trim, prices.length - trim);
  if (trimmed.length < 3) return null;

  const low = trimmed[0];
  const high = trimmed[trimmed.length - 1];
  const spread = high - low;
  const spreadPct = Math.round((spread / low) * 100);

  if (spreadPct < 20 || spread < 8) return null;
  if (spreadPct > 65) return null; // Hard cap — over 65% means mixed cards

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

// ─── SCAN CATEGORIES ─────────────────────────────────────────────────────────
const SCAN_CATEGORIES = {
  basketball: [
    // Panini Prizm Silver PSA 10 — base card only
    "2021 Panini Prizm base Cade Cunningham Silver PSA 10",
    "2021 Panini Prizm base Scottie Barnes Silver PSA 10",
    "2022 Panini Prizm base Paolo Banchero Silver PSA 10",
    "2023 Panini Prizm base Victor Wembanyama Silver PSA 10",
    "2021 Panini Prizm base Evan Mobley Silver PSA 10",
    "2022 Panini Prizm base Jabari Smith Silver PSA 10",
    "2022 Panini Prizm base Jalen Williams Silver PSA 10",
    "2023 Panini Prizm base Scoot Henderson Silver PSA 10",
    // Donruss Optic Rated Rookie PSA 10
    "2021 Donruss Optic Cade Cunningham Rated Rookie PSA 10",
    "2022 Donruss Optic Paolo Banchero Rated Rookie PSA 10",
    "2023 Donruss Optic Victor Wembanyama Rated Rookie PSA 10",
    "2021 Donruss Optic Evan Mobley Rated Rookie PSA 10",
    // Panini Hoops Rookie PSA 10
    "2021 Panini Hoops Cade Cunningham Rookie PSA 10",
    "2022 Panini Hoops Paolo Banchero Rookie PSA 10",
    "2023 Panini Hoops Victor Wembanyama Rookie PSA 10",
    // Prizm Silver raw ungraded
    "2021 Panini Prizm base Cade Cunningham Silver",
    "2023 Panini Prizm base Victor Wembanyama Silver",
    "2022 Panini Prizm base Paolo Banchero Silver",
  ],
  football: [
    // Panini Prizm Silver PSA 10
    "2023 Panini Prizm base CJ Stroud Silver PSA 10",
    "2023 Panini Prizm base Bryce Young Silver PSA 10",
    "2022 Panini Prizm base Brock Purdy Silver PSA 10",
    "2023 Panini Prizm base Puka Nacua Silver PSA 10",
    "2023 Panini Prizm base Jahmyr Gibbs Silver PSA 10",
    "2023 Panini Prizm base Jordan Addison Silver PSA 10",
    "2023 Panini Prizm base Zay Flowers Silver PSA 10",
    "2023 Panini Prizm base Jaxon Smith-Njigba Silver PSA 10",
    // Donruss Optic Rated Rookie PSA 10
    "2023 Donruss Optic CJ Stroud Rated Rookie PSA 10",
    "2023 Donruss Optic Bryce Young Rated Rookie PSA 10",
    "2022 Donruss Optic Brock Purdy Rated Rookie PSA 10",
    "2023 Donruss Optic Puka Nacua Rated Rookie PSA 10",
    // Panini Score Rookie PSA 10
    "2023 Panini Score CJ Stroud Rookie PSA 10",
    "2023 Panini Score Bryce Young Rookie PSA 10",
    // Prizm Silver raw
    "2023 Panini Prizm base CJ Stroud Silver",
    "2022 Panini Prizm base Brock Purdy Silver",
    "2023 Panini Prizm base Puka Nacua Silver",
  ],
  baseball: [
    // Bowman Chrome auto refractor PSA 10
    "2022 Bowman Chrome Julio Rodriguez auto refractor PSA 10",
    "2022 Bowman Chrome Gunnar Henderson auto refractor PSA 10",
    "2023 Bowman Chrome Paul Skenes auto refractor PSA 10",
    "2023 Bowman Chrome Dylan Crews auto refractor PSA 10",
    "2022 Bowman Chrome Jeremy Pena auto refractor PSA 10",
    "2023 Bowman Chrome Jackson Holliday auto refractor PSA 10",
    // Topps Chrome PSA 10
    "2022 Topps Chrome Julio Rodriguez PSA 10",
    "2023 Topps Chrome Gunnar Henderson PSA 10",
    "2023 Topps Chrome Corbin Carroll PSA 10",
    "2023 Topps Chrome Ronald Acuna PSA 10",
    "2022 Topps Chrome Jeremy Pena PSA 10",
    // Bowman Chrome auto raw
    "2023 Bowman Chrome Paul Skenes auto refractor",
    "2023 Bowman Chrome Dylan Crews auto refractor",
    "2022 Bowman Chrome Gunnar Henderson auto refractor",
    // Topps Update rookie PSA 10
    "2022 Topps Update Julio Rodriguez rookie PSA 10",
    "2023 Topps Update Gunnar Henderson rookie PSA 10",
    "2023 Topps Update Corbin Carroll rookie PSA 10",
  ],
  hockey: [
    // Upper Deck Young Guns PSA 10
    "2023 Upper Deck Young Guns Connor Bedard PSA 10",
    "2022 Upper Deck Young Guns Shane Wright PSA 10",
    "2021 Upper Deck Young Guns Lucas Raymond PSA 10",
    "2021 Upper Deck Young Guns Moritz Seider PSA 10",
    "2022 Upper Deck Young Guns Matty Beniers PSA 10",
    "2021 Upper Deck Young Guns Cole Perfetti PSA 10",
    "2022 Upper Deck Young Guns Matthew Knies PSA 10",
    "2021 Upper Deck Young Guns Jamie Drysdale PSA 10",
    "2021 Upper Deck Young Guns Mason McTavish PSA 10",
    // OPC Platinum rookie PSA 10
    "2023 OPC Platinum Connor Bedard rookie PSA 10",
    "2022 OPC Platinum Shane Wright rookie PSA 10",
    "2021 OPC Platinum Mason McTavish rookie PSA 10",
    // Upper Deck Series 1/2 YG raw
    "2023 Upper Deck Young Guns Connor Bedard",
    "2021 Upper Deck Young Guns Lucas Raymond",
    "2022 Upper Deck Young Guns Shane Wright",
  ],
  soccer: [
    // Topps Chrome PSA 10
    "2022 Topps Chrome Erling Haaland PSA 10",
    "2022 Topps Chrome Jude Bellingham PSA 10",
    "2023 Topps Chrome Kylian Mbappe PSA 10",
    "2022 Topps Chrome Vinicius Junior PSA 10",
    "2022 Topps Chrome Pedri PSA 10",
    // Prizm Soccer PSA 10
    "2022 Panini Prizm base Erling Haaland Silver PSA 10",
    "2022 Panini Prizm base Jude Bellingham Silver PSA 10",
    "2023 Panini Prizm base Kylian Mbappe Silver PSA 10",
    // Topps Chrome auto
    "2022 Topps Chrome Jude Bellingham auto refractor",
    "2022 Topps Chrome Erling Haaland auto refractor",
    "2021 Topps Chrome Pedri auto refractor",
  ],
  wrestling: [
    // Prizm WWE Silver PSA 10
    "2022 Panini Prizm base WWE Roman Reigns Silver PSA 10",
    "2022 Panini Prizm base WWE Cody Rhodes Silver PSA 10",
    "2022 Panini Prizm base WWE Sasha Banks Silver PSA 10",
    "2021 Topps Chrome WWE Goldberg PSA 10",
    "2022 Topps Chrome WWE Roman Reigns PSA 10",
  ],
  mma: [
    // Prizm UFC Silver PSA 10
    "2021 Panini Prizm base UFC Jon Jones Silver PSA 10",
    "2021 Panini Prizm base UFC Conor McGregor Silver PSA 10",
    "2022 Panini Prizm base UFC Israel Adesanya Silver PSA 10",
    "2021 Panini Prizm base UFC Dustin Poirier Silver PSA 10",
    "2022 Panini Prizm base UFC Alex Pereira Silver PSA 10",
  ],
};

// ─── API ENDPOINTS ────────────────────────────────────────────────────────────
app.get("/api/scan", async (req, res) => {
  const { sport } = req.query;
  if (!sport || !SCAN_CATEGORIES[sport]) {
    return res.status(400).json({ error: "Invalid sport. Options: basketball, football, baseball, hockey, soccer, wrestling, mma" });
  }
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

app.get("/api/categories", (req, res) => {
  res.json({ categories: Object.keys(SCAN_CATEGORIES) });
});

app.get("/", (req, res) => res.send("CardFlip AI backend is running!"));
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("CardFlip backend running on port " + PORT));
ENDOFFILE
echo "done"
