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
} from "./fetchAndAnalyze.js";
let trend;
import { findTrend } from "./trendFinder.js";
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
let firstBook = false;
let secondBook = false;
let finalBook = false;
let hasLoggedFindingTrades = false;
let patternFound = false;
let fallbackTradeActive = false;
let BullishValidated = false;
let BearishValidated = false;
let patterns = [];
let profitBooked = false;
let SYMBOL;
let orderQuantity;
let multiple;
let lastOrderExecuted = false;
let lastSlOrderExecuted = false;
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
        console.log("Within the 100-minute cooldown period, waiting...");
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

      const { smallEmat } = await fetchAndAnalyzeCandlesFortrend();
      if (price > smallEmat * 1.008) {
        console.log("price is above ema");
        trend = "bullish";
      } else if (price < smallEmat * 0.994) {
        console.log("price is below ema");
        trend = "bearish";
      } else {
        trend = await findTrend();
      }
      console.log("trend ->", trend);
      console.log("Trend ->", trend);

      if (trend === "bullish") {
        const result = checkLastCandle(lastCandle, smallEma);

        if (result.isBullish && result.isAboveEMA) {
          console.log("last candle is bullish and above EMA");
          const closingPrices = ohlcv.map((candle) => candle[4]);
          const latestRSI20 = calculateRSI20(closingPrices);

          if (latestRSI20 < 80) {
            goToSmallerFrame("bullish");
          } else {
            console.log("❌ RSI is not below 80. No order placement.");
          }
        } else if (result.isBullish) {
          console.log("last candle is not bullish or not above");
          const closingPrices = ohlcv.map((candle) => candle[4]);
          const latestRSI20 = calculateRSI20(closingPrices);

          console.log(`📊 Latest RSI-20: ${latestRSI20}`);

          if (latestRSI20 < 40) {
            getOrderPrices("bullish", lastCandle);
          } else {
            console.log("❌ RSI is not below 40. No order placement.");
          }
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
      } else if (trend == "bearish") {
        const result = checkLastCandle(lastCandle, smallEma);
        if (result.isBearish && result.isBelowEMA) {
          const closingPrices = ohlcv.map((candle) => candle[4]);
          console.log("last candle is beairhs and below EMA");
          const latestRSI20 = calculateRSI20(closingPrices);
          if (latestRSI20 > 25) {
            goToSmallerFrame("bearish");
            console.log("returned from smaller frame");
          } else {
            console.log("rsi is not above 25");
          }
        } else if (result.isBearish) {
          console.log("last candle is not bearish or not below");
          const closingPrices = ohlcv.map((candle) => candle[4]);
          const latestRSI20 = calculateRSI20(closingPrices);
          console.log("rsi ->", latestRSI20);
          if (latestRSI20 > 53) {
            getOrderPrices("bearish", lastCandle);

            console.log("returned from get order prices");
          } else {
            console.log("rsi is not above 60");
          }
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
      } else {
        console.log("market ranged");
      }

      console.log("errorZ - ", error);
    } catch (error) {
      error += error;
      console.error("Error tracking real-time price:", error);
      console.log("errorZ - ", error);
    }
  }
};
const MIN_ORDER_QUANTITY = {
  "SOL/USDT": 1,
  "LTC/USDT": 0.16,
  "XRP/USDT": 5,
  "SUI/USDT": 3,
};
const SL_PERCENTAGE = {
  "1h": 0.01,
  "30m": 0.007,
  "2h": 0.01,
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

      const positions = await binance.fetchPositions();
      const position = positions.find(
        (p) =>
          p.info.symbol === SYMBOL.replace("/", "") &&
          parseFloat(p.info.positionAmt) !== 0
      );

      if (!position) {
        await findTrades();
      } else {
        await manageOpenPositions();
        lastOrderExecuted = false;
        lastSlOrderExecuted = false;
        firstBook = false;
        secondBook = false;
        finalBook = false;
        profitBooked = false;
        console.log("⏸ Pausing execution for 1 hour... 1");
        await cancelAllOpenOrders();
        tradeCompletedAt = Date.now();


      }
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
    const percentMove = close * 0.012; // 0.6% move range

    const steps = [0.4, 0.7];
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

      const hasSuccessfulTrade = ordersPlaced?.some(
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
    const percentMove = halfway * 0.013; // 0.8% move range

    // Define percentage step distribution (closer to halfway at first)
    const steps = [0.6, 0.8]; // First price closer, last price at full move
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

const placeLimitOrders = async (prices, type) => {
  const amount = orderQuantity * multiple * 1.1; // Order quantity
  const stopLossPercentage = slPercentage;
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
  const orderStartTime = Date.now();
  const timeLimit = 100 * 60 * 1000;
  const positions = await binance.fetchPositions();
  const position = positions.find(
    (p) =>
      p.info.symbol === SYMBOL.replace("/", "") &&
      parseFloat(p.info.positionAmt) !== 0
  );
  if (position) {
    console.log("⚠️  positions already opened. Stopping monitoring orders.");
    await manageOpenPositions();

    firstBook = false;
    lastOrderExecuted = false;
    lastSlOrderExecuted = false;
    secondBook = false;
    finalBook = false;
    profitBooked = false;
    console.log("⏸ Pausing execution for 1 hour... 7");
    await cancelAllOpenOrders();
    tradeCompletedAt = Date.now();

    return;
  }
  let openOrders = await binance.fetchOpenOrders(SYMBOL);

  console.log("open order length ->", openOrders.length);
  while (openOrders.length > 0) {
    const randomDelay = Math.floor(Math.random() * (2800 - 2000 + 1)) + 2000;
    await new Promise((resolve) => setTimeout(resolve, randomDelay)); // Poll every 2 sec
    const currentTime = Date.now();
    if (currentTime - orderStartTime > timeLimit) {
      console.log("⏳ Time limit reached! Canceling all open orders...");
      await cancelAllOpenOrders();
      ordersPending = false;
      return;
    }

    let updatedOrders = []; // ✅ Create a new array to store active orders

    for (let order of openOrders) {
      try {
        const orderStatus = await binance.fetchOrder(
          order.info.orderId,
          SYMBOL
        );
        if (orderStatus.info?.status === "FILLED") {
          console.log(
            `🎯 Order FILLED: ${order.info.side.toUpperCase()} at ${
              order.info.price
            }`
          );
          anyOrderFilled = true;
        } else if (orderStatus.info?.status === "CANCELED") {
          console.log(
            `❌ Order CANCELED: ${order.info.side.toUpperCase()} at ${
              order.info.price
            }`
          );
        } else {
          console.log(`⏳ Order still OPEN at ${order.info.price}...`);
          updatedOrders.push(order); // ✅ Only keep orders that are still open
        }
      } catch (err) {
        console.error("❌ Error fetching order status:", err);
      }
    }

    openOrders = updatedOrders; // ✅ Replace old orders with updated list

    if (anyOrderFilled) {
      await manageOpenPositions();

      lastOrderExecuted = false;
      lastSlOrderExecuted = false;
      anyOrderFilled = false;
      firstBook = false;
      secondBook = false;
      finalBook = false;
      profitBooked = false;
      console.log("⏸ Pausing execution for 1 hour... 4");
      await cancelAllOpenOrders();
      tradeCompletedAt = Date.now();


  
    }
  }

  console.log("✅ Monitoring complete. All orders processed.");
  if (anyOrderFilled) {
    await manageOpenPositions();
    firstBook = false;
    secondBook = false;
    lastOrderExecuted = false;
    lastSlOrderExecuted = false;
    finalBook = false;
    profitBooked = false;
    console.log("⏸ Pausing execution for 1 hour... 5");
    await cancelAllOpenOrders();
    tradeCompletedAt = Date.now();


  }
};

const alertStatus = {}; // Store alert status for different positions

const manageOpenPositions = async () => {
  console.log("📡 Monitoring Open Positions...");
  let openOrders = await binance.fetchOpenOrders(SYMBOL);
  const stopOrders = openOrders.filter(
    (order) => order.info.type === "STOP_MARKET"
  );

  if (stopOrders.length > 0) {
    console.log("STOP_MARKET order already exists. No action needed.");
  } else {
    console.log("No STOP_MARKET order found. Creating a new one...");
    const positions = await binance.fetchPositions();
    const position = positions.find(
      (p) =>
        p.info.symbol === SYMBOL.replace("/", "") &&
        parseFloat(p.info.positionAmt) !== 0
    );
    if (!position) {
      console.log("⚠️ No open positions. Stopping monitoring.");
      ordersPending = false;
      return; // Exit function if no positions are open
    }
    let positionSize = parseFloat(position?.info.positionAmt);
    let entryPrice = parseFloat(position.info.entryPrice);

    const side = positionSize > 0 ? "buy" : "sell";

    let stopPrice = side === "buy" ? entryPrice * 0.988 : entryPrice * 1.013;
    console.log("positionn sizee->", positionSize);
    // Ensure correct price precision
    stopPrice = parseFloat(stopPrice);
    console.log("posiitionsze->", positionSize);
    await binance.createOrder(
      SYMBOL,
      "STOP_MARKET",
      side === "buy" ? "sell" : "buy",
      Math.abs(positionSize),
      undefined,
      {
        stopPrice: stopPrice,
      }
    );

    console.log("STOP_MARKET order created successfully.");
  }

  while (true) {
    const randomDelay = Math.floor(Math.random() * (3700 - 3000 + 1)) + 3000;
    await new Promise((resolve) => setTimeout(resolve, randomDelay));

    try {
      // 🔹 Fetch open positions from Binance
      const positions = await binance.fetchPositions();
      const position = positions.find(
        (p) =>
          p.info.symbol === SYMBOL.replace("/", "") &&
          parseFloat(p.info.positionAmt) !== 0
      );
      if (!position) {
        console.log("⚠️ No open positions. Stopping monitoring.");
        ordersPending = false;
        return; // Exit function if no positions are open
      }
      console.log(" 📊  Pnl>", position.info.unRealizedProfit);
      console.log("   price ->", position.info.markPrice);

      let positionSize = parseFloat(position?.info.positionAmt);
      let entryPrice = parseFloat(position.info.entryPrice);

      let side = positionSize > 0 ? "buy" : "sell";
      const amount = orderQuantity * multiple;
      if (
        Math.abs(positionSize) > amount * 1.99 &&
        (!lastOrderExecuted || !lastSlOrderExecuted)
      ) {
        if (
          (side === "buy" && price > entryPrice * 1.003) ||
          (side === "sell" && price < entryPrice * 0.997)
        ) {
          let stopLossPercentage = slPercentage;
          let slSide;
          let slPrice;
          if (side === "buy") {
       
            slSide = "sell"; // Stop-market order should be the opposite
            slPrice = price * (1 - stopLossPercentage); // SL 0.5% below entry price
          } else {
           
            slSide = "buy"; // Stop-market order should be the opposite
            slPrice = price * (1 + stopLossPercentage); // SL 0.5% above entry price
          }
          console.log("adding additional quantity");
          try {
            if (!lastOrderExecuted) {
              // Create Limit Order
              const order = await binance.createOrder(
                SYMBOL,
                "market",
                side,
                amount * 2,

                undefined
              );

              console.log(
                `✅ market Order Placed (${side.toUpperCase()}) at ${price} with SL at ${slPrice}:`
              );

              lastOrderExecuted = true;
            }
            // Create Stop-Market Order for Stop Loss
            if (!lastSlOrderExecuted) {
              const stopLossOrder = await binance.createOrder(
                SYMBOL,
                "STOP_MARKET",
                slSide,
                amount * 2,
                undefined,
                {
                  stopPrice: slPrice,
                }
              );

              console.log(
                `🛑 Stop-Market Order Placed (${slSide.toUpperCase()}) at ${slPrice}`
              );

              lastSlOrderExecuted = true;
            }
          } catch (orderError) {
            console.error(`❌ Failed to place order at ${price}:`, orderError);
            continue;
          }
        }
      }
      console.log(
        `📊 Active Position: ${side.toUpperCase()} ${positionSize} at Avg Price ${entryPrice}`
      );

      const risk = entryPrice * 0.009;
      const alertTrigger =
        side === "buy" ? entryPrice + risk * 2 : entryPrice - risk * 2;
      const finalExitTrigger =
        side === "buy" ? entryPrice + risk * 7 : entryPrice - risk * 6;
      const positionKey = `${SYMBOL}_${entryPrice}`; // Unique key for position tracking
      console.log(finalExitTrigger, "final exit trigger");
      if (!alertStatus[positionKey]) {
        alertStatus[positionKey] = {
          first: false,
          second: false,
          finalExit: false,
        };
      }
        console.log("2x trigger ->,", alertTrigger)
      if (
        (side === "buy" && price >= alertTrigger) ||
        (side === "sell" && price <= alertTrigger)
      ) {
        console.log("price after2x ->", price)
        if (!profitBooked && Math.abs(positionSize) > amount * 1.99) {
          console.log(
            "🚀 Alert System Activated: Tracking 12 EMA for exits..."
          );
          console.log(
            "📈 Booking 30% Profit immediately after hitting 1:2 RR..."
          );
          console.log("positionSI->", positionSize);
          const order = await binance.createOrder(
            SYMBOL,
            "market",
            side === "buy" ? "sell" : "buy",
            Math.abs(positionSize) * 0.3
          );
          console.log("order crerated ->,", order);
          profitBooked = true;
        }

        const updatedPositions = await binance.fetchPositions();
        const updatedPosition = updatedPositions.find(
          (p) =>
            p.info.symbol === SYMBOL.replace("/", "") &&
            parseFloat(p.info.positionAmt) !== 0
        );

        if (!updatedPosition) {
          console.log(
            "🚨 Position closed after partial profit booking. Exiting..."
          );
          return;
        }

        positionSize = parseFloat(updatedPosition.info.positionAmt);
        console.log(`🔄 Updated Position Size: ${positionSize}`);
        await updateStopLossOrders(positionSize, side);

        const randomDelay =
          Math.floor(Math.random() * (3700 - 2500 + 1)) + 2500;
        await new Promise((resolve) => setTimeout(resolve, randomDelay)); // Small delay to ensure API updates

        if (!updatedPosition) {
          console.log(
            "🚨 Position closed after partial profit booking. Exiting..."
          );
          return;
        }

        positionSize = parseFloat(updatedPosition.info.positionAmt); // ✅ Update remaining position size
        console.log(`🔄 Updated Position Size: ${positionSize}`);

        while (true) {
          console.log("in while after 1:2");
          console.log("2x trigger ->,", alertTrigger)
          const randomDelay =
            Math.floor(Math.random() * (3940 - 3400 + 1)) + 3400;
          await new Promise((resolve) => setTimeout(resolve, randomDelay));
          try {
            const { ohlcv, bigEma, smallEma } = await fetchAndAnalyzeCandles(
              "small"
            );

            // ✅ Check if position is still open
            const updatedPositions = await binance.fetchPositions();
            const updatedPosition = updatedPositions.find(
              (p) =>
                p.info.symbol === SYMBOL.replace("/", "") &&
                parseFloat(p.info.positionAmt) !== 0
            );

            if (!updatedPosition) {
              console.log("🚨 Position closed. Exiting...");
              return;
            }
            // ⛔ Exit immediately if final exit trigger is hit (one-sided movement)
if (
  (side === "buy" && price >= finalExitTrigger) ||
  (side === "sell" && price <= finalExitTrigger)
) {
  console.log("🏁 Final Exit Trigger Hit Directly! Closing full position...");
  await binance.createOrder(
    SYMBOL,
    "market",
    side === "buy" ? "sell" : "buy",
    Math.abs(positionSize)
  );
  await cancelAllOpenOrders();
  delete alertStatus[positionKey];
  finalBook = true;
  profitBooked = false;
  return;
}

            console.log(" 📊  Pnl>", updatedPosition?.info?.unRealizedProfit);
            console.log("finalExitTrigger -", finalExitTrigger);
            positionSize = parseFloat(updatedPosition.info.positionAmt);
            if (!updatedPosition) {
              console.log(
                "🚨 Position closed during alert tracking. Exiting..."
              );
              await cancelAllOpenOrders();
              delete alertStatus[positionKey];
              return;
            }
            // if (
            //   (side === "buy" && price >= finalExitTrigger) ||
            //   (side === "sell" && price <= finalExitTrigger)
            // ) {
            //   console.log("📈 Booking all Profit at near final exit trigger");
            //   console.log("finl exit trigger -", finalExitTrigger);
            //   console.log("price at trigger -", price);
            //   console.log("side ->", side);
            //   await binance.createOrder(
            //     SYMBOL,
            //     "market",
            //     side === "buy" ? "sell" : "buy",
            //     Math.abs(positionSize)
            //   );

            //   return;
            // }

            // ✅ If price reaches 1:3 RR, start trailing SL (only once)
            const trailingTrigger =
              side === "buy"
                ? entryPrice + risk * 2.5
                : entryPrice - risk * 2.3;

            if (
              !alertStatus[positionKey].trailingSlTriggered && // ✅ Check if SL update already happened
              ((side === "buy" && price >= trailingTrigger) ||
                (side === "sell" && price <= trailingTrigger))
            ) {
              console.log(
                "🚀 Price hit 1:2.5 RR! Trailing Stop-Loss by 40%..."
              );

              try {
                const openOrders = await binance.fetchOpenOrders(SYMBOL);
                const stopOrders = openOrders.filter(
                  (order) => order.info.type === "STOP_MARKET"
                );

                console.log(`🛑 Found ${stopOrders.length} STOP_MARKET orders`);
                for (let order of stopOrders) {
                  let oldSL = parseFloat(order.stopPrice);
                  let initialDistance = Math.abs(entryPrice - oldSL); // ✅ Distance from entry price
                  let stopMoveAmount = initialDistance * 0.4; // ✅ Move SL by 40% of that distance

                  let newSL =
                    side === "buy"
                      ? oldSL + stopMoveAmount // Move SL closer for buy orders
                      : oldSL - stopMoveAmount; // Move SL closer for sell orders

                  console.log(`🔄 Adjusting SL from ${oldSL} → ${newSL}`);

                  await binance.cancelOrder(order.id, SYMBOL); // Cancel old SL order
                  await binance.createOrder(
                    SYMBOL,
                    "STOP_MARKET",
                    side === "buy" ? "sell" : "buy",
                    Math.abs(positionSize),
                    undefined,
                    {
                      stopPrice: newSL,
                    }
                  );
                }

                alertStatus[positionKey].trailingSlTriggered = true; // ✅ Prevent future updates
              } catch (err) {
                console.log("❌ Error updating SL: ", err.message);
              }
            }

            // ✅ Continue with other alerts & profit booking
            const last10Candles = ohlcv.slice(-10);
            const highs = last10Candles.map((candle) => candle[2]);
            const lows = last10Candles.map((candle) => candle[3]);

            const avgHigh =
              highs.reduce((sum, val) => sum + val, 0) / highs.length;
            const avgLow =
              lows.reduce((sum, val) => sum + val, 0) / lows.length;

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
              !firstBook &&
              ((side === "buy" && price >= recentHigh * 1.005) ||
                (side === "sell" && price <= recentLow * 0.995))
            ) {
              console.log("📈 Booking 30% Profit at near recent level...");
              await binance.createOrder(
                SYMBOL,
                "market",
                side === "buy" ? "sell" : "buy",
                Math.abs(positionSize) * 0.3
              );

              const updatedPositions = await binance.fetchPositions();
              const updatedPosition = updatedPositions.find(
                (p) =>
                  p.info.symbol === SYMBOL.replace("/", "") &&
                  parseFloat(p.info.positionAmt) !== 0
              );

              if (!updatedPosition) {
                console.log(
                  "🚨 Position closed after partial profit booking. Exiting..."
                );
                profitBooked = false;

                return;
              }

              positionSize = parseFloat(updatedPosition.info.positionAmt);
              console.log(`🔄 Updated Position Size: ${positionSize}`);
              firstBook = true;
              await updateStopLossOrders(positionSize, side);
            }

            if (
              !alertStatus[positionKey].second &&
              firstBook &&
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
              !secondBook &&
              ((side === "buy" && price >= recentHigh * 1.015) ||
                (side === "sell" && price <= recentLow * 0.985))
            ) {
              console.log("📈 Booking 40% Profit at near previous level...");
              await binance.createOrder(
                SYMBOL,
                "market",
                side === "buy" ? "sell" : "buy",
                Math.abs(positionSize) * 0.7
              );

              const updatedPositions = await binance.fetchPositions();
              const updatedPosition = updatedPositions.find(
                (p) =>
                  p.info.symbol === SYMBOL.replace("/", "") &&
                  parseFloat(p.info.positionAmt) !== 0
              );

              if (!updatedPosition) {
                console.log(
                  "🚨 Position closed after partial profit booking. Exiting..."
                );
                profitBooked = false;
                return;
              }

              positionSize = parseFloat(updatedPosition.info.positionAmt);
              console.log(`🔄 Updated Position Size: ${positionSize}`);
              secondBook = true;
              await updateStopLossOrders(positionSize, side);
            }

            if (
              !alertStatus[positionKey].finalExit &&
              alertStatus[positionKey].second &&
              secondBook &&
              !finalBook &&
              ((side === "buy" && price < smallEma) ||
                (side === "sell" && price > smallEma))
            ) {
              console.log("🚨 Final Alert! Closing remaining position...");
              await binance.createOrder(
                SYMBOL,
                "market",
                side === "buy" ? "sell" : "buy",
                Math.abs(positionSize)
              );
              await cancelAllOpenOrders();
              delete alertStatus[positionKey]; // Clean up after closing position
              finalBook = true;
              profitBooked = false;
              return;
            }
          } catch (err) {
            console.error("❌ Error ->", err);
            console.log("continue monitoring");
            continue;
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
