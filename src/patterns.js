export const isBullishEngulfing = (currentCandle, prevCandle) => {
    const prevOpen = prevCandle[1];
    const prevClose = prevCandle[4];

    const currentOpen = currentCandle[1];
    const currentClose = currentCandle[4];
    const PrevpercentageChange = ((prevCandle[2] - prevCandle[3]) / prevCandle[3]) * 100;
    const currentpercentageChange = ((currentCandle[2] - currentCandle[3]) / currentCandle[3]) * 100;
     const percentageChange = Math.max(PrevpercentageChange, currentpercentageChange)
    // Check if the previous candle is bearish
    const isPrevBearish = prevClose < prevOpen;

    // Check if the current candle is bullish
    const isCurrentBullish = currentClose > currentOpen;

    // Check if the current candle engulfs the previous candle
    const isEngulfing = currentOpen <= prevClose*1.00001 && currentClose > prevOpen;
      
    // Check if the current candle's low is lower than the second previous candle's low
 
  console.log("bullish pattern.");
    return isPrevBearish && isCurrentBullish && isEngulfing && percentageChange<0.35;
};




export const isBearishEngulfing = (currentCandle, prevCandle) => {
    const prevOpen = prevCandle[1];
    const prevClose = prevCandle[4];
  

    const currentOpen = currentCandle[1];
    const currentClose = currentCandle[4];
 
    const PrevpercentageChange = ((prevCandle[2] - prevCandle[3]) / prevCandle[3]) * 100;
    const currentpercentageChange = ((currentCandle[2] - currentCandle[3]) / currentCandle[3]) * 100;
     const percentageChange = Math.max(PrevpercentageChange, currentpercentageChange)
    // Check if the previous candle is bullish
    const isPrevBullish = prevClose > prevOpen;

    // Check if the current candle is bearish
    const isCurrentBearish = currentClose < currentOpen;

    // Check if the current candle engulfs the previous candle
    const isEngulfing = currentOpen >= prevClose*1.00001 && currentClose < prevOpen;

    console.log("bearish pattern.");
    return isPrevBullish && isCurrentBearish && isEngulfing && percentageChange<0.35
};


export const isBearishHaramiPattern = (candle1, candle2) => {
    return candle2[1] < candle2[4] && // Second last candle (candle2) is bullish (open < close)
           candle1[1] > candle1[4] && // Last candle (candle1) is bearish (open > close)
           candle1[1] <= candle2[4] && // Open of the last candle (candle1) is within the body of the second last candle (candle2)
           candle1[4] >= candle2[1];   // Close of the last candle (candle1) is within the body of the second last candle (candle2)
};

export const isBullishHaramiPattern = (candle1, candle2) => {
    return candle2[1] > candle2[4] && // Second last candle (candle2) is bearish (open > close)
           candle1[1] < candle1[4] && // Last candle (candle1) is bullish (open < close)
           candle1[1] >= candle2[4] && // Open of the last candle (candle1) is within the body of the second last candle (candle2)
           candle1[4] <= candle2[1];   // Close of the last candle (candle1) is within the body of the second last candle (candle2)
};


export const isInsideCandle = (prevCandle, currentCandle) => {
    if(currentCandle[2] < prevCandle[2] && currentCandle[3] > prevCandle[3]){
        console.log("inside Candle");
    }
    return currentCandle[2] < prevCandle[2] && currentCandle[3] > prevCandle[3];
};
export const isBullishHammer = (candle, prevCandle, secondPrevCandle) => {
    const open = candle[1];
    const high = candle[2];
    const low = candle[3];
    const close = candle[4];
    
    const bodyLength = Math.abs(close - open);
    const lowerShadowLength = Math.min(open, close) - low;
    const upperShadowLength = high - Math.max(open, close);
    const percentageChange = ((high - low) / low) * 100;

    // Extracting lows of the previous two candles
    const prevCandleLow = prevCandle[3];
    const secondPrevCandleLow = secondPrevCandle[3];

    // Adding the new condition
    const isLowerThanPrevCandles = low <= prevCandleLow && low <= secondPrevCandleLow;
    // let  green = close > open
   
    return  lowerShadowLength >= 1.04 * bodyLength 
        && upperShadowLength <= lowerShadowLength * 0.25
        && percentageChange <= 0.35
        && isLowerThanPrevCandles;
};


export const isBearishHammer = (candle, prevCandle, secondPrevCandle) => {
    const open = candle[1];
    const high = candle[2];
    const low = candle[3];
    const close = candle[4];
    
    const bodyLength = Math.abs(close - open);
    const lowerShadowLength = Math.min(open, close) - low;
    const upperShadowLength = high - Math.max(open, close);
    const percentageChange = ((high - low) / low) * 100;

    // Extracting highs of the previous two candles
    const prevCandleHigh = prevCandle[2];
    const secondPrevCandleHigh = secondPrevCandle[2];

    // Adding the new condition
    const isHigherThanPrevCandles = high >= prevCandleHigh && high >= secondPrevCandleHigh;
    // let  red = close < open
    return  upperShadowLength >= 1.04 * bodyLength 
        && lowerShadowLength <= upperShadowLength * 0.25 
        && percentageChange <= 0.35
        && isHigherThanPrevCandles;
};

