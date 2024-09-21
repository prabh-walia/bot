import { binance } from "./binanceClient.js";
import { SYMBOL, TIMEFRAME, LIMIT } from "./config.js";
import { calculate200EMA } from "./utils.js";
import { trendFinder } from "./trendFinder.js";
import { initWebSocket, getCurrentPrice, onPriceUpdate, closeWebSocket } from "./websocket.js"


export let avgSwingHigh;
export let avgSwingLow;
export let Trend;

export const fetchAndAnalyzeCandles = async () => {
    try {

        const ohlcv = await binance.fetchOHLCV(SYMBOL, TIMEFRAME, undefined, LIMIT);
        const closingPrices = ohlcv.map(entry => entry[4]);
        const ema200 = calculate200EMA(closingPrices);

           console.log("YS CURRENT PRICE IS THIS ->", getCurrentPrice());
        return {  ohlcv, ema200 };
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
        console.log('Not enough data to analyze.');
        return;
    }

    // Extract closing prices for the last 20 candles and the previous 20 candles
    const last20ClosingPrices = ohlcv.slice(-15).map(candle => candle[4]);
    const prev20ClosingPrices = ohlcv.slice(-30, -15).map(candle => candle[4]);

    // Calculate average closing prices
    const avgLast20 = calculateAverage(last20ClosingPrices);
    const avgPrev20 = calculateAverage(prev20ClosingPrices);

    // Compare averages
    if (avgLast20 < avgPrev20) {
        console.log("down")
       return true
    } 
    return false
};
export const checkUpTrend = async (ohlcv) => {

    const limit = 20; // Fetch more candles than needed to compare two periods


    if (ohlcv.length < 20) {
        console.log('Not enough data to analyze.');
        return;
    }

    // Extract closing prices for the last 20 candles and the previous 20 candles
    const last20ClosingPrices = ohlcv.slice(-15).map(candle => candle[4]);
    const prev20ClosingPrices = ohlcv.slice(-30, -15).map(candle => candle[4]);

    // Calculate average closing prices
    const avgLast20 = calculateAverage(last20ClosingPrices);
    const avgPrev20 = calculateAverage(prev20ClosingPrices);

    // Compare averages
    if (avgLast20 > avgPrev20) {
        console.log("uupside")
       return true
    } 
    return false
};
export const checkSidewaysTrend = async (ohlcv) => {
    const limit = 25; // Fetch enough candles to analyze the sideways movement


    if (ohlcv.length < limit) {
        console.log('Not enough data to analyze.');
        return;
    }

    // Extract high and low prices for the last 20 candles
    const highPrices = ohlcv.slice(-20).map(candle => candle[2]);
    const lowPrices = ohlcv.slice(-20).map(candle => candle[3]);

    // Calculate the highest high and the lowest low
    const highestHigh = Math.max(...highPrices);
    const lowestLow = Math.min(...lowPrices);

    // Define the threshold for sideways movement (you can adjust this based on your strategy)
    const thresholdPercentage = 0.6; // Example: 0.5% price range is considered sideways

    // Calculate the percentage difference between the highest high and lowest low
    const priceRangePercentage = ((highestHigh - lowestLow) / highestHigh) * 100;

    if (priceRangePercentage <= thresholdPercentage) {
        console.log("sideways");
        return true;
    } 
    return false;
};
export const  fetchAndAnalyzeBiggerFrame= async (timeframe)=>{
        
    try {

        const ohlcv_B = await binance.fetchOHLCV(SYMBOL, timeframe, undefined, LIMIT);
        const closingPrices = ohlcv_B.map(entry => entry[4]);
        let ema200 = calculate200EMA(closingPrices);
        ema200=ema200+200
         
        return { ema200,ohlcv_B };
    } catch (error) {
        console.error("Error fetching and analyzing candles:", error);
    }
}