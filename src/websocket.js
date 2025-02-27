import WebSocket from "ws";

let ws = null;
let currentPrice = null;
const callbacks = [];

// Function to initialize WebSocket
const initWebSocket = (symbol) => {
  if (ws) {
    console.warn("WebSocket already initialized");
    return;
  }

  const wsUrl = `wss://fstream.binance.com/ws/${symbol}@trade`;
  ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    console.log("WebSocket connection opened");
  });

  ws.on("message", (data) => {
    try {
      const tradeData = JSON.parse(data);

      if (tradeData && tradeData.p) {
        currentPrice = tradeData.p;

        callbacks.forEach((callback) => callback(currentPrice));
      } else {
      }
    } catch (error) {
      console.error("Error parsing websocket message data:", error);
    }
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });

  ws.on("close", () => {
    console.log("WebSocket connection closed");
    ws = null;
    initWebSocket("btcusdt");
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
  if (ws) {
    ws.close();
    ws = null;
  }
};

export { initWebSocket, getCurrentPrice, onPriceUpdate, closeWebSocket };
