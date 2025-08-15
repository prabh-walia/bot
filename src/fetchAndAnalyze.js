import { binance } from "./binanceClient.js";
import { LIMIT } from "./config.js";
import { calculateEMA } from "./utils.js";
import { Status } from "./model.js";
import { getCurrentPrice } from "./websocket.js";

export let avgSwingHigh;
export let avgSwingLow;
export let Trend;

export const convertSymbol = (symbol) => {
  // Split the string at the position where "USDT" or any similar part starts
  const regex = /([a-zA-Z]+)(usdt)/i;
  const match = symbol.match(regex);

  if (match) {
    // Capitalize the first part and the second part (USDT)
    const firstPart = match[1].toUpperCase();
    const secondPart = match[2].toUpperCase();
    return `${firstPart}/${secondPart}`;
  } else {
    throw new Error("Invalid symbol format.");
  }
};
export const get2hEMA12 = async (SYMBOL) => {
  const candles = await binance.fetchOHLCV(SYMBOL, "4h", undefined, 100);

  const closes = candles.map((c) => c[4]);
  const ema12 = calculateEMA(closes, 15);

  const lastClosedIndex = closes.length - 2;
  const lastCandle = candles[lastClosedIndex];
  const avgPrice = (lastCandle[2] + lastCandle[3] + lastCandle[4]) / 3;
  const currentCandle = candles[closes.length - 1];
  return {
    avg: avgPrice,
    close: closes[lastClosedIndex], // Close of last completed 2h candle
    ema: ema12, // EMA at that candle
    last2hCandle: candles[lastClosedIndex], // Full candle [ts, open, high, low, close, volume]
    prev2hCandle: candles[lastClosedIndex - 1], // Previous one
    currentCandle: currentCandle,
  };
};

export const fetchAndAnalyzeCandles = async (size, symbol) => {
  try {
    const status = await Status.findOne();
    if (!status) throw new Error("Status not found");

    const HigherEMA = status.trendStatus?.higherEMA;
    const LowerEMA = status.trendStatus?.lowerEMA;

    const TIMEFRAME =
      size === "small"
        ? status.trendStatus?.smallTimeframe
        : status?.trendStatus?.sourceTimeframe;

    console.log(
      "TIMEFRAME",
      size === "small"
        ? status.trendStatus?.smallTimeframe
        : status?.trendStatus?.sourceTimeframe
    );

    const ohlcv = await binance.fetchOHLCV(symbol, TIMEFRAME, undefined, LIMIT);
    const closingPrices = ohlcv.map((entry) => entry[4]);
    const bigEma = calculateEMA(closingPrices, HigherEMA);
    const smallEma = calculateEMA(closingPrices, LowerEMA);

    // --- Corrected ATR Calculation ---

    const atr = calculateATR(ohlcv, 20);

    console.log("YS CURRENT PRICE IS THIS ->", getCurrentPrice());

    return { ohlcv, bigEma, smallEma, atr };
  } catch (error) {
    console.error("Error fetching and analyzing candles:", error);
  }
};
function calculateATR(ohlcv, length = 20) {
  const trs = [];

  for (let i = 1; i < ohlcv.length; i++) {
    const [, high, low, , close] = ohlcv[i];
    const prevClose = ohlcv[i - 1][4];
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trs.push(tr);
  }

  // RMA smoothing: rma = (prev * (len - 1) + current) / len
  let rmaAtr = trs.slice(0, length).reduce((sum, val) => sum + val, 0) / length;

  for (let i = length; i < trs.length; i++) {
    rmaAtr = (rmaAtr * (length - 1) + trs[i]) / length;
  }

  return rmaAtr;
}

export const fetchAndAnalyzeCandlesFortrend = async (SYMBOL) => {
  try {
    const status = await Status.findOne();
    if (!status) throw new Error("Status not found");

    const HigherEMA = status.trendStatus?.higherEMA;
    const LowerEMA = status.trendStatus?.lowerEMA;

    // Set timeframe based on `size`
    const TIMEFRAME = status.trendStatus?.TrendFrame;

    console.log("TIMEFRAME TREND", TIMEFRAME);
    const ohlcv = await binance.fetchOHLCV(SYMBOL, TIMEFRAME, undefined, LIMIT);
    const closingPrices = ohlcv.map((entry) => entry[4]);
    const bigEmas = calculateEMA(closingPrices, HigherEMA);
    const smallEmat = calculateEMA(closingPrices, LowerEMA);
    const latestCandle = ohlcv[ohlcv.length - 2];

    console.log("YS CURRENT PRICE IS THIS ->", getCurrentPrice());

    return { smallEmat, bigEmas, latestCandle };
  } catch (error) {
    console.error("Error fetching and analyzing candles:", error);
  }
};
const calculateAverage = (data) => {
  const sum = data.reduce((acc, value) => acc + value, 0);
  return sum / data.length;
};
export const checkDownTrend = async (ohlcv) => {
  const limit = 20; // Fetch more candles than needed to compare two periods

  if (ohlcv.length < 20) {
    console.log("Not enough data to analyze.");
    return;
  }

  // Extract closing prices for the last 20 candles and the previous 20 candles
  const last20ClosingPrices = ohlcv.slice(-15).map((candle) => candle[4]);
  const prev20ClosingPrices = ohlcv.slice(-30, -15).map((candle) => candle[4]);

  // Calculate average closing prices
  const avgLast20 = calculateAverage(last20ClosingPrices);
  const avgPrev20 = calculateAverage(prev20ClosingPrices);

  // Compare averages
  if (avgLast20 * 1.2 < avgPrev20) {
    console.log("down");
    return true;
  }
  return false;
};
export const checkUpTrend = async (ohlcv) => {
  const limit = 20; // Fetch more candles than needed to compare two periods

  if (ohlcv.length < 20) {
    console.log("Not enough data to analyze.");
    return;
  }

  // Extract closing prices for the last 20 candles and the previous 20 candles
  const last20ClosingPrices = ohlcv.slice(-15).map((candle) => candle[4]);
  const prev20ClosingPrices = ohlcv.slice(-30, -15).map((candle) => candle[4]);

  // Calculate average closing prices
  const avgLast20 = calculateAverage(last20ClosingPrices);
  const avgPrev20 = calculateAverage(prev20ClosingPrices);

  // Compare averages
  if (avgLast20 > avgPrev20 * 1.2) {
    console.log("uupside");
    return true;
  }
  return false;
};
const calculateAverageHighLow = (candles) => {
  const totalHigh = candles.reduce((acc, candle) => acc + candle[2], 0);
  const totalLow = candles.reduce((acc, candle) => acc + candle[3], 0);

  const averageHigh = totalHigh / candles.length;
  const averageLow = totalLow / candles.length;

  return { averageHigh, averageLow };
};

export const checkSidewaysTrend = async (ohlcv) => {
  const { averageHigh, averageLow } = calculateAverageHighLow(ohlcv.slice(-13));

  // Calculate the difference
  const difference = averageHigh - averageLow;

  const threshold = averageHigh * 0.016;

  return difference < threshold;
};
export const checkFrequentSideways = (ohlcv) => {
  const { averageHigh, averageLow } = calculateAverageHighLow(ohlcv.slice(-6));

  // Calculate the difference
  const difference = averageHigh - averageLow;

  // Calculate 0.6% of the average high
  const threshold = averageHigh * 0.0085;

  // Check if the difference is less than 0.6%
  return difference < threshold;
};
