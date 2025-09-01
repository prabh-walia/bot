import WebSocket from "ws";

let ws = null;
let currentPrice = null;
const callbacks = [];

// Function to initialize WebSocket
const initWebSocket = (symbol) => {
  if (ws) {
    console.warn("Closing old WebSocket before opening new one");
    ws.removeAllListeners(); // 🔑 remove all old event listeners
    ws.close();
    ws = null;
    callbacks = []; // 🔑 clear callbacks so old ones don’t fire
  }

  const wsUrl = `wss://fstream.binance.com/ws/${symbol}@trade`;
  ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    console.log(`WebSocket connection opened for ${symbol}`);
  });

  ws.on("message", (data) => {
    try {
      const tradeData = JSON.parse(data);
      if (tradeData && tradeData.p) {
        currentPrice = parseFloat(tradeData.p);
        callbacks.forEach((callback) => callback(currentPrice));
      }
    } catch (error) {
      console.error("Error parsing websocket message data:", error);
    }
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });

  ws.on("close", () => {
    console.log(`WebSocket connection closed for ${symbol}`);
    ws = null;
    callbacks = []; // ensure no leftover listeners
  });
};

// Function to get the current price
const getCurrentPrice = () => {
  if (currentPrice === null) {
    console.warn("Current price is not yet available");
  }
  return currentPrice;
};

// Function to register a callback for price updates
const onPriceUpdate = (callback) => {
  if (ws) {
    callbacks.push(callback);
  } else {
    console.warn("WebSocket not initialized");
  }
};

// Function to close the WebSocket connection
const closeWebSocket = () => {
  return new Promise((resolve) => {
    if (ws) {
      ws.removeAllListeners();
      ws.once("close", resolve); // resolve only after closed
      ws.close();
      ws = null;
      callbacks = [];
    } else {
      resolve();
    }
  });
};

export { initWebSocket, getCurrentPrice, onPriceUpdate, closeWebSocket };
