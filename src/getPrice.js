import { Status } from "./model.js";
import { trade } from "./globalVariables.js";

import { initWebSocket, onPriceUpdate } from "./websocket.js";
export let price;
let currentSocket = null;
let activeSymbol = null;
export const getRealTimePrice = async (symbol) => {
  try {
    if (symbol === activeSymbol) {
      // ⛔ No need to reopen if already active
      return;
    }
    if (currentSocket && currentSocket.close) {
      console.log(`🔌 Closing socket for ${activeSymbol}`);
      currentSocket.close();
    }
    console.log(`📡 Opening socket for ${symbol}`);
    activeSymbol = symbol;
    currentSocket = initWebSocket(symbol);

    onPriceUpdate((prices) => {
      price = parseFloat(prices);
    });
  } catch (err) {
    console.log("error ->", err);
  }
};
