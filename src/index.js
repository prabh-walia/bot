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
} from "./fetchAndAnalyze.js";
import { getRealTimePrice } from "./getPrice.js";
import {
  isBullishEngulfing,
  isBearishEngulfing,
  isBullishHammer,
  isBearishHammer,
  isInsideCandle,
  isBearishHaramiPattern,
  isBullishHaramiPattern,
} from "./patterns.js";
import { placeOrder, monitorOrders } from "./trade.js";
import { binance } from "./binanceClient.js";
import { Status } from "./model.js";
import { trade } from "./globalVariables.js";
import { price } from "./getPrice.js";
import { findTrend, trend } from "./trendFinder.js";
import {
  AMOUNT,
  FIXED_RISK_AMOUNT,
  LEVERAGE,
  BIGGER_TIMEFRAME,
} from "./config.js";
import {
  getQuantity,
  getSupportAndResistanceZones,
  validateTradeConditionBearish,
  validateTradeConditionBullish,
  findSwings,
  findPivotHighs,
  findPivotLows,
  checkBullishPatternAboveEma,
} from "./utils.js";

let high = null;
let low = null;
let ordersPending = false;
let error = 0;
let neutral = false;
let hasLoggedTradeTracking = false;
let tradeExecutionOpen = false;
let hasLoggedFindingTrades = false;
let patternFound = false;
let fallbackTradeActive = false;
let BullishValidated = false;
let BearishValidated = false;
let patterns = [];
let SYMBOL;
let orderQuantity;
let multiple;
let slPercentage;
let BullishPatternFound = false;
let BearishPatternFound = false;
let patternType;
let totalProfit = 0;
let totalLoss = 0;
let ordersPlaced = [];
let isBullishTrade = false;
let isBearishTrade = false;
let profitTrades = 0;
let totalTrades = 0;
let totalFees = 0;
let tradeCompletedAt = 0;

const getRandomDelay = () => Math.floor(Math.random() * (190 - 60 + 1)) + 100;

export const tracker = () => {
  if (trade == false) {
    if (!hasLoggedTradeTracking) {
      console.log(`Tracing trades :   ......`);
      hasLoggedTradeTracking = true;
    }

    if (BullishValidated) {
      let count = 0;
      count == 0 &&
        console.log(
          `pattern - bullish - ${BullishValidated} price = ${price} -H- ${high} -L- ${low}`
        );
      count++;

      if (price > high) {
        console.log("price crossed high +");
        isBullishTrade = true;
        BullishValidated = false;
        hasLoggedTradeTracking = false;
      } else if (price < low) {
        console.log("Price reversed");

        BullishValidated = false;
        tradeExecutionOpen = false;
        patternFound = false;
        hasLoggedTradeTracking = false;
        high = null;
        low = null;
      } else {
        hasLoggedTradeTracking = false;
      }
    } else if (BearishValidated) {
      let count = 0;
      count == 0 &&
        console.log(
          `pattern trade- bearish - ${BearishValidated}  price = ${price} -H- ${high} -L- ${low}`
        );
      count++;

      if (price < low) {
        console.log("price crossed low +");
        isBearishTrade = true;
        BearishValidated = false;
        hasLoggedTradeTracking = false;
      } else if (price > high) {
        console.log("Price reversed");

        BearishValidated = false;
        tradeExecutionOpen = false;
        hasLoggedTradeTracking = false;
        patternFound = false;
        high = null;
        low = null;
      } else {
        hasLoggedTradeTracking = false;
      }
    }
  }
};

const TradeExecutor = async (stopLossPrice, Ratio, patternType) => {
  console.log("inside trade executor");
  if (stopLossPrice == null || isNaN(stopLossPrice)) {
    throw new Error(
      `Invalid stopLossPrice: Stop loss price is required and must be a number. coming from trade exector sl->${stopLossPrice} `
    );
  }

  while (trade == false) {
    if (isBullishTrade) {
      console.log("Trade going to be executed .... buy");
      trade = true;
      const takeProfitPrice = price + Ratio * (price - stopLossPrice);
      console.log(
        `SL = ${stopLossPrice} TP = ${takeProfitPrice}  entry - ${price}`
      );
      const candleSizePercent = ((price - stopLossPrice) / price) * 100;
      let quantity = getQuantity(candleSizePercent);
      console.log("quantity ->", quantity);
      if (quantity != 0) {
        const { stopLossOrder, takeProfitOrder, currentPrice, tradeId } =
          await placeOrder(
            SYMBOL,
            "buy",
            quantity,
            stopLossPrice,
            takeProfitPrice,
            patternType
          );

        fallbackTradeActive = true;
        patterns.push(patternType);
        let outcome = await monitorOrders(
          SYMBOL,
          stopLossOrder.id,
          takeProfitOrder.id,
          price,
          stopLossPrice,
          "buy",
          quantity,
          tradeId,
          patternType
        );

        totalTrades++;
        if (outcome[0] === "profit") {
          tradeCompletedAt = Date.now();
          console.log(
            ` profit -price ->${currentPrice} ${typeof currentPrice}  outcome1- ${
              outcome[1]
            }  ${typeof outcome[1]}`
          );
          let profit = quantity * (outcome[1] - currentPrice);
          profitTrades++;
          totalProfit += profit;
          let fees = quantity * (0.1 / 100);
          totalFees += fees * currentPrice;
        } else {
          console.log(
            ` loss -price ->${currentPrice} ${typeof currentPrice}  outcome1- ${
              outcome[1]
            }  ${typeof outcome[1]}`
          );
          let loss = quantity * (currentPrice - outcome[1]);
          totalLoss += loss;
          let fees = quantity * (0.1 / 100);
          totalFees += fees * currentPrice;
        }
      }

      trade = false;
      high = null;
      low = null;
      isBullishTrade = false;
      tradeExecutionOpen = false;
      BullishValidated = false;
      BullishPatternFound = false;
      fallbackTradeActive = false;
    }
    if (isBearishTrade) {
      console.log("Trade going to be executed .... sell");
      trade = true;
      const takeProfitPrice = price - Ratio * (stopLossPrice - price);
      console.log(
        `SL = ${stopLossPrice} TP = ${takeProfitPrice} entry ${price}`
      );
      const candleSizePercent = ((stopLossPrice - price) / price) * 100;
      let quantity = getQuantity(candleSizePercent);
      console.log("quantity ->", quantity);

      if (quantity != 0) {
        const { stopLossOrder, takeProfitOrder, currentPrice, tradeId } =
          await placeOrder(
            SYMBOL,
            "sell",
            quantity,
            stopLossPrice,
            takeProfitPrice,
            patternType
          );

        fallbackTradeActive = true;
        patterns.push(patternType);
        let outcome = await monitorOrders(
          SYMBOL,
          stopLossOrder.id,
          takeProfitOrder.id,
          price,
          high,
          "sell",
          quantity,
          tradeId,
          patternType
        );
        totalTrades++;

        if (outcome[0] === "profit") {
          tradeCompletedAt = Date.now();
          console.log(
            `profit -price ->${currentPrice} ${typeof currentPrice}  outcome1- ${
              outcome[1]
            }  ${typeof outcome[1]}`
          );
          let profit = quantity * (currentPrice - outcome[1]);
          profitTrades++;
          totalProfit += profit;
          let fees = quantity * (0.1 / 100);
          totalFees += fees * currentPrice;
        } else {
          console.log(
            `loss price ->${currentPrice} ${typeof currentPrice} outcome1- ${
              outcome[1]
            } ${typeof outcome[1]}`
          );
          let loss = quantity * (outcome[1] - currentPrice);
          totalLoss += loss;
          let fees = quantity * (0.1 / 100);
          totalFees += fees * currentPrice;
        }
      }

      BearishPatternFound = false;
      fallbackTradeActive = false;

      high = null;
      low = null;
      tradeExecutionOpen = false;
      trade = false;
      BearishValidated = false;
      isBearishTrade = false;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

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

      if (Date.now() - tradeCompletedAt < 100 * 60 * 1000) {
        console.log("Within the 10-minute cooldown period, waiting...");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      const fetchInterval = getRandomDelay();
      console.log("Price fetched:", price);

      console.log("Fetching and analyzing candles...");

      await new Promise((resolve) => setTimeout(resolve, fetchInterval));
      const { ohlcv, bigEma, smallEma } = await fetchAndAnalyzeCandles("big");

      console.log("Candles fetched and analyzed.");

      const lastCandle = ohlcv[ohlcv.length - 2];
      console.log("last candle -", ohlcv[ohlcv.length - 2]);
      const prevCandle = ohlcv[ohlcv.length - 3];
      const secondLastCandle = ohlcv[ohlcv.length - 4];
      const leftLen = 10;
      const rightLen = 10;

      const highs = ohlcv.map((candle) => candle[2]); // Extract highs
      const lows = ohlcv.map((candle) => candle[3]); // Extract lows
      const pivotHighs = findPivotHighs(highs, leftLen, rightLen);
      const pivotLows = findPivotLows(lows, leftLen, rightLen);
      const last2PivotHighs = pivotHighs.slice(-2);
      const last2PivotLows = pivotLows.slice(-2);

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

      // const priceWithinRange =
      //   price >= bigEma * 0.962 && price <= bigEma * 1.038;
      // const priceWithinRange2 =
      //   price >= bigEma * 0.98 && price <= bigEma * 1.02;
      console.log("Trend ->", trend);

      if (trend === "bullish") {
        const result = checkLastCandle(lastCandle, smallEma);

        if (result.isBullish && result.isAboveEMA) {
          console.log("last candle is bullish and above EMA");
          goToSmallerFrame("bullish");
        } else if (result.isBullish) {
          console.log("last candle is not bullish or not above");
          getOrderPrices("bullish", lastCandle);
        } else {
          console.log("last candle is not bullish");
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
        console.log(`p-${patternFound},t-${tradeExecutionOpen}`);
        if (patternFound && tradeExecutionOpen == false) {
          console.log(" going to run trade executer");
          tradeExecutionOpen = true;
          if (stopLossPrice) {
            TradeExecutor(stopLossPrice, ratio, patternType);
          } else {
            tradeExecutionOpen = false;
          }
        }
      } else if (trend == "bearish") {
        const result = checkLastCandle(lastCandle, smallEma);
        if (result.isBearish && result.isBelowEMA) {
          console.log("last candle is beairhs and below EMA");
          goToSmallerFrame("bearish");
        } else if (result.isBearish) {
          console.log("last candle is not bearish or not below");
          getOrderPrices("bearish", lastCandle);
        } else {
          console.log("last candle is not beairhs");
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

        if (patternFound && tradeExecutionOpen == false) {
          tradeExecutionOpen = true;
          if (stopLossPrice) {
            TradeExecutor(stopLossPrice, ratio, patternType);
          } else {
            tradeExecutionOpen = false;
          }
        }
      } else {
        if (checkUpTrend(ohlcv_B) || checkFrequentSideways(ohlcv_B)) {
          trend = "bullish";
        } else if (checkDownTrend(ohlcv_B)) {
          trend = "bearish";
        }
      }

      console.log(`profit ${totalProfit - totalLoss} `);
      console.log(`loss ${totalLoss} `);
      console.log("total trades -", totalTrades);
      console.log("total profitable trades -", profitTrades);
      console.log("Total fees ->", totalFees);
      console.log("errorZ - ", error);
      patterns.map((pattern) => console.log("patterns ->", pattern));
    } catch (error) {
      error += error;
      console.error("Error tracking real-time price:", error);
      console.log("errorZ - ", error);
    }
  }
};
const MIN_ORDER_QUANTITY = {
  "SOL/USDT": 1,
  "LTC/USDT": 0.17,
  "XRP/USDT": 3,
  "SUI/USDT": 3,
};
const SL_PERCENTAGE = {
  "1h": 0.014,
  "30m": 0.007,
  "2h": 0.02,
  "4h": 0.03,
};

const main = async () => {
  try {
    const status = await Status.findOne();

    SYMBOL = convertSymbol(status.symbol);
    multiple = status.orderMultiple;

    console.log("symbol is ->", SYMBOL);
    orderQuantity = MIN_ORDER_QUANTITY[SYMBOL] || 1;
    const timeframe = status.trendStatus?.sourceTimeframe;
    slPercentage = SL_PERCENTAGE[timeframe] || 0.014;

    console.log("minimum Quantity->", orderQuantity);
    console.log("multiple ->", multiple);
    if (!status) {
      console.log("Status document not found!");
      return;
    }
    if (status.botStatus.isRunning) {
      getRealTimePrice();
      await findTrend();
      console.log("trend ->", trend);
      await findTrades();

      console.log("");
      // try {
      //   const order = await binance.createOrder(
      //     SYMBOL,
      //     "limit",
      //     "buy",
      //     2,
      //     18.34,
      //     {
      //       stopLimitPrice: 18.3,

      //       stopLimitTimeInForce: "FOK", // Good Till Cancelled
      //       reduceOnly: false, // Not reducing a position, just opening it
      //     }
      //   );
      //   console.log(`✅ Limit Order Placed `, order);
      // } catch (err) {
      //   console.log("err", err);
      // }
    } else {
      console.log("Bot is not running. Skipping real-time price fetching.");
    }
  } catch (error) {
    console.error("Error in main function:", error);
  }
};
main();

function checkLastCandle(candle, ema) {
  const open = candle[1];
  const close = candle[4];

  const isBullish = close > open;
  const isBearish = close < open;

  let isAboveEMA = null;
  let isBelowEMA = null;

  if (isBullish) {
    isAboveEMA = close >= ema;
  } else if (isBearish) {
    isBelowEMA = close <= ema;
  }

  return { isBullish, isBearish, isAboveEMA, isBelowEMA };
}

const goToSmallerFrame = async (type) => {
  console.log(" order already there?1", ordersPending);
  if (!ordersPending) {
    const { ohlcv, bigEma, smallEma } = await fetchAndAnalyzeCandles("small");

    if (!ohlcv || ohlcv.length === 0) {
      console.error("No OHLCV data available");
      return;
    }

    const lastCandle = ohlcv[ohlcv.length - 2]; // Get last candle
    console.log("Last Candle:", lastCandle);

    const open = lastCandle[1];
    const close = lastCandle[4];
    const percentMove = close * 0.01; // 0.6% move range

    const steps = [0.3, 0.7];
    let orderPrices = [];

    if (type === "bullish") {
      if (close < open) {
        // Bearish candle found
        const lowerBound = close - percentMove;
        orderPrices = [
          close - percentMove * steps[0],
          close - percentMove * steps[1],
          lowerBound,
        ];
        console.log(`🔴 Bearish Zone from ${close} to ${lowerBound}`);
      } else {
        console.log("Last candle is not red, no zone printed.");
        return;
      }
    } else {
      if (close > open) {
        // Bullish candle found
        const upperBound = close + percentMove;
        orderPrices = [
          close + percentMove * steps[0],
          close + percentMove * steps[1],
          upperBound,
        ];
        console.log(`🟢 Bullish Zone from ${close} to ${upperBound}`);
      } else {
        console.log("Last candle is neutral, no zone printed.");
        return;
      }
    }

    console.log("Order Prices:", orderPrices);

    try {
      ordersPlaced = await placeLimitOrders(orderPrices, type);

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
    console.log("orders already pending");
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
    const steps = [0.4, 0.8]; // First price closer, last price at full move
    let orderPrices = [];

    if (type === "bullish") {
      const lowerBound = halfway - percentMove;
      orderPrices = [halfway - percentMove * steps[0], lowerBound];

      console.log(`🟢 Bullish Order Prices from ${halfway} to ${lowerBound}`);
    } else if (type === "bearish") {
      const upperBound = halfway + percentMove;
      orderPrices = [halfway + percentMove * steps[0], upperBound];

      console.log(`🔴 Bearish Order Prices from ${halfway} to ${upperBound}`);
    } else {
      console.error("❌ Invalid type, must be 'bullish' or 'bearish'");
      return { status: false, message: "Invalid type" };
    }

    console.log("📌 Order Prices:", orderPrices);

    try {
      ordersPlaced = await placeLimitOrders(orderPrices, type);

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

const placeLimitOrders = async (prices, type) => {
  const amount = orderQuantity * multiple * 1.1; // Order quantity
  const stopLossPercentage = slPercentage;
  let orderResults = [];

  try {
    for (let price of prices) {
      let slPrice;
      let side;
      let slSide;

      if (type === "bullish") {
        side = "buy";
        slSide = "sell"; // Stop-market order should be the opposite
        slPrice = price * (1 - stopLossPercentage); // SL 0.5% below entry price
        console.log("Placing buy orders");
      } else {
        side = "sell";
        slSide = "buy"; // Stop-market order should be the opposite
        slPrice = price * (1 + stopLossPercentage); // SL 0.5% above entry price
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

  while (ordersPlaced.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 2050)); // Poll every 2 sec

    for (let order of ordersPlaced) {
      if (order.status === "OPEN") {
        try {
          const orderStatus = await binance.fetchOrder(order.orderId, SYMBOL);

          if (orderStatus.info?.status === "FILLED") {
            console.log(
              `🎯 Order FILLED: ${order.side.toUpperCase()} at ${order.price}`
            );
            order.status = "FILLED"; // Mark order as filled
            anyOrderFilled = true;
          } else if (orderStatus.info.status === "CANCELED") {
            console.log(
              `❌ Order CANCELED: ${order.side.toUpperCase()} at ${order.price}`
            );
            order.status = "CANCELED"; // Mark order as canceled
          } else {
            console.log(`⏳ Order still OPEN at ${order.price}...`);
          }
        } catch (err) {
          console.error("❌ Error fetching order status:", err);
        }
      }
    }

    // 🛑 Remove FILLED and CANCELED orders from the array to prevent infinite loops
    ordersPlaced = ordersPlaced.filter((order) => order.status === "OPEN");

    // ✅ If any order was filled, start monitoring positions immediately
    if (anyOrderFilled) {
      await manageOpenPositions();
      anyOrderFilled = false; // Reset flag to avoid unnecessary re-calls
    }
  }

  console.log("✅ Monitoring complete. All orders processed.");

  // ✅ Ensure `manageOpenPositions()` runs one last time if at least one order was filled
  if (anyOrderFilled) {
    await manageOpenPositions();
  }
};

const alertStatus = {}; // Store alert status for different positions

const manageOpenPositions = async () => {
  console.log("📡 Monitoring Open Positions...");

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 2090)); // Poll every 2 sec

    try {
      // 🔹 Fetch open positions from Binance
      const positions = await binance.fetchPositions();
      const position = positions.find(
        (p) =>
          p.info.symbol === SYMBOL.replace("/", "") &&
          parseFloat(p.info.positionAmt) !== 0
      );
      console.log("position>", position);
      if (!position) {
        console.log("⚠️ No open positions. Stopping monitoring.");
        ordersPending = false;
        return; // Exit function if no positions are open
      }

      const positionSize = parseFloat(position?.info.positionAmt);
      const entryPrice = parseFloat(position.info.entryPrice);

      console.log("entry price ->", position.info.entryPrice);
      const side = positionSize > 0 ? "buy" : "sell";
      console.log(
        `📊 Active Position: ${side.toUpperCase()} ${positionSize} at Avg Price ${entryPrice}`
      );

      const risk = entryPrice * 0.015;
      const alertTrigger =
        side === "buy" ? entryPrice + risk * 1.5 : entryPrice - risk * 1.5;
      const finalExitTrigger =
        side === "buy" ? entryPrice + risk * 7 : entryPrice - risk * 7;
      const positionKey = `${SYMBOL}_${entryPrice}`; // Unique key for position tracking

      if (!alertStatus[positionKey]) {
        alertStatus[positionKey] = {
          first: false,
          second: false,
          finalExit: false,
        };
      }

      if (
        (price >= finalExitTrigger && side === "buy") ||
        (price <= finalExitTrigger && side === "sell")
      ) {
        console.log("🏆 Price hit 1:7 Risk-Reward! Closing entire position...");
        await binance.createOrder(
          SYMBOL,
          "market",
          side === "buy" ? "sell" : "buy",
          positionSize
        );
        await cancelAllOpenOrders();
        delete alertStatus[positionKey];
        return;
      }

      if (
        (side === "buy" && price >= alertTrigger) ||
        (side === "sell" && price <= alertTrigger)
      ) {
        console.log("🚀 Alert System Activated: Tracking 12 EMA for exits...");
        while (true) {
          await new Promise((resolve) => setTimeout(resolve, 3070));
          const { ohlcv, bigEma, smallEma } = await fetchAndAnalyzeCandles(
            "small"
          );
          const last10Candles = ohlcv.slice(-10); // Get last 10 candles
          const highs = last10Candles.map((candle) => candle[2]); // Extract high prices
          const lows = last10Candles.map((candle) => candle[3]); // Extract low prices

          const avgHigh =
            highs.reduce((sum, val) => sum + val, 0) / highs.length; // Average high
          const avgLow = lows.reduce((sum, val) => sum + val, 0) / lows.length; // Average low

          const recentHigh = avgHigh;
          const recentLow = avgLow;

          if (
            !alertStatus[positionKey].first &&
            ((side === "buy" && price < smallEma) ||
              (side === "sell" && price > smallEma))
          ) {
            console.log(
              "⚠️ First Alert Triggered! Waiting for price to retest..."
            );
            alertStatus[positionKey].first = true;
          }

          if (
            alertStatus[positionKey].first &&
            ((side === "buy" && price >= recentHigh * 0.99) ||
              (side === "sell" && price <= recentLow * 1.01))
          ) {
            console.log("📈 Booking 30% Profit at near recent level...");
            await binance.createOrder(
              SYMBOL,
              "market",
              side === "buy" ? "sell" : "buy",
              positionSize * 0.3
            );
          }

          if (
            !alertStatus[positionKey].second &&
            alertStatus[positionKey].first &&
            ((side === "buy" && price < smallEma) ||
              (side === "sell" && price > smallEma))
          ) {
            console.log(
              "⚠️ Second Alert Triggered! Waiting for price to retest previous level..."
            );
            alertStatus[positionKey].second = true;
          }

          if (
            alertStatus[positionKey].second &&
            ((side === "buy" && price >= recentHigh * 0.95) ||
              (side === "sell" && price <= recentLow * 1.05))
          ) {
            console.log("📈 Booking 40% Profit at near previous level...");
            await binance.createOrder(
              SYMBOL,
              "market",
              side === "buy" ? "sell" : "buy",
              positionSize * 0.4
            );
          }

          if (
            !alertStatus[positionKey].finalExit &&
            alertStatus[positionKey].second &&
            ((side === "buy" && price < smallEma) ||
              (side === "sell" && price > smallEma))
          ) {
            console.log("🚨 Final Alert! Closing remaining position...");
            await binance.createOrder(
              SYMBOL,
              "market",
              side === "buy" ? "sell" : "buy",
              positionSize * 0.3
            );
            await cancelAllOpenOrders();
            delete alertStatus[positionKey]; // Clean up after closing position
            return;
          }
        }
      }
    } catch (err) {
      console.error("❌ Error fetching position:", err);
      continue; // ⚠️ Continue the loop even if an error occurs
    }
  }
  console.log("✅ Position monitoring complete.");
};

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
          .cancelOrder(order.id, SYMBOL)
          .then(() =>
            console.log(
              `❌ Cancelled Order ${order.id} at ${order.price} for ${SYMBOL}`
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
