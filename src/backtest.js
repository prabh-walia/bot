// backtest.js — CommonJS, no SR filter, 1-trade-per-2h, TP1+trail+hard-exit, dynamic risk

const ccxt = require("ccxt");

// ========= CONFIG =========
const SYMBOLS = [
  "SUI/USDT:USDT",
  "ENA/USDT:USDT",
  "ETH/USDT:USDT",
  "ALGO/USDT:USDT",
];
const EXCHANGE = "binanceusdm";
const SINCE_DAYS = 360;

// Risk & bankroll
const START_BALANCE = 1000;
const BASE_RISK = 10; // $ per trade baseline
const RISK_MODE = "anti"; // "fixed" | "anti" | "martingale"
const MAX_RISK_MULT = 3; // cap for anti/marti (x of BASE_RISK)

// Indicators/filters
const EMA_LEN = 12;
const ATR_LEN = 14;
const EMA2H_PROX_PCT = 2.5; // must be within this % of 2h EMA
const SIDEWAYS_MIN_ATR_PCT = 0.007; // skip if ATR/close < this (too dead)

// Entries/exits
const SL_MULT = 2.2; // ATR SL
const TP1_MULT = 8.5; // ATR TP1
const TRAIL_MULT = 4.0; // trailing after TP1: SL trails by ATR*TRAIL_MULT
const HARD_EXIT_PCT = 0.1; // +/−10% hard exit from entry

// Engine constraints
const ONE_TRADE_PER_2H = true; // allow <= 1 trade per 2h candle
const COOLDOWN_BARS = 0; // additional cooldown in 30m bars after exit

// ========= UTILS =========
function ema(values, len) {
  const k = 2 / (len + 1);
  let prev = values[0];
  const out = [prev];
  for (let i = 1; i < values.length; i++) {
    const cur = values[i] * k + prev * (1 - k);
    out.push(cur);
    prev = cur;
  }
  return out;
}

function rmaATR(ohlcv, len = 14) {
  const trs = [];
  for (let i = 1; i < ohlcv.length; i++) {
    const h = ohlcv[i][2],
      l = ohlcv[i][3],
      pc = ohlcv[i - 1][4];
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const alpha = 1 / len;
  let rma = trs[0];
  const out = [NaN]; // align to ohlcv
  for (let i = 1; i < trs.length; i++) {
    rma = alpha * trs[i] + (1 - alpha) * rma;
    out.push(rma);
  }
  out.unshift(NaN);
  return out;
}

function avgPrice(c) {
  return (c[2] + c[3] + c[4]) / 3; // (high + low + close)/3
}

function near2hEMA(close2h, ema2h) {
  const pct = (Math.abs(close2h - ema2h) / ema2h) * 100;
  return pct <= EMA2H_PROX_PCT;
}

function trendFrom1d(close1d, ema1d) {
  // simple: daily close vs daily EMA12
  return close1d > ema1d ? "bullish" : "bearish";
}

function detectPattern(candle, prev, ema30) {
  const [, open, high, low, close] = candle;
  const [, , pHigh, pLow] = prev;

  const isNearEMA = Math.abs(close - ema30) <= ema30 * 0.014;

  const range = Math.max(1e-9, high - low);
  const body = Math.abs(close - open);
  const lowerWick = Math.min(open, close) - low;
  const upperWick = high - Math.max(open, close);
  const bodyBig = body >= range * 0.55;

  const bullishHammer = lowerWick > body * 1.1 && body <= lowerWick;
  const invertedHammer = upperWick > body * 1.1 && body <= upperWick;
  const bullEngulf = close > open && close >= pHigh && bodyBig;
  const bearEngulf = close < open && close <= pLow && bodyBig;

  return { isNearEMA, bullishHammer, invertedHammer, bullEngulf, bearEngulf };
}

// Map higher timeframe to each 30m index, keep timestamp
function mapHTFto30m(ohlcv30, ohlcvHTF, emaHTF) {
  const out = [];
  let j = 0,
    last = null;
  for (let i = 0; i < ohlcv30.length; i++) {
    const ts = ohlcv30[i][0];
    while (j < ohlcvHTF.length && ohlcvHTF[j][0] <= ts) {
      last = { ts: ohlcvHTF[j][0], close: ohlcvHTF[j][4], ema: emaHTF[j] };
      j++;
    }
    out.push(last);
  }
  return out;
}

async function loadOhlcv(ex, symbol, timeframe, since) {
  return ex.fetchOHLCV(symbol, timeframe, since, 1500);
}

// ========= DYNAMIC RISK =========
// returns (riskDollars, nextState)
function nextRisk(state, result) {
  const { mode, base, currentMult } = state;
  if (mode === "fixed") {
    return { risk: base, state: { ...state } };
  }
  if (mode === "anti") {
    // win -> increase; loss -> reset
    if (result === "win") {
      const nm = Math.min(currentMult * 1.5, MAX_RISK_MULT);
      return { risk: base * nm, state: { ...state, currentMult: nm } };
    } else if (result === "loss") {
      return { risk: base, state: { ...state, currentMult: 1 } };
    } else {
      // first trade (no result yet)
      return { risk: base * currentMult, state: { ...state } };
    }
  }
  if (mode === "martingale") {
    // loss -> double; win -> reset
    if (result === "loss") {
      const nm = Math.min(currentMult * 2, MAX_RISK_MULT);
      return { risk: base * nm, state: { ...state, currentMult: nm } };
    } else if (result === "win") {
      return { risk: base, state: { ...state, currentMult: 1 } };
    } else {
      return { risk: base * currentMult, state: { ...state } };
    }
  }
  // fallback
  return { risk: base, state: { ...state } };
}

// ========= BACKTEST CORE =========
async function backtestSymbol(ex, symbol) {
  const since = Date.now() - SINCE_DAYS * 24 * 60 * 60 * 1000;

  const ohlcv30 = await loadOhlcv(ex, symbol, "30m", since);
  const ohlcv2h = await loadOhlcv(ex, symbol, "2h", since);
  const ohlcv1d = await loadOhlcv(ex, symbol, "1d", since);

  if (ohlcv30.length < 200 || ohlcv2h.length < 20 || ohlcv1d.length < 20) {
    return { symbol, trades: [], summary: null };
  }

  const ema30 = ema(
    ohlcv30.map((c) => c[4]),
    EMA_LEN
  );
  const atr30 = rmaATR(ohlcv30, ATR_LEN);

  const ema2h = ema(
    ohlcv2h.map((c) => c[4]),
    EMA_LEN
  );
  const map2h = mapHTFto30m(ohlcv30, ohlcv2h, ema2h);

  const ema1d = ema(
    ohlcv1d.map((c) => c[4]),
    EMA_LEN
  );
  const map1d = mapHTFto30m(ohlcv30, ohlcv1d, ema1d);

  const trades = [];
  let balance = START_BALANCE;

  // risk state per symbol
  let riskState = { mode: RISK_MODE, base: BASE_RISK, currentMult: 1 };
  // prime first trade risk
  let lastResultForRisk = null;

  // keep track of which 2h TS we already traded
  const traded2h = new Set();

  for (let i = 50; i < ohlcv30.length - 2; i++) {
    const cur = ohlcv30[i];
    const prev = ohlcv30[i - 1];
    const next = ohlcv30[i + 1];

    const emaVal = ema30[i];
    const atrVal = atr30[i];
    const ctx2h = map2h[i];
    const ctx1d = map1d[i];

    if (!emaVal || !atrVal || !ctx2h || !ctx1d) continue;

    // sideway/ATR filter (skip too low ATR)
    const curClose = cur[4];
    const atrPct = atrVal / (curClose || 1);
    if (atrPct < SIDEWAYS_MIN_ATR_PCT) continue;

    // 2h EMA proximity
    if (!near2hEMA(ctx2h.close, ctx2h.ema)) continue;

    // 2h cap: only 1 trade per 2h candle, but allow any 30m inside it
    if (ONE_TRADE_PER_2H && traded2h.has(ctx2h.ts)) continue;

    // daily trend
    const trend = trendFrom1d(ctx1d.close, ctx1d.ema);

    // pattern on last closed 30m
    const patt = detectPattern(cur, prev, emaVal);
    const longOK =
      trend === "bullish" &&
      patt.isNearEMA &&
      (patt.bullishHammer || patt.bullEngulf);
    const shortOK =
      trend === "bearish" &&
      patt.isNearEMA &&
      (patt.invertedHammer || patt.bearEngulf);

    if (!longOK && !shortOK) continue;

    // entry on next candle breakout of current bar
    let entrySide = null;
    let entryPrice = null;

    if (longOK && next[2] >= cur[2]) {
      entrySide = "buy";
      entryPrice = Math.max(cur[2], next[1]); // conservative
    } else if (shortOK && next[3] <= cur[3]) {
      entrySide = "sell";
      entryPrice = Math.min(cur[3], next[1]); // conservative
    } else {
      continue;
    }

    // size risk now (before trade)
    const riskOut = nextRisk(riskState, lastResultForRisk);
    let riskDollars = riskOut.risk;
    riskState = riskOut.state;

    // set initial SL / TP1
    let stopLoss =
      entrySide === "buy"
        ? entryPrice - atrVal * SL_MULT
        : entryPrice + atrVal * SL_MULT;
    const tp1 =
      entrySide === "buy"
        ? entryPrice + atrVal * TP1_MULT
        : entryPrice - atrVal * TP1_MULT;

    let tp1Hit = false;
    let lockedR = 0;
    let outcome = "open";
    let exitPrice = null;

    // walk forward
    for (let k = i + 1; k < ohlcv30.length; k++) {
      const bar = ohlcv30[k];
      const bh = bar[2],
        bl = bar[3],
        bc = bar[4];

      if (entrySide === "buy") {
        if (!tp1Hit && bh >= tp1) {
          tp1Hit = true;
          // lock half at TP1 (approx)
          lockedR = 0.5 * (TP1_MULT / SL_MULT);
        }
        if (bl <= stopLoss) {
          outcome = tp1Hit ? "win" : "loss";
          exitPrice = stopLoss;
          break;
        }
        if (tp1Hit) {
          // trail by ATR*TRAIL_MULT from close
          const trailed = bc - atrVal * TRAIL_MULT;
          stopLoss = Math.max(stopLoss, trailed);
        }
        // hard exit at +10%
        if ((bc - entryPrice) / entryPrice >= HARD_EXIT_PCT) {
          outcome = "win";
          exitPrice = bc;
          break;
        }
      } else {
        if (!tp1Hit && bl <= tp1) {
          tp1Hit = true;
          lockedR = 0.5 * (TP1_MULT / SL_MULT);
        }
        if (bh >= stopLoss) {
          outcome = tp1Hit ? "win" : "loss";
          exitPrice = stopLoss;
          break;
        }
        if (tp1Hit) {
          const trailed = bc + atrVal * TRAIL_MULT;
          stopLoss = Math.min(stopLoss, trailed);
        }
        if ((entryPrice - bc) / entryPrice >= HARD_EXIT_PCT) {
          outcome = "win";
          exitPrice = bc;
          break;
        }
      }
    }

    if (outcome === "open") {
      // no exit found till data end → flat (skip)
      continue;
    }

    // compute R
    const Rstop = Math.abs(entryPrice - stopLoss);
    const Rgain = Math.abs(exitPrice - entryPrice);
    let R = tp1Hit
      ? lockedR + (Rgain / Rstop) * 0.5
      : outcome === "win"
      ? Rgain / Rstop
      : -1;
    R = +R.toFixed(2);

    // PnL and risk update
    const pnl = R * riskDollars;
    balance += pnl;
    lastResultForRisk = outcome; // feed nextRisk

    trades.push({
      ts: new Date(ohlcv30[i + 1][0]).toISOString(),
      symbol,
      side: entrySide,
      entry: +entryPrice.toFixed(6),
      stopLoss: +stopLoss.toFixed(6),
      tp1: +tp1.toFixed(6),
      exit: +exitPrice.toFixed(6),
      outcome,
      R,
      risk: +riskDollars.toFixed(2),
      balance: +balance.toFixed(2),
      twoHTs: ctx2h.ts,
    });

    if (ONE_TRADE_PER_2H) traded2h.add(ctx2h.ts);
    i += COOLDOWN_BARS; // optional extra pause
  }

  const wins = trades.filter((t) => t.outcome === "win").length;
  const losses = trades.filter((t) => t.outcome === "loss").length;
  const winrate = trades.length ? (wins / trades.length) * 100 : 0;
  const avgR = trades.length
    ? trades.reduce((s, t) => s + t.R, 0) / trades.length
    : 0;

  return {
    symbol,
    trades,
    summary: {
      symbol,
      trades: trades.length,
      wins,
      losses,
      winrate: +winrate.toFixed(2),
      avgR: +avgR.toFixed(2),
      finalBalance: +balance.toFixed(2),
    },
  };
}

// ========= RUN =========
async function main() {
  const ex = new ccxt[EXCHANGE]({ enableRateLimit: true });
  const results = [];

  for (const sym of SYMBOLS) {
    console.log(`Backtesting ${sym}...`);
    const r = await backtestSymbol(ex, sym);
    if (r.summary) results.push(r.summary);
  }

  console.table(results);
}

main();
