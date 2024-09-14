import ccxt from "ccxt";
import { API_KEY, SECRET_KEY } from "./config.js";

export const binance = new ccxt.binance({
    apiKey: API_KEY,
    secret: SECRET_KEY,
    
    enableRateLimit: true,
    options: {
        defaultType: 'future'
    }
});
