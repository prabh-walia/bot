import { binance } from "./binanceClient.js";
import { SYMBOL } from "./config.js";
import {
  initWebSocket,
  getCurrentPrice,
  onPriceUpdate,
  closeWebSocket,
} from "./websocket.js";

import { Trade } from "./model.js";

export const monitorOrders = async (
  symbol,
  stopLossOrderId,
  takeProfitOrderId,
  entry,
  sl,
  side,
  amount,
  tradeId,
  pattern
) => {
  let stopLossAdjusted = false;
  let secondLossAdjusted = false;
  const retries = 5; // Set a retry limit

  try {
    while (true) {
      for (let i = 0; i < retries; i++) {
        try {
          // Fetch the status of the stop loss and take profit orders
          const stopLossOrderStatus = await binance.fetchOrder(
            stopLossOrderId,
            symbol
          );
          const takeProfitOrderStatus = await binance.fetchOrder(
            takeProfitOrderId,
            symbol
          );

          const currentPrice = parseFloat(getCurrentPrice());
          // Log current order statuses

          // Check if either order is filled
          if (stopLossOrderStatus.status === "closed") {
            console.log(
              "Stop loss order filled. Cancelling take profit order..."
            );
            await binance.cancelOrder(takeProfitOrderId, symbol);
            console.log("Take profit order cancelled");

            const trade = await Trade.findOne({ tradeId: tradeId });
            if (trade) {
              trade.stopLossFilledTime = new Date(); // Set stop loss filled time
              trade.status = "closed"; // Update status to closed
              trade.stopLossPrice = stopLossOrderStatus.price;
              trade.takeProfitFilledTime = null; // Reset take profit filled time
              trade.takeProfitPrice = null;
              trade.result = "loss"; // Set stop loss price
              await trade.save();
              console.log("Trade updated with stop loss execution:", trade);
            }
            return ["loss", stopLossOrderStatus.price];
          } else if (takeProfitOrderStatus.status === "closed") {
            console.log(
              "Take profit order filled. Cancelling stop loss order..."
            );
            await binance.cancelOrder(stopLossOrderId, symbol);
            console.log("Stop loss order cancelled");
            const trade = await Trade.findOne({ tradeId: tradeId });
            if (trade) {
              trade.takeProfitFilledTime = new Date(); // Set take profit filled time
              trade.status = "closed"; // Update status to closed
              trade.takeProfitPrice = takeProfitOrderStatus.price;
              // Set take profit price
              trade.stopLossFilledTime = null; // Reset stop loss filled time if needed
              trade.stopLossPrice = null;
              trade.result = "profit";
              await trade.save();
              console.log("Trade updated with take profit execution:", trade);
            }

            return ["profit", takeProfitOrderStatus.price];
          }

          if (side === "sell") {
            let Loss = sl - entry;
            if (currentPrice < entry - Loss * 1.095) {
              if (
                secondLossAdjusted == false &&
                currentPrice < entry - Loss * 1.68 &&
                stopLossAdjusted == true
              ) {
                console.log(
                  "Price reached 1.8x of loss. Adjusting stop loss again..."
                );

                await binance.cancelOrder(stopLossOrderId, symbol);

                console.log("Second stop loss order cancelled");

                const newStopLossPrice = entry + Loss * 0.05; // Adjusted to 20% more near
                const slSide = "buy";
                console.log(
                  `Entry: ${entry}, Loss: ${Loss}, New Stop Loss Price: ${newStopLossPrice}, Current Price: ${currentPrice}`
                );
                const newStopLossOrder = await binance.createOrder(
                  symbol,
                  "STOP_MARKET",
                  slSide,
                  amount,
                  undefined,
                  {
                    stopPrice: newStopLossPrice,
                  }
                );

                secondLossAdjusted = true;

                console.log(
                  "Second new stop loss order created",
                  newStopLossPrice
                );

                stopLossOrderId = newStopLossOrder.id; // Update the stop loss order ID
              } else if (stopLossAdjusted == false) {
                console.log(
                  "Price reached partial take profit threshold. Adjusting stop loss..."
                );
                await binance.cancelOrder(stopLossOrderId, symbol);

                console.log("Current stop loss order cancelled");

                const newStopLossPrice = entry + Loss * 0.25;
                const slSide = "buy";
                console.log(
                  `Entry: ${entry}, Loss: ${Loss}, New Stop Loss Price: ${newStopLossPrice}, Current Price: ${currentPrice}`
                );
                const newStopLossOrder = await binance.createOrder(
                  symbol,
                  "STOP_MARKET",
                  slSide,
                  amount,
                  undefined,
                  {
                    stopPrice: newStopLossPrice,
                  }
                );

                stopLossAdjusted = true;
                console.log("New stop loss order created", newStopLossPrice);

                stopLossOrderId = newStopLossOrder.id; // Update the stop loss order ID
              }
            }
          } else {
            let Loss = entry - sl;
            if (currentPrice > entry + Loss * 1.095) {
              if (
                currentPrice > entry + Loss * 1.68 &&
                secondLossAdjusted == false &&
                stopLossAdjusted == true
              ) {
                console.log(
                  "Price reached 1.8x of loss. Adjusting stop loss again..."
                );
                await binance.cancelOrder(stopLossOrderId, symbol);
                console.log("Second stop loss order cancelled");

                const newStopLossPrice = entry - Loss * 0.05; // Adjusted to 20% more near
                const slSide = "sell";
                console.log(
                  `Entry: ${entry}, Loss: ${Loss}, New Stop Loss Price: ${newStopLossPrice}, Current Price: ${currentPrice}`
                );
                const newStopLossOrder = await binance.createOrder(
                  symbol,
                  "STOP_MARKET",
                  slSide,
                  amount,
                  undefined,
                  {
                    stopPrice: newStopLossPrice,
                  }
                );

                secondLossAdjusted = true;
                console.log(
                  "Second new stop loss order created",
                  newStopLossPrice
                );

                stopLossOrderId = newStopLossOrder.id; // Update the stop loss order ID
              } else if (stopLossAdjusted == false) {
                console.log(
                  "Price reached partial take profit threshold. Adjusting stop loss..."
                );
                await binance.cancelOrder(stopLossOrderId, symbol);
                console.log("Current stop loss order cancelled");

                const newStopLossPrice = entry - Loss * 0.25;
                const slSide = "sell";
                console.log(
                  `Entry: ${entry}, Loss: ${Loss}, New Stop Loss Price: ${newStopLossPrice}, Current Price: ${currentPrice}`
                );
                const newStopLossOrder = await binance.createOrder(
                  symbol,
                  "STOP_MARKET",
                  slSide,
                  amount,
                  undefined,
                  {
                    stopPrice: newStopLossPrice,
                  }
                );

                stopLossAdjusted = true;
                console.log("New stop loss order created", newStopLossPrice);

                stopLossOrderId = newStopLossOrder.id; // Update the stop loss order ID
              }
            }
          }

          break;
        } catch (error) {
          if (i < retries - 1) {
            console.warn(
              `Retry ${i + 1} for monitoring orders failed:`,
              error.message
            );
            await new Promise((resolve) => setTimeout(resolve, (i + 1) * 1300)); // Exponential backoff
          } else {
            console.error("Error monitoring orders after retries:", error);

            throw error;
          }
        }
      }

      // Wait before checking again
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Check every 2 seconds
    }
  } catch (error) {
    console.error("Final Error monitoring orders:", error.message);

    throw error;
  }
};

const monitorOrderFilling = async (orders) => {
  console.log("📡 Monitoring Order Filling...");

  while (orders.some((order) => order.status === "OPEN")) {
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Check every 2 sec

    for (let order of orders) {
      if (order.status === "OPEN") {
        try {
          const orderStatus = await binance.fetchOrder(order.orderId, SYMBOL);

          if (orderStatus.status === "FILLED") {
            console.log(`🎯 Order FILLED at ${order.price}`);

            // Place Stop-Loss Order after Limit Order is filled
            const stopLossOrder = await binance.createOrder(
              SYMBOL,
              "STOP_MARKET",
              order.slSide,
              2,
              undefined,
              {
                stopPrice: order.slPrice,
              }
            );

            console.log(`🛑 Stop-Loss Placed at ${order.slPrice}`);
            order.status = "FILLED";
            order.stopLossOrderId = stopLossOrder.id;
          }
        } catch (err) {
          console.error("❌ Error fetching order status:", err);
        }
      }
    }
  }
};
