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
import { calculatePivotPoints } from "./utils.js";
import {
  AMOUNT,
  FIXED_RISK_AMOUNT,
  LEVERAGE,
  BIGGER_TIMEFRAME,
} from "./config.js";
import {
  findPivotHighs,
  findPivotLows,
  checkBullishPatternAboveEma,
} from "./utils.js";

let high = null;
let low = null;
let ordersPending = false;
let error = 0;
let activeSymbol = null;
let priceSocket = null;

let neutral = false;
let hasLoggedTradeTracking = false;
let tradeExecutionOpen = false;
let firstBook = false;
let secondBook = false;
let finalBook = false;
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
let ATR = 8;
let weakness = false;
let SL_TRAIL_INTERVAL = 3;
let consecutiveLosses = 0;
let NO_MOVE_ZONE_PERCENT = 0.006;
let ordersPlaced = [];
const MIN_NOTIONAL = 5;
let tradeCompletedAt = 0;
let initialProfitBooked = false;
const MIN_ORDER_QUANTITY = {
  "SOL/USDT": 1,
  "LTC/USDT": 0.16,
  "ETH/USDT": 0.009,
  "XRP/USDT": 4,
  "SUI/USDT": 4,
  "ALGO/USDT": 300,
  "ENA/USDT": 20,
  "MYX/USDT": 4.5,
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
  const proximityThreshold = 2.5; // percent

  return {
    isNear: percentDiff <= proximityThreshold,
    symbol,
    ema,
    close,
    percentDiff,
  };
};
function updateRisk(result) {
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
        const prioritySymbols = ["suiusdt, enausdt, ethusdt"];
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
        if (trend === "bullish") {
          const result = checkLastCandle(lastCandle, smallEma, prevCandle); //12 ema
          const { avg, close, ema, last2hCandle, prev2hCandle } =
            await get2hEMA12(SYMBOL);

          const result3 = checkLastCandle(last2hCandle, ema, prev2hCandle);

          console.log("ema ->>>>", ema, close);
          const result2 = checkLastCandleforbigtrend(ema, avg);
          console.log(
            result.isNearEMA,
            " HAMMER ? ",
            result.isBullishHammer,
            "2h ema close near ? ->",
            result2.isNearEMA
          );
          console.log("CURRENT PRICE ->", price);
          if (
            result.isNearEMA &&
            result2?.isNearEMA &&
            (result.isBullishHammer || result.isBullishEngulfing)
          ) {
            console.log("last candle is bullish hammer and  near ema");
            // const closingPrices = ohlcv.map((candle) => candle[4]);
            // const latestRSI20 = calculateRSI20(closingPrices);

            // if (latestRSI20 < 84) {
            await goToSmallerFrame("bullish");
            // }
          }
          if (
            result2?.isNearEMA &&
            (result3.isBullishHammer || result3.isBullishEngulfing)
          ) {
            console.log("last candle (2h) is bullish hammer and  near ema");

            await goToSmallerFrame("bullish");
          }
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
            "2h ema close near ? ->",
            result2.isNearEMA
          );
          if (
            result.isNearEMA &&
            result2.isNearEMA &&
            (result.isInvertedHammer || result.isBearishEngulfing)
          ) {
            // const closingPrices = ohlcv.map((candle) => candle[4]);
            // console.log("last candle is beairhs and below EMA");
            // const latestRSI20 = calculateRSI20(closingPrices);
            // if (latestRSI20 > 20) {
            await goToSmallerFrame("bearish");
            console.log("returned from smaller frame");
          }

          if (
            result2.isNearEMA &&
            (result3.isInvertedHammer || result3.isBearishEngulfing)
          ) {
            // const closingPrices = ohlcv.map((candle) => candle[4]);
            // console.log("last candle is beairhs and below EMA");
            // const latestRSI20 = calculateRSI20(closingPrices);
            // if (latestRSI20 > 20) {
            await goToSmallerFrame("bearish");
            console.log("returned from smaller frame");
          }
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
  const open = candle[1];
  const high = candle[2];
  const low = candle[3];
  const close = candle[4];
  const vol = candle[5];
  const prevOpen = prevCandle[1];
  const prevHigh = prevCandle[2];
  const prevLow = prevCandle[3];
  const prevClose = prevCandle[4];
  console.log(" volume ->", vol);
  const emaProximityRange = ema * 0.014; // ~0.014%
  const isNearEMA = Math.abs(close - ema) <= emaProximityRange;
  const candleRange = high - low;
  const minBodySizePercent = 0.55; // 50% of the total range required as body

  const isBodyBigEnough =
    Math.abs(close - open) >= candleRange * minBodySizePercent;

  const bodySize = Math.abs(close - open);
  const lowerWick = Math.min(open, close) - low;
  const upperWick = high - Math.max(open, close);
  const isVolumeConfirmation = vol > prevCandle[5] * 0.8;

  const isBullishHammer =
    lowerWick > bodySize * 1.1 &&
    upperWick < lowerWick * 0.7 &&
    bodySize > 0 &&
    bodySize <= lowerWick;

  const isInvertedHammer =
    upperWick > bodySize * 1.1 &&
    lowerWick < upperWick * 0.7 &&
    bodySize > 0 &&
    bodySize <= upperWick;

  // ✅ Improved Bullish Engulfing
  const isBullishEngulfing =
    close > open && // current green
    open < prevClose && // opens below previous close
    close >= prevHigh &&
    isBodyBigEnough;

  // ✅ Improved Bearish Engulfing
  const isBearishEngulfing =
    close < open && // current red
    open > prevClose && // opens above previous close
    close <= prevLow &&
    isBodyBigEnough;

  return {
    isNearEMA,
    isBullishHammer,
    isInvertedHammer,
    isBullishEngulfing,
    isBearishEngulfing,
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

const goToSmallerFrame = async (type) => {
  console.log("order already there? ->", ordersPending);
  if (ordersPending) {
    console.log("orders already pending");
    return;
  }

  const { ohlcv, atr } = await fetchAndAnalyzeCandles("small", SYMBOL);
  if (!ohlcv || ohlcv.length === 0) {
    console.error("No OHLCV data available");
    return;
  }

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

    if (type === "bullish") {
      console.log("bullish but price is ->", price);
      if (price >= highBreak) {
        console.log("✅ Breakout! Placing market BUY");
        ordersPending = true; // <-- SET EARLY TO PREVENT DUPLICATES
        try {
          await placeMarketOrder("buy", atr);
          await trackOpenPosition();
          ordersPending = false;
          tradeCompletedAt = Date.now();
        } catch (err) {
          ordersPending = false; // rollback if failed
          console.error("❌ Failed to place BUY:", err.message);
        }
        return;
      } else if (price <= lowInvalidation) {
        console.log(
          "❌ Invalidated (price dropped 0.4% below low). Exiting...",
          price
        );
        return;
      }
    } else if (type === "bearish") {
      console.log("bearish but price is ->", price);
      if (price <= low) {
        console.log("✅ Breakdown! Placing market SELL");
        ordersPending = true;
        try {
          await placeMarketOrder("sell", atr);
          await trackOpenPosition();
          ordersPending = false;
          tradeCompletedAt = Date.now();
        } catch (err) {
          ordersPending = false;
          console.error("❌ Failed to place SELL:", err.message);
        }
        return;
      } else if (price >= highInvalidation) {
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

  while (true) {
    await delay(Math.floor(Math.random() * (3100 - 2500 + 1)) + 2400);
    if (!price || price == 0) {
      console.warn(
        "⚠️ Invalid price received, skipping this loop. Price:",
        price
      );
      continue; // don't run SL tightening with bad data
    }
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
        `📊 [${side.toUpperCase()}] Qty: ${posSize} | Entry: ${entryPrice} | Price: ${price} | PnL: ${unrealizedPnL}`
      );

      const profitThreshold = ATR * 1.5;
      const tightenSLDistance = ATR * 1.6;

      if (
        !slTightened &&
        unrealizedPnL > 0.1 &&
        price !== 0 &&
        ((side === "buy" && price >= entryPrice + profitThreshold) ||
          (side === "sell" && price <= entryPrice - profitThreshold))
      ) {
        console.warn(
          "🎯 Price reached profit threshold — tightening SL near entry",
          entryPrice,
          price,
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
          slSide
        );
        await binance.createOrder(
          SYMBOL,
          "STOP_MARKET",
          slSide,
          posSize,
          undefined,
          { stopPrice: tightenedSL.toFixed(2) }
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
        price !== 0 &&
        ((side === "buy" && price >= entryPrice + profitThreshold2) ||
          (side === "sell" && price <= entryPrice - profitThreshold2))
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
          { stopPrice: tightenedSL.toFixed(2) }
        );

        console.log("🔒 SL tightened near entry:", tightenedSL.toFixed(2));

        // Optional: deactivate further trailing
        slTightened2 = true;
        trailingActive = false;
      }

      const profitThreshold3 = ATR * 6;

      const newSL = side === "buy" ? price - ATR * 4.5 : price + ATR * 4.5;

      if (
        !slTightened3 &&
        unrealizedPnL > 0.1 &&
        ((side === "buy" && price >= entryPrice + profitThreshold3) ||
          (side === "sell" && price <= entryPrice - profitThreshold3))
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
          { stopPrice: newSL.toFixed(2) }
        );

        console.log("🔒 SL tightened near entry:", newSL.toFixed(2));

        // Optional: deactivate further trailing
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
        lastSLTriggerPrice = price;
        lastSLUpdateTime = Date.now();
        currentSLATRMultiplier = 3.7;

        const initialSL = side === "buy" ? price - ATR * 5 : price + ATR * 5;
        const slSide = side === "buy" ? "sell" : "buy";

        await binance.createOrder(
          SYMBOL,
          "STOP_MARKET",
          slSide,
          posSize,
          undefined,
          { stopPrice: initialSL.toFixed(2) }
        );

        console.log("🛡️ Initial trailing SL placed at:", initialSL.toFixed(2));

        slUpdated = true;
      }

      if (trailingActive) {
        const timeSinceLastUpdate = Date.now() - lastSLUpdateTime;
        const TRAIL_INTERVAL_MS = 90 * 60 * 1000; // 90 minutes

        const slSide = side === "buy" ? "sell" : "buy";
        const atrMultiplier = 4;

        if (timeSinceLastUpdate >= TRAIL_INTERVAL_MS) {
          if (
            (side === "buy" && price > lastSLTriggerPrice * 1.015) ||
            (side === "sell" && price < lastSLTriggerPrice * 0.985)
          ) {
            const newSL =
              side === "buy"
                ? price - ATR * atrMultiplier
                : price + ATR * atrMultiplier;

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
              { stopPrice: newSL.toFixed(2) }
            );

            lastSLTriggerPrice = price;
            lastSLUpdateTime = Date.now();
            console.log("🔁 Trailing SL moved to:", newSL.toFixed(2));
          } else {
            console.log("⏸ Price not improved — skip SL update");
          }
        }
      }
    } catch (err) {
      console.error("❌ Error in tracking loop:", err.message);
    }
  }
};

const placeMarketOrder = async (side, atr) => {
  // ===== Step 0: Prevent double entry =====
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
  if (weakness === true) {
    totalAmount = totalAmount / 1.5;
  }

  const amountTP1 = totalAmount * 0.55;
  const amountTP2 = totalAmount * 0.45;

  ATR = atr;
  const slMultiplier = 2.2;
  const tp1Multiplier = 8.5;

  const slSide = side === "buy" ? "sell" : "buy";
  const entryPrice = price;

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
      console.error("❌ SL placement failed:", err.message);
      console.warn("🚨 Closing position immediately!");
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

const getOrderPrices = async (type, lastCandle) => {
  console.log(" order already there2?", ordersPending);
  if (!ordersPending) {
    if (!lastCandle) {
      console.error("❌ No last candle data available");
      return { status: false, message: "No last candle data available" };
    }

    const high = lastCandle[2]; // High price
    const low = lastCandle[3]; // Low price
    const halfway = (high + low) / 2; // Mid price of the candle
    const percentMove = halfway * 0.012; // 0.8% move range

    // Define percentage step distribution (closer to halfway at first)
    const steps = [0.6, 0.8]; // First price closer, last price at full move
    let orderPrices = [];

    if (type === "bullish") {
      const lowerBound = halfway * 0.996 - percentMove;
      orderPrices = [halfway * 0.996 - percentMove * steps[0], lowerBound];

      console.log(`🟢 Bullish Order Prices from ${halfway} to ${lowerBound}`);
    } else if (type === "bearish") {
      const upperBound = halfway * 1.004 + percentMove;
      orderPrices = [halfway * 1.004 + percentMove * steps[0], upperBound];

      console.log(`🔴 Bearish Order Prices from ${halfway} to ${upperBound}`);
    } else {
      console.error("❌ Invalid type, must be 'bullish' or 'bearish'");
      return { status: false, message: "Invalid type" };
    }

    console.log("📌 Order Prices:", orderPrices);

    try {
      ordersPlaced = await placeLimitOrders(orderPrices, type, ATR);
      const positions = await binance.fetchPositions();
      const position = positions.find(
        (p) =>
          p.info.symbol === SYMBOL.replace("/", "") &&
          parseFloat(p.info.positionAmt) !== 0
      );
      if (!position) {
        console.log(" No open positions. confiremd");
      } else {
        console.log(" oh  Position open");
        await manageOpenPositions();
        firstBook = false;
        lastOrderExecuted = false;
        lastSlOrderExecuted = false;
        secondBook = false;
        finalBook = false;
        profitBooked = false;
        console.log("⏸ Pausing execution for 1 hour... 2");
        tradeCompletedAt = Date.now();

        return;
      }
      console.log("orderPlaced ->", ordersPlaced);
      const hasSuccessfulTrade = ordersPlaced.some(
        (order) => order.status === "OPEN"
      );

      if (hasSuccessfulTrade) {
        ordersPending = true;
        monitorOrderFilling();
      } else {
        console.log("❌ No trades were placed successfully.");
      }
    } catch (error) {
      console.error("❌ Error placing orders:", error);
    }
  } else {
    console.log(" Orders already pending");
  }
};

const placeLimitOrders = async (prices, type, atr) => {
  console.log("placing order with Atr ->", atr);
  ATR = atr;
  let amount = orderQuantity * multiple * 1.1; // Order quantity
  if (!isTrueTrend) {
    console.log("its true trend");
    amount = amount / 2;
  }

  let orderResults = [];
  const positions = await binance.fetchPositions();
  const position = positions.find(
    (p) =>
      p.info.symbol === SYMBOL.replace("/", "") &&
      parseFloat(p.info.positionAmt) !== 0
  );
  if (position) {
    console.log("⚠️  positions already opened. Stopping placing orders.");
    await manageOpenPositions();

    firstBook = false;
    lastOrderExecuted = false;
    lastSlOrderExecuted = false;
    secondBook = false;
    finalBook = false;
    profitBooked = false;
    console.log("⏸ Pausing execution for 1 hour... 3");
    tradeCompletedAt = Date.now();

    return;
  }
  try {
    for (let price of prices) {
      let slPrice;
      let side;
      let slSide;

      if (type === "bullish") {
        side = "buy";
        slSide = "sell"; // Opposite side for SL
        slPrice = price - ATR * 2.5; // SL = price - ATR for long
        console.log("Placing buy orders");
      } else {
        side = "sell";
        slSide = "buy"; // Opposite side for SL
        slPrice = price + ATR * 2.5; // SL = price + ATR for short
        console.log("Placing sell orders");
      }

      try {
        // Create Limit Order
        const order = await binance.createOrder(
          SYMBOL,
          "limit",
          side,
          amount,
          price,
          {
            timeInForce: "GTC", // Good Till Cancelled
            reduceOnly: false, // Not reducing a position, just opening it
          }
        );

        console.log(
          `✅ Limit Order Placed (${side.toUpperCase()}) at ${price} with SL at ${slPrice}:`
        );

        // Create Stop-Market Order for Stop Loss
        const stopLossOrder = await binance.createOrder(
          SYMBOL,
          "STOP_MARKET",
          slSide,
          amount,
          undefined,
          {
            stopPrice: slPrice,
          }
        );

        console.log(
          `🛑 Stop-Market Order Placed (${slSide.toUpperCase()}) at ${slPrice}`
        );

        orderResults.push({
          price,
          slPrice,
          side,
          stopLossSide: slSide,
          status: "OPEN",
          orderId: order.id,
          stopLossOrderId: stopLossOrder.id,
        });
      } catch (orderError) {
        console.error(`❌ Failed to place order at ${price}:`, orderError);
        orderResults.push({
          price,
          slPrice,
          side,
          status: "failed",
          error: orderError.message || orderError,
        });
      }
    }

    return orderResults;
  } catch (error) {
    console.error("❌ Error placing orders:", error);
  }
};
const monitorOrderFilling = async () => {
  console.log("📡 Monitoring Orders for Execution...");
  let anyOrderFilled = false;
  const orderStartTime = Date.now();
  const timeLimit = 80 * 60 * 1000;

  const isPositionOpen = async () => {
    const positions = await binance.fetchPositions();
    return positions.find(
      (p) =>
        p.info.symbol === SYMBOL.replace("/", "") &&
        parseFloat(p.info.positionAmt) !== 0
    );
  };

  const resetState = () => {
    firstBook = false;
    secondBook = false;
    finalBook = false;
    profitBooked = false;
    lastOrderExecuted = false;
    lastSlOrderExecuted = false;
  };

  const handlePause = async (label = "") => {
    console.log(`⏸ Pausing execution for 1 hour... ${label}`);
    await cancelAllOpenOrders();
    tradeCompletedAt = Date.now();
  };

  const position = await isPositionOpen();
  if (position) {
    console.log("⚠️  Position already opened. Stopping monitoring orders.");
    await manageOpenPositions();
    resetState();
    await handlePause("initial position");
    return;
  }

  let openOrders = await binance.fetchOpenOrders(SYMBOL);
  console.log("open order length ->", openOrders.length);

  while (openOrders.length > 0) {
    const randomDelay = Math.floor(Math.random() * 800) + 2000;
    await new Promise((resolve) => setTimeout(resolve, randomDelay));

    if (Date.now() - orderStartTime > timeLimit) {
      console.log("⏳ Time limit reached! Canceling all open orders...");
      await cancelAllOpenOrders();
      ordersPending = false;
      return;
    }

    const updatedOrders = [];

    for (const order of openOrders) {
      try {
        const orderStatus = await binance.fetchOrder(
          order.info.orderId,
          SYMBOL
        );
        const status = orderStatus.info?.status;

        if (status === "FILLED") {
          console.log(
            `🎯 Order FILLED: ${order.info.side.toUpperCase()} at ${
              order.info.price
            }`
          );
          anyOrderFilled = true;
        } else if (status === "CANCELED") {
          console.log(
            `❌ Order CANCELED: ${order.info.side.toUpperCase()} at ${
              order.info.price
            }`
          );
        } else {
          console.log(`⏳ Order still OPEN at ${order.info.price}...`);
          updatedOrders.push(order);
        }
      } catch (err) {
        console.error("❌ Error fetching order status:", err);
      }
    }

    openOrders = updatedOrders;

    if (anyOrderFilled) {
      await manageOpenPositions();
      resetState();
      await handlePause("filled-order");
    }
  }

  console.log("✅ Monitoring complete. All orders processed.");

  if (anyOrderFilled) {
    await manageOpenPositions();
    resetState();
    await handlePause("final pass");
  }
};

const alertStatus = {}; // Store alert status for different positions

// ✅ Refactored manageOpenPositions with full logic

async function manageOpenPositions() {
  console.log("📡 Monitoring Open Positions...");

  await ensureStopMarketExists();

  while (true) {
    const randomDelay = Math.floor(Math.random() * (3700 - 3000 + 1)) + 3000;
    await delay(randomDelay);

    try {
      const position = await getActivePosition();
      if (!position) {
        console.log("⚠️ No open positions. Stopping monitoring.");
        ordersPending = false;
        return;
      }

      console.log(" 📊  Pnl>", position?.info?.unRealizedProfit);
      console.log("price ->", price);

      let positionSize = parseFloat(position.info.positionAmt);
      console.log("position size ->", positionSize);
      let entryPrice = parseFloat(position.info.entryPrice);
      const side = positionSize > 0 ? "buy" : "sell";
      let amount = orderQuantity * multiple;
      console.log("IS TRUE TREND ->", isTrueTrend);
      if (!isTrueTrend) {
        amount = amount / 2;
      }
      console.log("amount ->", amount);

      if (
        Math.abs(positionSize) > amount * 1.99 &&
        (!lastOrderExecuted || !lastSlOrderExecuted) &&
        Math.abs(positionSize) < amount * 3.4
      ) {
        await handleAdditionalEntry(entryPrice, side, amount);
      }

      const risk = ATR * 2.5;
      const alertTrigger =
        side === "buy" ? entryPrice + risk * 2 : entryPrice - risk * 2;
      const finalExitTrigger =
        side === "buy" ? entryPrice + risk * 4.5 : entryPrice - risk * 4;

      console.log(
        ` 📊 Active Position: ${side.toUpperCase()} ${positionSize} at Avg Price ${entryPrice}`
      );
      console.log("finalExitTrigger -", finalExitTrigger);
      const positionKey = `${SYMBOL}_${entryPrice}`;

      if (!alertStatus[positionKey]) {
        alertStatus[positionKey] = {
          first: false,
          second: false,
          finalExit: false,
          trailingSlTriggered: false,
        };
      }

      if (
        (side === "buy" && price >= alertTrigger) ||
        (side === "sell" && price <= alertTrigger)
      ) {
        if (Math.abs(positionSize) > amount * 1.99 && !initialProfitBooked) {
          initialProfitBooked = true;
          await handleInitialProfit(positionSize, side);
        }

        await monitorAfterAlert(
          positionKey,
          entryPrice,
          side,
          risk,
          finalExitTrigger
        );
      }
    } catch (err) {
      console.error("❌ Error fetching position:", err);
      continue;
    }
  }
}

async function ensureStopMarketExists() {
  const openOrders = await binance.fetchOpenOrders(SYMBOL);
  const stopOrders = openOrders.filter(
    (order) => order.info.type === "STOP_MARKET"
  );

  if (stopOrders.length === 0) {
    const position = await getActivePosition();
    if (!position) return;
    const positionSize = parseFloat(position.info.positionAmt);
    const entryPrice = parseFloat(position.info.entryPrice);
    const side = positionSize > 0 ? "buy" : "sell";
    const stopPrice = side === "buy" ? entryPrice * 0.992 : entryPrice * 1.008;

    await binance.createOrder(
      SYMBOL,
      "STOP_MARKET",
      side === "buy" ? "sell" : "buy",
      Math.abs(positionSize),
      undefined,
      { stopPrice }
    );
    console.log("✅ Initial STOP_MARKET order created.");
  }
}

async function handleAdditionalEntry(entryPrice, side, amount) {
  const shouldTrigger =
    (side === "buy" && price > entryPrice * 1.003) ||
    (side === "sell" && price < entryPrice * 0.997);
  console.log(" in handleAdditionalEntr y ", price);
  if (!shouldTrigger) return;

  const slSide = side === "buy" ? "sell" : "buy";
  const slPrice = side === "buy" ? price - ATR * 2 : price + ATR * 2;

  try {
    if (!lastOrderExecuted) {
      await binance.createOrder(SYMBOL, "market", side, amount * 2);
      lastOrderExecuted = true;
      console.log(`✅ Additional market order placed (${side}) at ${price}`);
    }
    if (!lastSlOrderExecuted) {
      await binance.createOrder(
        SYMBOL,
        "STOP_MARKET",
        slSide,
        amount * 2,
        undefined,
        { stopPrice: slPrice }
      );
      lastSlOrderExecuted = true;
      console.log(`🛑 SL order placed (${slSide}) at ${slPrice}`);
    }
  } catch (error) {
    console.error("❌ Error placing additional entry or SL:", error);
  }
}

async function handleInitialProfit(positionSize, side) {
  if (!profitBooked) {
    await binance.createOrder(
      SYMBOL,
      "market",
      side === "buy" ? "sell" : "buy",
      Math.abs(positionSize) * 0.25
    );
    profitBooked = true;
    console.log("💰 Booked 25% profit at 1:2 RR.");
  }
  const updatedPosition = await getActivePosition();
  if (!updatedPosition) return;
  await updateStopLossOrders(
    parseFloat(updatedPosition.info.positionAmt),
    side
  );
}

async function monitorAfterAlert(
  positionKey,
  entryPrice,
  side,
  risk,
  finalExitTrigger
) {
  while (true) {
    await delay(Math.floor(Math.random() * (3900 - 3400 + 1)) + 3400);
    console.log("in monitor after alert");
    const updatedPosition = await getActivePosition();
    if (!updatedPosition) return;

    let positionSize = parseFloat(updatedPosition.info.positionAmt);
    let entryPrice = updatedPosition.info.entryPrice;

    if (
      (side === "buy" && price >= finalExitTrigger) ||
      (side === "sell" && price <= finalExitTrigger)
    ) {
      await binance.createOrder(
        SYMBOL,
        "market",
        side === "buy" ? "sell" : "buy",
        Math.abs(positionSize)
      );
      await cancelAllOpenOrders();
      delete alertStatus[positionKey];
      console.log("🏁 Final Trigger Hit. Position closed.");
      return;
    }

    console.log(
      ` 📊 Active Position: ${side.toUpperCase()} ${positionSize} at Avg Price ${entryPrice}`
    );
    console.log(" 📊  Pnl>", updatedPosition?.info?.unRealizedProfit);
    console.log("price ->", price);

    await handleTrailingStop(entryPrice, side, risk, positionSize, positionKey);
    await handleMultiStageProfitBooking(updatedPosition, side, positionKey);
  }
}

async function handleTrailingStop(
  entryPrice,
  side,
  risk,
  positionSize,
  positionKey
) {
  const trailingTrigger =
    side === "buy" ? entryPrice + risk * 2.1 : entryPrice - risk * 2.0;
  if (
    !alertStatus[positionKey].trailingSlTriggered &&
    ((side === "buy" && price >= trailingTrigger) ||
      (side === "sell" && price <= trailingTrigger))
  ) {
    const openOrders = await binance.fetchOpenOrders(SYMBOL);
    const stopOrders = openOrders.filter(
      (order) => order.info.type === "STOP_MARKET"
    );
    for (let order of stopOrders) {
      const oldSL = parseFloat(order.stopPrice);
      const initialDistance = Math.abs(entryPrice - oldSL);
      const stopMoveAmount = initialDistance * 0.4;
      const newSL =
        side === "buy" ? oldSL + stopMoveAmount : oldSL - stopMoveAmount;

      await binance.cancelOrder(order.id, SYMBOL);
      await binance.createOrder(
        SYMBOL,
        "STOP_MARKET",
        side === "buy" ? "sell" : "buy",
        Math.abs(positionSize),
        undefined,
        { stopPrice: newSL }
      );
      console.log(`🔄 SL Trailed from ${oldSL} → ${newSL}`);
    }

    alertStatus[positionKey].trailingSlTriggered = true;
  }
}

async function handleMultiStageProfitBooking(
  updatedPosition,
  side,
  positionKey
) {
  const { ohlcv, smallEma } = await fetchAndAnalyzeCandles("small");
  const last10 = ohlcv.slice(-10);
  const recentHigh = last10.reduce((sum, c) => sum + c[2], 0) / last10.length;
  const recentLow = last10.reduce((sum, c) => sum + c[3], 0) / last10.length;
  const positionSize = parseFloat(updatedPosition.info.positionAmt);

  if (
    !alertStatus[positionKey].first &&
    ((side === "buy" && price < smallEma) ||
      (side === "sell" && price > smallEma))
  ) {
    alertStatus[positionKey].first = true;
    console.log("⚠️ First EMA Break detected");
  }

  if (
    alertStatus[positionKey].first &&
    !firstBook &&
    ((side === "buy" && price >= recentHigh * 1.005) ||
      (side === "sell" && price <= recentLow * 0.995))
  ) {
    await binance.createOrder(
      SYMBOL,
      "market",
      side === "buy" ? "sell" : "buy",
      Math.abs(positionSize) * 0.3
    );
    firstBook = true;
    console.log("📈 Booked 30% profit after first retest");
    await updateStopLossOrders(positionSize, side);
  }

  if (
    !alertStatus[positionKey].second &&
    firstBook &&
    ((side === "buy" && price < smallEma) ||
      (side === "sell" && price > smallEma))
  ) {
    alertStatus[positionKey].second = true;
    console.log("⚠️ Second EMA Break detected");
  }

  if (
    alertStatus[positionKey].second &&
    !secondBook &&
    ((side === "buy" && price >= recentHigh * 1.015) ||
      (side === "sell" && price <= recentLow * 0.985))
  ) {
    await binance.createOrder(
      SYMBOL,
      "market",
      side === "buy" ? "sell" : "buy",
      Math.abs(positionSize) * 0.7
    );
    secondBook = true;
    console.log("📈 Booked 70% profit after second retest");
    await updateStopLossOrders(positionSize, side);
  }

  if (
    !alertStatus[positionKey].finalExit &&
    secondBook &&
    ((side === "buy" && price < smallEma) ||
      (side === "sell" && price > smallEma))
  ) {
    await binance.createOrder(
      SYMBOL,
      "market",
      side === "buy" ? "sell" : "buy",
      Math.abs(positionSize)
    );
    await cancelAllOpenOrders();
    delete alertStatus[positionKey];
    finalBook = true;
    console.log("🚨 Final Exit based on EMA. Position closed.");
  }
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

function calculateRSI20(closingPrices) {
  const period = 15; // RSI period

  if (closingPrices.length < period + 1) {
    throw new Error(
      `Need at least ${period + 1} closing prices to calculate RSI-20`
    );
  }

  // Get last 21 closing prices (to compute RSI-20)
  const prices = closingPrices.slice(-(period + 1));

  let gains = 0,
    losses = 0;

  // Calculate gains and losses over the last 20 periods
  for (let i = 1; i < prices.length; i++) {
    let change = prices[i] - prices[i - 1];

    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  // Compute average gain and loss
  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Avoid division by zero
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;

  // Compute RSI
  let RS = avgGain / avgLoss;
  let RSI = 100 - 100 / (1 + RS);

  return RSI.toFixed(2); // Return the latest RSI rounded to 2 decimal places
}

async function updateStopLossOrders(positionSize, side) {
  if (Math.abs(positionSize) <= 0) {
    console.log("🚨 No active position left. Skipping stop-loss update...");
    return;
  }

  const openOrders = await binance.fetchOpenOrders(SYMBOL);
  const stopOrders = openOrders.filter((order) => order.type === "stop_market");

  let totalQty = 0;
  let selectedOrders = [];

  // ✅ Loop through stop orders to accumulate enough to cover positionSize
  for (let order of stopOrders) {
    totalQty += parseFloat(order.amount);
    selectedOrders.push(order);

    if (totalQty >= Math.abs(positionSize)) {
      break; // ✅ Stop when enough orders are selected
    }
  }

  console.log(`🛑 Cancelling ${selectedOrders.length} stop orders...`);
  for (let order of selectedOrders) {
    await binance.cancelOrder(order.id, SYMBOL);
  }

  // ✅ Place a new stop-loss order based on the updated position
  if (selectedOrders.length > 0) {
    const stopLossPrice = parseFloat(
      selectedOrders[selectedOrders.length - 1].stopPrice
    );

    await binance.createOrder(
      SYMBOL,
      "STOP_MARKET",
      side === "buy" ? "sell" : "buy",
      Math.abs(positionSize),
      undefined,
      { stopPrice: stopLossPrice }
    );

    console.log(
      `✅ New STOP_MARKET order placed: ${positionSize} at ${stopLossPrice}`
    );
  }
}
