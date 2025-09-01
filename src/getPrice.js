import { Status } from "./model.js";
import { trade } from "./globalVariables.js";

import { initWebSocket, onPriceUpdate, closeWebSocket } from "./websocket.js";
export let price;
let currentSocket = null;
let activeSymbol = null;
export const getRealTimePrice = async (symbol) => {
  try {
    if (symbol === activeSymbol) {
      // ⛔ No need to reopen if already active
      return;
    }
    await closeWebSocket();
    console.log(`📡 Opening socket for ${symbol}`);
    activeSymbol = symbol;
    initWebSocket(symbol);

    onPriceUpdate((prices) => {
      if (symbol === activeSymbol) {
        price = parseFloat(prices);
      }
    });
  } catch (err) {
    console.log("error ->", err);
  }
};
