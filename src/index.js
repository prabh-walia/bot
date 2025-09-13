import {
  fetchAndAnalyzeCandles,
  avgSwingHigh,
  avgSwingLow,
  Trend,
  checkDownTrend,
  checkSidewaysTrend,
  checkUpTrend,
  checkFrequentSideways,
  convertSymbol,
  fetchAndAnalyzeCandlesFortrend,
  get2hEMA12,
} from "./fetchAndAnalyze.js";
let trend;
import { findTrend } from "./trendFinder.js";
import { getRealTimePrice } from "./getPrice.js";

import { binance } from "./binanceClient.js";
import { Status } from "./model.js";
import { trade } from "./globalVariables.js";
import { price } from "./getPrice.js";

let ordersPending = false;
let error = 0;

let hasLoggedFindingTrades = false;
let overallTrend;
let profitBooked = false;
let isTrueTrend = false;
let SYMBOL;
let orderQuantity;
let multiple;
let currentRisk;
let lastOrderExecuted = false;
let lastSlOrderExecuted = false;
let slPercentage;
let ATR = 0.011;
let weakness = false;
let SL_TRAIL_INTERVAL = 3;
let consecutiveLosses = 0;
let lastResult = "loss";
let NO_MOVE_ZONE_PERCENT = 0.006;
let ordersPlaced = [];
let percentDiffGlobal = 0;
const MIN_NOTIONAL = 5;
let tradeCompletedAt = 0;
let initialProfitBooked = false;
const ENABLE_SR_FILTER = true; // quick kill switch
const SR_MODE = "enforce"; // "log" | "enforce"
const SR_LEFT_RIGHT = 2; // swing sensitivity
const SR_ATR_MULT = 0.3; // zone buffer = 0.35 * 30m ATR
const SIDEWAYS_STATE = new Map();
let pct = 0;
const MIN_ORDER_QUANTITY = {
  "SOL/USDT": 1,
  "LTC/USDT": 0.16,
  "ETH/USDT": 0.002,
  "XRP/USDT": 4,
  "SUI/USDT": 3.8,
  "ALGO/USDT": 28,
  "ENA/USDT": 17,
  "MYX/USDT": 4.5,
  "HYPE/USDT": 0.23,
};
const SL_PERCENTAGE = {
  "1h": 0.009,
  "30m": 0.007,

  "2h": 0.011,
  "4h": 0.03,
};
const getRandomDelay = () => Math.floor(Math.random() * (190 - 60 + 1)) + 100;

const isSymbolNear2hEMA = async (symbol) => {
  const { ema, close, avg, currentCandle } = await get2hEMA12(
    convertSymbol(symbol)
  );
  console.log("current close ->", currentCandle[4]);
  const percentDiff = (Math.abs(currentCandle[4] - ema) / ema) * 100;
  const proximityThreshold = 3; // percent

  return {
    isNear: percentDiff <= proximityThreshold,
    symbol,
    ema,
    close,
    percentDiff,
  };
};

async function sidewaysGate({
  symbol,
  atr,
  price,
  overshoot = 2.6,
  minPct = 0.0083, // ~0.84% after overshoot
  minHours = 4, // block for at least N hours
  nowTs = Date.now(),
}) {
  if (!Number.isFinite(atr) || atr <= 0)
    return { block: true, reason: "bad_atr" };
  if (!Number.isFinite(price) || price <= 0)
    return { block: true, reason: "bad_price" };

  const atrPct = (atr * overshoot) / price;

  // Not sideways → allow
  if (atrPct >= minPct) {
    if (SIDEWAYS_STATE.has(symbol)) SIDEWAYS_STATE.delete(symbol);
    return { block: false, regime: "normal" };
  }

  // Sideways → track start time
  let st = SIDEWAYS_STATE.get(symbol);
  if (!st) {
    st = { since: nowTs };
    SIDEWAYS_STATE.set(symbol, st);
  }
  const hours = (nowTs - st.since) / 36e5;

  // Still within block window
  if (hours < minHours) {
    return {
      block: true,
      regime: "sideways_block_minWindow",
      since: st.since,
      hours,
    };
  }

  // After minHours → release automatically
  SIDEWAYS_STATE.delete(symbol);
  return {
    block: false,
    regime: "sideways_time_released",
    since: st.since,
    hours,
  };
}

function updateRisk(result) {
  lastResult = result;
  if (result === "win") {
    consecutiveLosses = 0;
    // Reset only if > 50%
    if (currentRisk > multiple * 0.5) {
      currentRisk = multiple * 0.5;
    }
  } else if (result === "loss") {
    consecutiveLosses++;
    if (consecutiveLosses === 1) {
      currentRisk = multiple * 0.5;
    } else if (consecutiveLosses === 2) {
      currentRisk = multiple * 0.8;
      console.log(" 2 current risk  changed to  ", currentRisk);
    } else {
      currentRisk = multiple; // max risk
      console.log("current risk  changed to basic ", currentRisk);
    }
  }
}
function isOverextended(ohlcv, lookback = 9, threshold = 0.025) {
  // exclude the live candle (use only completed candles)
  const recent = ohlcv.slice(-lookback - 1, -1); // last 7 *completed* candles

  const firstClose = recent[0][4];
  const lastClose = recent[recent.length - 1][4];

  const movePct = Math.abs((lastClose - firstClose) / firstClose);

  console.log(
    `📊 Overextension check: from ${firstClose.toFixed(
      4
    )} → ${lastClose.toFixed(4)} | move = ${(movePct * 100).toFixed(2)}%`
  );

  return movePct >= threshold; // true if move > threshold (e.g. 2.5%)
}

const findTrades = async () => {
  while (true) {
    try {
      const now = new Date();
      const nextIntervalMinutes = Math.ceil(now.getMinutes() / 5) * 5;
      const nextInterval = new Date(now);
      nextInterval.setMinutes(nextIntervalMinutes, 0, 0);
      nextInterval.setMilliseconds(100);

      let delay = nextInterval.getTime() - now.getTime(); // delay added

      if (delay < 0) {
        // If the calculated time is in the past, adjust to the next 5-minute interval
        delay += 5 * 60 * 1000;
      }

      await new Promise((resolve) => setTimeout(resolve, delay - 1));

      //  wait to hit time with 100ms accuracy
      while (new Date().getTime() < nextInterval.getTime()) {}

      console.log(
        "Running trade logic at:",
        new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
      );

      if (trade) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      if (Date.now() - tradeCompletedAt < 60 * 60 * 1000) {
        console.log("Within the 30-minute cooldown period, waiting...");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      const fetchInterval = getRandomDelay();
      console.log("Price fetched:", price);
      if (ordersPending == false) {
        const prioritySymbols = ["suiusdt", "enausdt"];
        let selectedSymbol = null;

        for (const sym of prioritySymbols) {
          const result = await isSymbolNear2hEMA(sym);
          console.log(
            `🔍 Checking ${sym} — % diff: ${result.percentDiff.toFixed(2)}%`
          );

          if (result.isNear) {
            selectedSymbol = sym;
            console.log(`✅ Selected symbol: ${convertSymbol(selectedSymbol)}`);
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 2220));
        }

        if (!selectedSymbol) {
          console.log("❌ No symbol is near 2h EMA. Skipping this cycle.");
          await new Promise((resolve) => setTimeout(resolve, 5000)); // wait 5s before next loop
          continue; // skip rest of logic for now
        }

        // Set it globally if needed
        if (SYMBOL !== convertSymbol(selectedSymbol)) {
          getRealTimePrice(selectedSymbol); // only starts if it's a new one
        }
        SYMBOL = convertSymbol(selectedSymbol);
        orderQuantity = MIN_ORDER_QUANTITY[SYMBOL] || 1;

        console.log("symbol ->", SYMBOL);
        console.log("Fetching and analyzing candles...");

        await new Promise((resolve) => setTimeout(resolve, fetchInterval));
        const { ohlcv, bigEma, smallEma, atr } = await fetchAndAnalyzeCandles(
          "small",
          SYMBOL
        ); // 30 min candles with ema

        console.log("Candles fetched and analyzed. and atr is ", atr);

        const lastCandle = ohlcv[ohlcv.length - 2];

        console.log("last candle -", ohlcv[ohlcv.length - 2]);
        const prevCandle = ohlcv[ohlcv.length - 3];
        const secondLastCandle = ohlcv[ohlcv.length - 4];
        const leftLen = 10;
        const rightLen = 10;

        const highs = ohlcv.map((candle) => candle[2]); // Extract highs
        const lows = ohlcv.map((candle) => candle[3]); // Extract lows
        // const pivotHighs = findPivotHighs(highs, leftLen, rightLen);
        // const pivotLows = findPivotLows(lows, leftLen, rightLen);
        // const last2PivotHighs = pivotHighs.slice(-2);
        // const last2PivotLows = pivotLows.slice(-2);

        // const response = checkBullishPatternAboveEma(filteredSwings);
        // if (response.patternMatched) {
        // } else {
        //   console.log("No pattern matched");
        // }
        trade === false && console.log("Finding Trades ....");
        if (!hasLoggedFindingTrades) {
          console.log("Finding Trades .........");
          hasLoggedFindingTrades = true;
        }
        console.log("EMA->", bigEma);
        console.log("small ema =", smallEma);

        const { smallEmat, bigEmas, latestCandle } =
          await fetchAndAnalyzeCandlesFortrend(SYMBOL);
        const [, , high, low, close] = latestCandle;
        const avg = (high + low + close) / 3;
        // const pivots = calculatePivotPoints({ high, low, close });
        //s console.log("pivots for today -", pivots);
        const percentDiff = ((avg - smallEmat) / smallEmat) * 100;

        if (percentDiff >= 8) {
          // 7.5
          console.log(
            `🔻 Close is ${percentDiff.toFixed(
              2
            )}% above EMA — Bearish reversal`
          );
          trend = "bearish";
          weakness = true;
        } else if (percentDiff <= -8) {
          //7
          console.log(
            `🔺 Close is ${Math.abs(percentDiff).toFixed(
              2
            )}% below EMA — Bullish reversal`
          );
          trend = "bullish";
          weakness = true;
        } else if (avg > smallEmat * 0.98) {
          //99
          console.log(
            `📈 Close is above EMA (${percentDiff.toFixed(
              2
            )}%) — Trend is bullish`
          );
          weakness = false;
          trend = "bullish";

          if (percentDiff > 6) {
            //5
            weakness = true;
          }
        } else {
          console.log(
            `📉 Close is below EMA (${percentDiff.toFixed(
              2
            )}%) — Trend is bearish`
          );
          trend = "bearish";
          weakness = false;
          if (percentDiff > -6) {
            // 5
            weakness = true;
          }
        }
        // } else {
        //   trend = await findTrend();
        // }

        console.log("trend ->", trend);

        if (trend === overallTrend) {
          isTrueTrend = true;
        } else {
          isTrueTrend = false;
        }

        const safePrice = await getSafePrice();
        const gate = await sidewaysGate({
          symbol: SYMBOL,
          atr,
          price: safePrice,
          minPct: 0.0084, // tune
          minHours: 5,
          breakoutBuf: 0.003,
        });

        if (gate.block) {
          console.log(
            `⏸ Blocked (${gate.regime}). Range: [${gate.lo?.toFixed?.(
              4
            )}, ${gate.hi?.toFixed?.(4)}] Hours=${gate.hours?.toFixed?.(2)}`
          );
          continue;
        }
        const extended = isOverextended(ohlcv, 7, 0.026); // 3% in last 7 candles
        if (extended) {
          console.log(
            "⚠️ Market already moved 3% in last 7 candles. Skipping hammer entry."
          );
          continue;
        } else {
          console.log("not extended . ");
        }
        if (trend === "bullish") {
          const result = checkLastCandle(lastCandle, smallEma, prevCandle); //12 ema
          const { avg, close, ema, last2hCandle, prev2hCandle } =
            await get2hEMA12(SYMBOL);

          const result3 = checkLastCandle(last2hCandle, ema, prev2hCandle);
          console.log("pct difference ->", result.emaDistancePct);
          console.log("ema ->>>>", ema, close);
          const result2 = checkLastCandleforbigtrend(ema, avg);
          console.log(
            result.isNearEMA,
            " HAMMER ? ",
            result.isBullishHammer,
            "is engulfing _>,",
            result.isBullishEngulfing,
            "2h ema close near ? ->",
            result2.isNearEMA
          );
          console.log("CURRENT PRICE ->", price);

          if (close < ema) {
            const sr = await passSimpleSR(SYMBOL, trend);
            if (SR_MODE === "log") {
              console.log(`[SR] ${sr.pass ? "✅" : "❌"} ${sr.reason}`);
            } else {
              if (!sr.pass) {
                console.log(`[SR] ❌ blocked: ${sr.reason}`);
                continue;
              }
              console.log(`[SR] ✅ passed: ${sr.reason}`);
            }
          } else {
            console.log(`[SR] ⏩ skipped (bullish but 4h close ABOVE EMA)`);
          }
          if (
            result.isNearEMA &&
            result2?.isNearEMA &&
            (result.isBullishHammer ||
              result.isBullishEngulfing ||
              result.isBullishHarami)
          ) {
            console.log("last candle is bullish hammer and  near ema");
            // const closingPrices = ohlcv.map((candle) => candle[4]);
            // const latestRSI20 = calculateRSI20(closingPrices);

            // if (latestRSI20 < 84) {
            await goToSmallerFrame(
              "bullish",
              percentDiff,
              result.emaDistancePct
            );
            // }
          }

          // if (
          //   result2?.isNearEMA &&
          //   (result3.isBullishHammer || result3.isBullishEngulfing)
          // ) {
          //   console.log("last candle (2h) is bullish hammer and  near ema");

          //   await goToSmallerFrame("bullish");
          // }
          // let { stopLossPrice, ratio, patternType } =
          //   determineBullishTradeParameters(
          //     lastCandle,
          //     prevCandle,
          //     secondLastCandle,
          //     zones,
          //     price,
          //     priceWithinRange,
          //     priceWithinRange2,
          //     ohlcv
          //   );
        } else if (trend == "bearish") {
          const result = checkLastCandle(lastCandle, smallEma, prevCandle);
          console.log("pct difference ->", result.emaDistancePct);
          const { avg, close, ema, last2hCandle, prev2hCandle } =
            await get2hEMA12(SYMBOL);
          console.log("ema-o ->", last2hCandle, close);
          const result2 = checkLastCandleforbigtrend(ema, avg);

          const result3 = checkLastCandle(last2hCandle, ema, prev2hCandle);
          console.log(
            "is near EMA ",
            result.isNearEMA,
            " HAMMER ? ",
            result.isInvertedHammer,

            "is engulfing _>,",
            result.isBearishEngulfing,
            "2h ema close near ? ->",
            result2.isNearEMA
          );

          if (close > ema) {
            const sr = await passSimpleSR(SYMBOL, trend);
            if (SR_MODE === "log") {
              console.log(`[SR] ${sr.pass ? "✅" : "❌"} ${sr.reason}`);
            } else {
              if (!sr.pass) {
                console.log(`[SR] ❌ blocked: ${sr.reason}`);
                continue;
              }
              console.log(`[SR] ✅ passed: ${sr.reason}`);
            }
          } else {
            console.log(`[SR] ⏩ skipped (bearish but 4h close BELOW EMA)`);
          }
          if (
            result.isNearEMA &&
            result2.isNearEMA &&
            (result.isInvertedHammer ||
              result.isBearishEngulfing ||
              result.isBearishHarami)
          ) {
            // const closingPrices = ohlcv.map((candle) => candle[4]);
            // console.log("last candle is beairhs and below EMA");
            // const latestRSI20 = calculateRSI20(closingPrices);
            // if (latestRSI20 > 20) {
            await goToSmallerFrame(
              "bearish",
              percentDiff,
              result.emaDistancePct
            );
            console.log("returned from smaller frame");
          }
          console.log(
            "4h inverted hammer ->",
            result3.isInvertedHammer,
            " bearish engykf ->",
            result3.isBearishEngulfing
          );
          // if (
          //   result2.isNearEMA &&
          //   (result3.isInvertedHammer || result3.isBearishEngulfing)
          // ) {
          //   // const closingPrices = ohlcv.map((candle) => candle[4]);
          //   // console.log("last candle is beairhs and below EMA");
          //   // const latestRSI20 = calculateRSI20(closingPrices);
          //   // if (latestRSI20 > 20) {
          //   console.log("tkaing 4h entry");
          //   await goToSmallerFrame("bearish");
          //   console.log("returned from smaller frame");
          // }
        }

        // let { stopLossPrice, ratio, patternType } =
        //   determineBearishTradeParameters(
        //     lastCandle,
        //     prevCandle,
        //     secondLastCandle,
        //     zones,
        //     price,
        //     priceWithinRange,
        //     priceWithinRange2,
        //     ohlcv
        //   );
      }
      console.log("errorZ - ", error);
    } catch (error) {
      error += error;
      console.error("Error tracking real-time price:", error);
      console.log("errorZ - ", error);
    }
  }
};

const main = async () => {
  try {
    const status = await Status.findOne();

    SYMBOL = convertSymbol(status.symbol);
    overallTrend = await findTrend();
    multiple = status.orderMultiple;
    currentRisk = multiple * 0.5;
    console.log("symbol is ->", SYMBOL);
    orderQuantity = MIN_ORDER_QUANTITY[SYMBOL] || 1;
    const timeframe = status.trendStatus?.sourceTimeframe;
    slPercentage = SL_PERCENTAGE[timeframe] || 0.014;
    console.log("slpercentage ->", slPercentage);

    console.log("minimum Quantity->", orderQuantity);
    console.log("multiple ->", multiple);
    console.log("current risk ->", currentRisk);
    if (!status) {
      console.log("Status document not found!");
      return;
    }
    if (status.botStatus.isRunning) {
      getRealTimePrice(status.symbol);

      const positions = await binance.fetchPositions();
      const position = positions.find(
        (p) =>
          p.info.symbol === SYMBOL.replace("/", "") &&
          parseFloat(p.info.positionAmt) !== 0
      );

      if (!position) {
        await findTrades();
      } else {
        await trackOpenPosition();
        lastOrderExecuted = false;
        lastSlOrderExecuted = false;
        firstBook = false;
        secondBook = false;
        finalBook = false;
        profitBooked = false;
        console.log("⏸ Pausing execution for 1 hour... 1");
        await cancelAllOpenOrders();
        tradeCompletedAt = Date.now();
        await findTrades();
      }
    } else {
      console.log("Bot is not running. Skipping real-time price fetching.");
    }
  } catch (error) {
    console.error("Error in main function:", error);
  }
};
main();

function checkLastCandle(candle, ema, prevCandle) {
  const [, open, high, low, close] = candle;
  const [, pOpen, pHigh, pLow, pClose] = prevCandle;

  // --- EMA proximity ---
  const emaDiff = close - ema;
  const emaDistancePct = (emaDiff / ema) * 100; // % distance
  const isNearEMA = Math.abs(emaDiff) <= ema * 0.013; // ~0.92%

  // --- Ranges, bodies, wicks ---
  const range = Math.max(1e-9, high - low);
  const body = Math.abs(close - open);
  const lowerWick = Math.min(open, close) - low;
  const upperWick = high - Math.max(open, close);

  // size gates
  const isBodyBigEnough = body >= range * 0.55; // for hammers
  const bodyNotTinyForEngulf = body >= range * 0.35; // relaxed for engulf

  // hammers
  const isBullishHammer =
    lowerWick > body * 1.1 &&
    upperWick < lowerWick * 0.7 &&
    body > 0 &&
    body <= lowerWick;

  const isInvertedHammer =
    upperWick > body * 1.1 &&
    lowerWick < upperWick * 0.7 &&
    body > 0 &&
    body <= upperWick;

  // ----- BODY-TO-BODY ENGULFING -----
  const bodyLow = Math.min(open, close);
  const bodyHigh = Math.max(open, close);
  const prevBodyLow = Math.min(pOpen, pClose);
  const prevBodyHigh = Math.max(pOpen, pClose);
  const eps = 1e-8;

  const isGreen = close > open + eps;
  const isRed = open > close + eps;
  const prevGreen = pClose > pOpen + eps;
  const prevRed = pOpen > pClose + eps;

  const bodyEngulfsPrev =
    bodyLow <= prevBodyLow + eps && bodyHigh >= prevBodyHigh - eps;

  const isBullishEngulfing = isGreen && bodyNotTinyForEngulf && bodyEngulfsPrev;
  const isBearishEngulfing = isRed && bodyNotTinyForEngulf && bodyEngulfsPrev;

  // ----- HARAMI (inside body) -----
  const MIN_PREV_BODY_FRAC = 0.25;
  const MAX_CURR_VS_PREV_BODY = 0.7;
  const prevRange = Math.max(1e-9, pHigh - pLow);
  const prevBody = Math.abs(pClose - pOpen);

  const prevBodyNotTiny = prevBody >= prevRange * MIN_PREV_BODY_FRAC;
  const currBodySmaller = body <= prevBody * MAX_CURR_VS_PREV_BODY;

  const bodyInsidePrev =
    bodyLow >= prevBodyLow - eps && bodyHigh <= prevBodyHigh + eps;

  const isBullishHarami =
    prevRed && isGreen && prevBodyNotTiny && currBodySmaller && bodyInsidePrev;

  const isBearishHarami =
    prevGreen && isRed && prevBodyNotTiny && currBodySmaller && bodyInsidePrev;

  return {
    isNearEMA,
    emaDistancePct,
    isBullishHammer,
    isInvertedHammer,
    isBullishEngulfing,
    isBearishEngulfing,
    isBullishHarami,
    isBearishHarami,
  };
}

function checkLastCandleforbigtrend(ema, close) {
  let upperProximityRange, lowerProximityRange;

  if (trend === "bullish") {
    upperProximityRange = ema * 0.024; // 0.02%
    lowerProximityRange = ema * 0.016; // 0.015%
  } else if (trend === "bearish") {
    upperProximityRange = ema * 0.016; // 0.5%
    lowerProximityRange = ema * 0.024; // 0.8%
  } else {
    // fallback in case trend is undefined or unknown
    upperProximityRange = ema * 0.0065;
    lowerProximityRange = ema * 0.0065;
  }

  const isNearEMA =
    price <= ema + upperProximityRange && price >= ema - lowerProximityRange;
  console.log("ema ->", ema, "price--", price);
  return {
    isNearEMA,
  };
}

const goToSmallerFrame = async (type, percentDiff, emapct) => {
  console.log("order already there? ->", ordersPending);
  if (ordersPending) {
    console.log("orders already pending");
    return;
  }
  percentDiffGlobal = percentDiff;
  pct = emapct;
  const { ohlcv, atr } = await fetchAndAnalyzeCandles("small", SYMBOL);
  if (!ohlcv || ohlcv.length === 0) {
    console.error("No OHLCV data available");
    return;
  }

  console.log("🟢 sidways test pased", atr);
  const lastCandle = ohlcv[ohlcv.length - 2];
  const open = lastCandle[1];
  const high = lastCandle[2];
  const low = lastCandle[3];
  const close = lastCandle[4];
  console.log(`📊 Price: ${price} | High: ${high} | Low: ${low}`);

  const highBreak = high;
  const lowInvalidation = low * 0.99; // 99
  const highInvalidation = high * 1.01; // 1.01

  console.log(
    `${type === "bullish" ? "🟢" : "🔴"} Waiting for ${
      type === "bullish" ? "high breakout" : "low breakdown"
    } or invalidation`
  );
  console.log(" high invalidation  for short->", highInvalidation);
  console.log(" low invalidation for long ->", lowInvalidation);
  const poll = async () => {
    if (ordersPending) return;

    const safePrice = await getSafePrice();
    if (type === "bullish") {
      console.log("bullish but price is ->", safePrice);
      if (safePrice >= highBreak) {
        console.log("✅ Breakout! Placing market BUY");
        let opp = pct < 0;
        if (opp) {
          if (isOverextended(ohlcv, 4, 0.016)) {
            console.log(
              "not placing order. as its overextended against the trend"
            );
            return;
          }
        }
        ordersPending = true; // <-- SET EARLY TO PREVENT DUPLICATES
        try {
          await placeMarketOrder("buy", atr, pct);
          await trackOpenPosition();
          ordersPending = false;
          tradeCompletedAt = Date.now();
        } catch (err) {
          ordersPending = false; // rollback if failed
          console.error("❌ Failed to place BUY:", err.message);
        }
        return;
      } else if (safePrice <= lowInvalidation) {
        console.log(
          "❌ Invalidated (price dropped 0.4% below low). Exiting...",
          safePrice
        );
        return;
      }
    } else if (type === "bearish") {
      console.log("bearish but price is ->", safePrice);
      if (safePrice <= low) {
        let opp = pct > 0;
        if (opp) {
          if (isOverextended(ohlcv, 4, 0.013)) {
            console.log(
              "not placing order. as its overextended against the trend"
            );
            return;
          }
        }
        console.log("✅ Breakdown! Placing market SELL");
        ordersPending = true;
        try {
          await placeMarketOrder("sell", atr, pct);
          await trackOpenPosition();
          ordersPending = false;
          tradeCompletedAt = Date.now();
        } catch (err) {
          ordersPending = false;
          console.error("❌ Failed to place SELL:", err.message);
        }
        return;
      } else if (safePrice >= highInvalidation) {
        console.log("❌ Invalidated (price rose 0.4% above high). Exiting...");
        return;
      }
    }

    const nextDelay = Math.floor(Math.random() * (300 - 100 + 1)) + 100;
    setTimeout(poll, nextDelay);
  };

  poll(); // start polling
};
const trackOpenPosition = async () => {
  console.log("📡 Tracking active position...");

  let slUpdated = false;
  let initialPositionAmt = 0;
  let entryPrice = 0;
  let slTightened = false;
  let slTightened2 = false;
  let slTightened3 = false;
  let trailingActive = false;
  let lastSLTriggerPrice = 0;
  let lastSLUpdateTime = 0;
  let lastUnrealizedPnL = 0;
  let currentSLATRMultiplier = 3.5;
  let pctt = Math.abs(pct);
  let risk = "safe";
  if (pctt > 0.5 && pctt < 0.85) {
    risk = "medium";
  } else if (pctt > 0.85 && pctt < 1.2) {
    risk = "hard";
  }

  while (true) {
    await delay(Math.floor(Math.random() * (3100 - 2500 + 1)) + 2400);
    const safePrice = await getSafePrice();
    try {
      const position = await getActivePosition();
      if (!position || parseFloat(position.info.positionAmt) === 0) {
        console.log("✅ Position closed.");
        const result = lastUnrealizedPnL > 0 ? "win" : "loss";
        updateRisk(result);
        await cancelAllOpenOrders();
        return;
      }

      const posSize = Math.abs(parseFloat(position.info.positionAmt));
      entryPrice = parseFloat(position.info.entryPrice);
      const side = parseFloat(position.info.positionAmt) > 0 ? "buy" : "sell";

      const unrealizedPnL = parseFloat(position.info.unRealizedProfit);
      lastUnrealizedPnL = unrealizedPnL;
      console.log(
        `📊 [${side.toUpperCase()}] Qty: ${posSize} | Entry: ${entryPrice} | Price: ${safePrice} | PnL: ${unrealizedPnL}`
      );

      const profitThreshold = ATR * 1.5;
      const tightenSLDistance = ATR * 1.6;

      if (
        !slTightened &&
        unrealizedPnL > 0.1 &&
        safePrice !== 0 &&
        ((side === "buy" && safePrice >= entryPrice + profitThreshold) ||
          (side === "sell" && safePrice <= entryPrice - profitThreshold))
      ) {
        console.warn(
          "🎯 Price reached profit threshold — tightening SL near entry",
          entryPrice,
          safePrice,
          profitThreshold,
          side
        );

        const openOrders = await binance.fetchOpenOrders(SYMBOL);
        for (const order of openOrders) {
          if (order.type === "stop_market") {
            await binance.cancelOrder(order.id, SYMBOL);
            console.log(`🧹 Old SL canceled for tighten: ${order.id}`);
          }
        }

        const slSide = side === "buy" ? "sell" : "buy";
        const tightenedSL =
          side === "buy"
            ? entryPrice - tightenSLDistance
            : entryPrice + tightenSLDistance;

        console.warn(
          "tightened s ->",
          tightenedSL,
          " pos size",
          posSize,
          slSide,
          getSafePrice
        );
        await binance.createOrder(
          SYMBOL,
          "STOP_MARKET",
          slSide,
          posSize,
          undefined,
          { stopPrice: tightenedSL.toFixed(2), reduceOnly: true }
        );

        console.log("🔒 SL tightened near entry:", tightenedSL.toFixed(2));

        // Optional: deactivate further trailing
        slTightened = true;
        trailingActive = false;
      }

      const profitThreshold2 = ATR * 4;
      const tightenSLDistance2 = ATR * 0.3;

      if (
        !slTightened2 &&
        unrealizedPnL > 0.1 &&
        safePrice !== 0 &&
        ((side === "buy" && safePrice >= entryPrice + profitThreshold2) ||
          (side === "sell" && safePrice <= entryPrice - profitThreshold2))
      ) {
        console.log(
          "🎯 Price reached profit threshold — tightening SL near entry"
        );

        const openOrders = await binance.fetchOpenOrders(SYMBOL);
        for (const order of openOrders) {
          if (order.type === "stop_market") {
            await binance.cancelOrder(order.id, SYMBOL);
            console.log(`🧹 Old SL canceled for tighten: ${order.id}`);
          }
        }

        const slSide = side === "buy" ? "sell" : "buy";
        const tightenedSL =
          side === "buy"
            ? entryPrice - tightenSLDistance2
            : entryPrice + tightenSLDistance2;

        await binance.createOrder(
          SYMBOL,
          "STOP_MARKET",
          slSide,
          posSize,
          undefined,
          { stopPrice: tightenedSL.toFixed(2), reduceOnly: true }
        );

        console.log("🔒 SL tightened near entry:", tightenedSL.toFixed(2));

        // Optional: deactivate further trailing
        slTightened2 = true;
        trailingActive = false;
      }

      const profitThreshold3 = ATR * 6;

      // ✅ protect price just like placeOrder

      const newSL =
        side === "buy" ? safePrice - ATR * 4.5 : safePrice + ATR * 4.5;

      if (
        !slTightened3 &&
        unrealizedPnL > 0.1 &&
        ((side === "buy" && safePrice >= entryPrice + profitThreshold3) ||
          (side === "sell" && safePrice <= entryPrice - profitThreshold3))
      ) {
        console.log(
          "🎯 Price reached profit threshold — tightening SL near entry"
        );

        const openOrders = await binance.fetchOpenOrders(SYMBOL);
        for (const order of openOrders) {
          if (order.type === "stop_market") {
            await binance.cancelOrder(order.id, SYMBOL);
            console.log(`🧹 Old SL canceled for tighten: ${order.id}`);
          }
        }

        const slSide = side === "buy" ? "sell" : "buy";

        await binance.createOrder(
          SYMBOL,
          "STOP_MARKET",
          slSide,
          posSize,
          undefined,
          { stopPrice: newSL.toFixed(3), reduceOnly: true }
        );

        console.log("🔒 SL tightened near entry:", newSL.toFixed(3));
        slTightened3 = true;
        trailingActive = false;
      }

      if (initialPositionAmt === 0) initialPositionAmt = posSize;

      if (!slUpdated && posSize <= initialPositionAmt * 0.8) {
        console.log("⚠️ TP1 likely hit. Enabling SL trail...");

        const openOrders = await binance.fetchOpenOrders(SYMBOL);
        for (const order of openOrders) {
          if (order.type === "stop_market") {
            await binance.cancelOrder(order.id, SYMBOL);
            console.log(`🧹 SL canceled: ${order.id}`);
          }
        }

        trailingActive = true;
        lastSLTriggerPrice = safePrice;
        lastSLUpdateTime = Date.now();
        currentSLATRMultiplier = 3.7;

        const initialSL =
          side === "buy" ? safePrice - ATR * 5 : safePrice + ATR * 5;
        const slSide = side === "buy" ? "sell" : "buy";

        await binance.createOrder(
          SYMBOL,
          "STOP_MARKET",
          slSide,
          posSize,
          undefined,
          { stopPrice: initialSL.toFixed(3), reduceOnly: true }
        );

        console.log("🛡️ Initial trailing SL placed at:", initialSL.toFixed(3));
        slUpdated = true;
      }

      if (
        percentDiffGlobal < 0 &&
        percentDiffGlobal > -2 &&
        trend == "bullish"
      ) {
        const movePct =
          side === "buy"
            ? (safePrice - entryPrice) / entryPrice
            : (entryPrice - safePrice) / entryPrice;

        if (movePct >= 0.021) {
          console.warn(
            "🚨 Hard-exit: +2% move from entry. Closing position now."
          );
          try {
            const openOrders = await binance.fetchOpenOrders(SYMBOL);
            for (const o of openOrders) {
              if (o.type === "stop_market" || o.type === "take_profit_market") {
                await binance.cancelOrder(o.id, SYMBOL);
                console.log(`🧹 Canceled exit order: ${o.id}`);
              }
            }
          } catch (e) {
            console.warn("⚠️ Could not cancel exits:", e.message);
          }

          const exitSide = side === "buy" ? "sell" : "buy";
          try {
            await binance.createOrder(
              SYMBOL,
              "MARKET",
              exitSide,
              posSize,
              undefined,
              { reduceOnly: true }
            );
            console.log("✅ Hard-exit market close sent.");
          } catch (e) {
            console.error("❌ Hard-exit failed:", e.message);
          }

          updateRisk("win");
          await cancelAllOpenOrders();
          return;
        }
      }
      console.log("risk ->", risk);
      if (risk == "hard" || lastResult == "win") {
        const movePct =
          side === "buy"
            ? (safePrice - entryPrice) / entryPrice
            : (entryPrice - safePrice) / entryPrice;

        if (movePct > 0.021) {
          console.warn(
            "🚨 Hard-exit: +2% move from entry. Closing position now."
          );

          const exitSide = side === "buy" ? "sell" : "buy";
          try {
            await binance.createOrder(
              SYMBOL,
              "MARKET",
              exitSide,
              posSize,
              undefined,
              { reduceOnly: true }
            );
            console.log("✅ Hard-exit market close sent.");
          } catch (e) {
            console.error("❌ Hard-exit failed:", e.message);
          }
          try {
            const openOrders = await binance.fetchOpenOrders(SYMBOL);
            for (const o of openOrders) {
              if (o.type === "stop_market" || o.type === "take_profit_market") {
                await binance.cancelOrder(o.id, SYMBOL);
                console.log(`🧹 Canceled exit order: ${o.id}`);
              }
            }
          } catch (e) {
            console.warn("⚠️ Could not cancel exits:", e.message);
          }

          updateRisk("win");
          await cancelAllOpenOrders();
          return;
        }
      }
      if (trailingActive) {
        // protect price
        let safePrice = 0;
        while (!safePrice || safePrice <= 0 || isNaN(safePrice)) {
          if (!price || price <= 0 || isNaN(price)) {
            await delay(10);
          } else {
            safePrice = price;
          }
        }

        const movePct =
          side === "buy"
            ? (safePrice - entryPrice) / entryPrice
            : (entryPrice - safePrice) / entryPrice;

        if (movePct >= 0.08) {
          console.warn(
            "🚨 Hard-exit: +10% move from entry. Closing position now."
          );
          try {
            const openOrders = await binance.fetchOpenOrders(SYMBOL);
            for (const o of openOrders) {
              if (o.type === "stop_market" || o.type === "take_profit_market") {
                await binance.cancelOrder(o.id, SYMBOL);
                console.log(`🧹 Canceled exit order: ${o.id}`);
              }
            }
          } catch (e) {
            console.warn("⚠️ Could not cancel exits:", e.message);
          }

          const exitSide = side === "buy" ? "sell" : "buy";
          try {
            await binance.createOrder(
              SYMBOL,
              "MARKET",
              exitSide,
              posSize,
              undefined,
              { reduceOnly: true }
            );
            console.log("✅ Hard-exit market close sent.");
          } catch (e) {
            console.error("❌ Hard-exit failed:", e.message);
          }

          updateRisk("win");
          await cancelAllOpenOrders();
          return;
        }
        const timeSinceLastUpdate = Date.now() - lastSLUpdateTime;
        const TRAIL_INTERVAL_MS = 60 * 60 * 1000; // 90 minutes

        const slSide = side === "buy" ? "sell" : "buy";
        const atrMultiplier = 4;

        if (timeSinceLastUpdate >= TRAIL_INTERVAL_MS) {
          // ✅ protect price (avoid 0/NaN)
          let safePrice = 0;
          while (!safePrice || safePrice <= 0 || isNaN(safePrice)) {
            if (!price || price <= 0 || isNaN(price)) {
              await delay(10);
            } else {
              safePrice = price;
            }
          }

          if (
            (side === "buy" && safePrice > lastSLTriggerPrice * 1.015) ||
            (side === "sell" && safePrice < lastSLTriggerPrice * 0.985)
          ) {
            let newSL =
              side === "buy"
                ? safePrice - ATR * atrMultiplier
                : safePrice + ATR * atrMultiplier;

            const openOrders = await binance.fetchOpenOrders(SYMBOL);
            for (const order of openOrders) {
              if (order.type === "stop_market") {
                await binance.cancelOrder(order.id, SYMBOL);
                console.log(`♻️ Old SL canceled: ${order.id}`);
              }
            }

            await binance.createOrder(
              SYMBOL,
              "STOP_MARKET",
              slSide,
              posSize,
              undefined,
              { stopPrice: newSL.toFixed(3), reduceOnly: true } // use 3 dp for SUI tick
            );

            lastSLTriggerPrice = safePrice; // <- update with the guarded price
            lastSLUpdateTime = Date.now();
            console.log("🔁 Trailing SL moved to:", newSL.toFixed(3));
          } else {
            console.log("⏸ Price not improved — skip SL update");
          }
        }
      }
    } catch (err) {
      console.error(
        "❌ Error in tracking loop:",
        err.message,
        price,
        new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
      );
    }
  }
};

const placeMarketOrder = async (side, atr, pct) => {
  // ===== Step 0: Prevent double entry =====
  let pctt = Math.abs(pct);
  let risk = "safe";
  if (pctt > 0.5 && pctt < 0.85) {
    risk = "medium";
  } else if (pctt > 0.85 && pctt < 1.2) {
    risk = "hard";
  }
  const positions = await binance.fetchPositions();
  const position = positions.find(
    (p) =>
      p.info.symbol === SYMBOL.replace("/", "") &&
      parseFloat(p.info.positionAmt) !== 0
  );
  if (position) {
    console.log("⚠️ Position already open, skipping entry");
    return;
  }

  let totalAmount = orderQuantity * currentRisk * 1.1;
  let opp = (side == "buy" && pct < 0) || (side == "sell" && pct > 0);
  if (weakness === true || (opp && risk == "hard")) {
    totalAmount = totalAmount / 1.5;
  }

  const amountTP1 = totalAmount * 0.55;
  const amountTP2 = totalAmount * 0.45;

  ATR = atr;
  const slMultiplier = 2.4;
  const tp1Multiplier = risk == "safe" ? 9.4 : risk == "medium" ? 5.2 : 4.2;

  const slSide = side === "buy" ? "sell" : "buy";

  const safePrice = await getSafePrice();
  let entryPrice = safePrice;

  console.log(" entry ->", entryPrice);
  const stopLossPrice =
    side === "buy"
      ? entryPrice - atr * slMultiplier
      : entryPrice + atr * slMultiplier;

  const takeProfitPrice1 =
    side === "buy"
      ? entryPrice + atr * tp1Multiplier
      : entryPrice - atr * tp1Multiplier;

  try {
    // ===== Step 1: Entry =====
    const entryOrder = await binance.createOrder(
      SYMBOL,
      "MARKET",
      side,
      totalAmount
    );
    console.log("✅ Market order placed:", totalAmount, side);

    // ===== Step 2: SL placement =====

    try {
      await binance.createOrder(
        SYMBOL,
        "STOP_MARKET",
        slSide,
        totalAmount,
        undefined,
        { stopPrice: stopLossPrice.toFixed(2), reduceOnly: true }
      );
      console.log("🛑 SL set at:", stopLossPrice);
    } catch (err) {
      console.error(
        "❌ SL placement failed:",
        err.message,
        new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
      );
      console.warn(
        "stop price ->",
        stopLossPrice,
        "price ",
        price,
        "atr",
        atr,
        "safePrce>",
        safePrice,
        "amunt ->",
        totalAmount
      );
      console.warn(
        "🚨 Closing position immediately!",
        new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
      );
      await binance.createOrder(SYMBOL, "MARKET", slSide, totalAmount);
      return; // abort
    }

    // ===== Step 3: TP1 placement =====
    try {
      await binance.createOrder(
        SYMBOL,
        "TAKE_PROFIT_MARKET",
        slSide,
        amountTP1,
        undefined,
        { stopPrice: takeProfitPrice1.toFixed(2), reduceOnly: true }
      );
      console.log("🎯 TP1 set at:", takeProfitPrice1);
    } catch (err) {
      console.error("❌ TP1 placement failed:", err.message);
      console.warn("🚨 Closing position immediately!");
      console.warn(
        "stop price ->",
        takeProfitPrice1,
        "price ",
        price,
        safePrice,
        "ATR",
        atr,
        "amunt ->",
        amountTP1
      );
      await binance.createOrder(SYMBOL, "MARKET", slSide, totalAmount);
      return; // abort
    }

    // No static TP2 — will trail manually later
    weakness = false;
    return {
      stopLossPrice,
      takeProfitPrice1,
      amountTP2,
      entryPrice,
      side,
    };
  } catch (err) {
    console.error("❌ Entry order failed:", err.message);
    weakness = false;
    throw err;
  }
};

// ---- config

// ---- helpers
function lastSwingHighLow(ohlcv, L = 3, R = 3) {
  let sh = null,
    sl = null;
  for (let i = L; i < ohlcv.length - R; i++) {
    const hi = ohlcv[i][2],
      lo = ohlcv[i][3];
    let isH = true,
      isL = true;
    for (let j = i - L; j <= i + R; j++) {
      if (ohlcv[j][2] > hi) isH = false;
      if (ohlcv[j][3] < lo) isL = false;
      if (!isH && !isL) break;
    }
    if (isH) sh = { i, price: hi };
    if (isL) sl = { i, price: lo };
  }
  return { sh, sl };
}
function atr30m(ohlcv, period = 20) {
  const tr = [];
  for (let i = 1; i < ohlcv.length; i++) {
    const h = ohlcv[i][2],
      l = ohlcv[i][3],
      pc = ohlcv[i - 1][4];
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let r = tr[0] || 0,
    a = 1 / period;
  for (let i = 1; i < tr.length; i++) r = a * tr[i] + (1 - a) * r;
  return r;
}
function inZone(p, center, buf) {
  return p >= center - buf && p <= center + buf;
}
function sweptReject(latest, level, side) {
  const [, o, h, l, c] = latest;
  return side === "bearish" ? h > level && c < level : l < level && c > level;
}

// ---- call this inside findTrades after you compute trend + latest 30m candle
async function passSimpleSR(
  symbol,
  trend,
  {
    atrLen = 20,
    leftRight = SR_LEFT_RIGHT,
    bufMult = SR_ATR_MULT,
    LOOKBACK_BARS = 3, // how many closed 30m bars to look back
    SWEEP_OVERSHOOT_FRAC = 0.25, // how deep beyond level counts as a sweep
  } = {}
) {
  if (!ENABLE_SR_FILTER)
    return { pass: true, reason: "disabled", level: null, barsAgo: null };

  const o = await binance.fetchOHLCV(symbol, "2h", undefined, 220);
  if (!o || o.length < 60)
    return { pass: false, reason: "no data", level: null, barsAgo: null };

  // Work only with CLOSED bars; ignore the very latest building bar
  const closed = o;
  const latest = closed[closed.length - 2];
  const a = atr30m(closed, atrLen);

  // Swings computed on closed data only
  const { sh, sl } = lastSwingHighLow(closed, leftRight, leftRight);
  if (!sh && !sl)
    return { pass: false, reason: "no swings", level: null, barsAgo: null };

  const buf = a * bufMult;
  console.log("buff34 ->", buf);
  const band = (level) => ({ lo: level - buf, hi: level + buf });
  console.log(" resistance ->", sh, " support ->", sl);
  // Helper: strict-ish sweep (overshoot + close back inside)
  function sweptRejectStrict(candle, level, side) {
    const [, o, h, l, c] = candle;
    const { lo, hi } = band(level);
    if (side === "bearish") {
      // push above band by some fraction, then close back below band
      const overshoot =
        h > hi * (1 + SWEEP_OVERSHOOT_FRAC * (buf / Math.max(1e-9, level)));
      return overshoot && c < hi;
    } else {
      // push below band by some fraction, then close back above band
      const overshoot =
        l < lo * (1 - SWEEP_OVERSHOOT_FRAC * (buf / Math.max(1e-9, level)));
      return overshoot && c > lo;
    }
  }

  // Scan back LOOKBACK_BARS closed candles (including the last closed)
  const start = Math.max(0, closed.length - LOOKBACK_BARS);
  for (let idx = closed.length - 1; idx >= start; idx--) {
    const bar = closed[idx];
    const barsAgo = closed.length - 1 - idx;
    const [, , hi, lo, cl] = bar;

    if (trend === "bullish" && sl) {
      const { lo: bandLo, hi: bandHi } = band(sl.price);
      const inSupport = cl >= bandLo && cl <= bandHi;
      const swept =
        sweptRejectStrict(bar, sl.price, "bullish") ||
        sweptReject(bar, sl.price, "bullish");

      if (inSupport) {
        console.log(
          `[${symbol}] ✅ SR pass — in 30m support @ ${sl.price} (barsAgo=${barsAgo})`
        );
        return {
          pass: true,
          reason: "in 30m support",
          level: sl.price,
          barsAgo,
        };
      }
      if (swept) {
        console.log(
          `[${symbol}] ✅ SR pass — support sweep @ ${sl.price} (barsAgo=${barsAgo})`
        );
        return {
          pass: true,
          reason: "support sweep",
          level: sl.price,
          barsAgo,
        };
      }
    }

    if (trend === "bearish" && sh) {
      const { lo: bandLo, hi: bandHi } = band(sh.price);
      const inResistance = cl >= bandLo && cl <= bandHi;
      const swept =
        sweptRejectStrict(bar, sh.price, "bearish") ||
        sweptReject(bar, sh.price, "bearish");

      if (inResistance) {
        console.log(
          `[${symbol}] ✅ SR pass — in 30m resistance @ ${sh.price} (barsAgo=${barsAgo})`
        );
        return {
          pass: true,
          reason: "in 30m resistance",
          level: sh.price,
          barsAgo,
        };
      }
      if (swept) {
        console.log(
          `[${symbol}] ✅ SR pass — resistance sweep @ ${sh.price} (barsAgo=${barsAgo})`
        );
        return {
          pass: true,
          reason: "resistance sweep",
          level: sh.price,
          barsAgo,
        };
      }
    }
  }

  return {
    pass: false,
    reason: "no recent SR touch/sweep",
    level: null,
    barsAgo: null,
  };
}
async function getSafePrice() {
  let safePrice = 0;
  while (!safePrice || safePrice <= 0 || Number.isNaN(safePrice)) {
    const p = price; // or await getRealTimePrice(symbol) if you fetch fresh
    if (!p || p <= 0 || Number.isNaN(p)) {
      console.warn("⚠️ Invalid price (0/NaN). Retrying fetch...");
      await delay(50); // wait a little before retry
    } else {
      safePrice = p;
    }
  }
  return safePrice;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getActivePosition() {
  const positions = await binance.fetchPositions();
  return positions.find(
    (p) =>
      p.info.symbol === SYMBOL.replace("/", "") &&
      parseFloat(p.info.positionAmt) !== 0
  );
}

const cancelAllOpenOrders = async () => {
  try {
    const openOrders = await binance.fetchOpenOrders(SYMBOL);

    if (openOrders.length === 0) {
      console.log(`ℹ️ No open orders for ${SYMBOL} to cancel.`);
      return;
    }

    await Promise.all(
      openOrders.map((order) =>
        binance
          .cancelOrder(order.info.orderId, SYMBOL)
          .then(() =>
            console.log(
              `❌ Cancelled Order ${order.info.orderId} at ${order.info.price} for ${SYMBOL}`
            )
          )
      )
    );

    // ✅ Clear ordersPlaced and reset pending status after cancellation
    ordersPlaced = [];
    ordersPending = false;
    console.log("🔄 All open orders cancelled. Orders cleared.");
  } catch (err) {
    console.error(`❌ Error cancelling orders for ${SYMBOL}:`, err);
  }
};
