import { average } from "./utils.js";

let i=0;let lastPrintedTime = 0;

export const trendFinder = ( ema, swings) => {

    const highAverage = average(swings.swingHighs.map(e => e.price));
    const lowAverage = average(swings.swingLows.map(e => e.price));

    if (lowAverage > ema*1.002) {
        return "Bullish";
    } else if (highAverage < ema*1.002 ) {
        return "Bearish";
    } else {
        return "Neutral";
    }
};
const isFiveMinuteInterval = () => {
    const now = new Date();
    const minutes = now.getMinutes();
    return minutes % 5 === 0;
};
const getCurrentTimeInSeconds = () => {
    const now = new Date();
    return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
};