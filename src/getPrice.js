import { Status } from "./model.js";
import { trade } from "./globalVariables.js";
import { tracker } from "./index.js";
import { initWebSocket, onPriceUpdate } from "./websocket.js";
export let price;
export const getRealTimePrice = async () => {
  try {
    const status = await Status.findOne();
    initWebSocket(status?.symbol);

    onPriceUpdate((prices) => {
      price = parseFloat(prices);

      !trade && tracker();
    });
  } catch (err) {
    console.log("error ->", err);
  }
};
