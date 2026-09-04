// Catalog of tradable symbols used by the simulated market feed.
// vol = per-tick return volatility (stddev), baseVolume = typical share volume per tick.
module.exports = [
  { symbol: 'AAPL',  name: 'Apple Inc.',            sector: 'Technology',  base: 190.0, vol: 0.010, baseVolume: 5_000_000 },
  { symbol: 'MSFT',  name: 'Microsoft Corp.',       sector: 'Technology',  base: 415.0, vol: 0.009, baseVolume: 3_500_000 },
  { symbol: 'GOOGL', name: 'Alphabet Inc.',         sector: 'Technology',  base: 165.0, vol: 0.013, baseVolume: 3_000_000 },
  { symbol: 'NVDA',  name: 'NVIDIA Corp.',          sector: 'Technology',  base: 118.0, vol: 0.026, baseVolume: 8_000_000 },
  { symbol: 'META',  name: 'Meta Platforms',        sector: 'Technology',  base: 520.0, vol: 0.018, baseVolume: 2_500_000 },
  { symbol: 'AMD',   name: 'Advanced Micro Devices',sector: 'Technology',  base: 145.0, vol: 0.024, baseVolume: 4_200_000 },
  { symbol: 'NFLX',  name: 'Netflix Inc.',          sector: 'Technology',  base: 670.0, vol: 0.020, baseVolume: 1_200_000 },
  { symbol: 'JPM',   name: 'JPMorgan Chase',        sector: 'Finance',     base: 210.0, vol: 0.010, baseVolume: 2_100_000 },
  { symbol: 'GS',    name: 'Goldman Sachs',         sector: 'Finance',     base: 480.0, vol: 0.013, baseVolume: 900_000 },
  { symbol: 'BAC',   name: 'Bank of America',       sector: 'Finance',     base: 38.0,  vol: 0.012, baseVolume: 9_000_000 },
  { symbol: 'XOM',   name: 'Exxon Mobil',           sector: 'Energy',      base: 112.0, vol: 0.014, baseVolume: 3_200_000 },
  { symbol: 'CVX',   name: 'Chevron Corp.',         sector: 'Energy',      base: 150.0, vol: 0.012, baseVolume: 2_000_000 },
  { symbol: 'JNJ',   name: 'Johnson & Johnson',     sector: 'Healthcare',  base: 155.0, vol: 0.007, baseVolume: 1_500_000 },
  { symbol: 'PFE',   name: 'Pfizer Inc.',           sector: 'Healthcare',  base: 28.0,  vol: 0.016, baseVolume: 6_000_000 },
  { symbol: 'UNH',   name: 'UnitedHealth Group',    sector: 'Healthcare',  base: 560.0, vol: 0.011, baseVolume: 700_000 },
  { symbol: 'AMZN',  name: 'Amazon.com',            sector: 'Consumer',    base: 185.0, vol: 0.015, baseVolume: 4_000_000 },
  { symbol: 'TSLA',  name: 'Tesla Inc.',            sector: 'Consumer',    base: 230.0, vol: 0.036, baseVolume: 9_500_000 },
  { symbol: 'WMT',   name: 'Walmart Inc.',          sector: 'Consumer',    base: 68.0,  vol: 0.008, baseVolume: 2_800_000 },
  { symbol: 'KO',    name: 'Coca-Cola Co.',         sector: 'Consumer',    base: 63.0,  vol: 0.006, baseVolume: 1_800_000 },
  { symbol: 'DIS',   name: 'Walt Disney Co.',       sector: 'Consumer',    base: 95.0,  vol: 0.018, baseVolume: 2_600_000 },
];
