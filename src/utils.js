export const average = (arr) => {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
};

export const calculate200EMA = (prices) => {
    const period = 200;
    const k = 2 / (period + 1);
    let ema = prices[0];

    for (let i = 1; i < prices.length; i++) {
        ema = (prices[i] - ema) * k + ema;
    }

    return ema;
};

export const getQuantity = (candleSizePercent) => {
    if (candleSizePercent >= 0.3 && candleSizePercent <= 0.4) {
        return 0.002;
    } else if (candleSizePercent >= 0.2 && candleSizePercent < 0.3) {
        return 0.003;
    } else if (candleSizePercent >= 0.15 && candleSizePercent < 0.2) {
        return 0.004;
    } 
    else if(candleSizePercent>=0.11&& candleSizePercent < 0.15){
        return 0.005
        }
        else if(candleSizePercent>=0.05&&candleSizePercent<0.11){
             return 0.008
        }
        else if(candleSizePercent>=0.03&&candleSizePercent<0.05){
           return 0.009
        }
    
    else {
        console.log("Candle size doesn't fall within the defined ranges.");
        return 0; // Return 0 or handle this case as needed
    }
};
// Function to find recent support and resistance levels
export  function findSwings(ohlcv, length) {
    const swings = [];
    let previousHigh = null;
    let previousLow = null;

    for (let i = length; i < ohlcv.length; i++) {
        const pivotHigh = isPivotHigh(ohlcv, i, length);
        const pivotLow = isPivotLow(ohlcv, i, length);

        if (pivotHigh) {
            const swingType = (previousHigh === null || pivotHigh > previousHigh) ? 'HH' : 'LH';
            swings.push({ index: i, type: swingType, price: pivotHigh });
            previousHigh = pivotHigh;
        }

        if (pivotLow) {
            const swingType = (previousLow === null || pivotLow < previousLow) ? 'LL' : 'HL';
            swings.push({ index: i, type: swingType, price: pivotLow });
            previousLow = pivotLow;
        }
    }

    return swings;
}

function isPivotHigh(ohlcv, index, length) {
    const high = ohlcv[index][1]; // Assuming high price is at index 1 in each OHLCV entry
    for (let i = index - length; i <= index + length; i++) {
        if (i >= 0 && i < ohlcv.length) {
            if (ohlcv[i][1] > high) {
                return false;
            }
        }
    }
    return high;
}

function isPivotLow(ohlcv, index, length) {
    const low = ohlcv[index][2]; // Assuming low price is at index 2 in each OHLCV entry
    for (let i = index - length; i <= index + length; i++) {
        if (i >= 0 && i < ohlcv.length) {
            if (ohlcv[i][2] < low) {
                return false;
            }
        }
    }
    return low;
}
export function getSupportAndResistanceZones(swings, excludedIndexes) {
    let lastLL = [];
    let lastHL = [];
    let lastHH = [];
    let lastLH = [];

    for (let i = swings.length - 1; i >= 0; i--) {
        const swing = swings[i];

        // Skip excluded indexes
        if (excludedIndexes.includes(swing.index)) {
            continue;
        }

        if (swing.type === 'LL' && lastLL.length < 2) {
            lastLL.push(swing);
        } else if (swing.type === 'HL' && lastHL.length < 2) {
            lastHL.push(swing);
        } else if (swing.type === 'HH' && lastHH.length < 2) {
            lastHH.push(swing);
        } else if (swing.type === 'LH' && lastLH.length < 2) {
            lastLH.push(swing);
        }

        // Break the loop if we have found the last 2 occurrences for all zones
        if (lastLL.length === 2 && lastHL.length === 2 && lastHH.length === 2 && lastLH.length === 2) {
            break;
        }
    }

    return { support: [...lastLL, ...lastHL], resistance: [...lastHH, ...lastLH] };
}


export function validateTradeConditionBullish(price, supportLevels) {
    // Loop through each support level
    for (const support of supportLevels) {
        const supportPrice = support.price;
    
        // Calculate the thresholds (0.1% below and above the support price)
        const lowerThreshold = supportPrice * 0.997; 
        const upperThreshold = supportPrice * 1.003; 
    
        // Check if the price is within the range between the lower and upper thresholds
        if (price >= lowerThreshold && price <= upperThreshold) {
          // The price is within the specified range
          // You can add pattern detection logic here if needed
          return true; // Condition met for this support, trigger buy
        }
        
      }
    
      return false; // Condition not met for any support level
  }
  
 export function validateTradeConditionBearish(price, resistanceLevels) {
    // Loop through each resistance level
    for (const resistance of resistanceLevels) {
      const resistancePrice = resistance.price;
  
      // Calculate the thresholds (0.1% below and above the resistance price)
      const lowerThreshold = resistancePrice * 0.997; // 0.1% below
      const upperThreshold = resistancePrice * 1.0025; // 0.1% above
  
      // Check if the price is within the range between the lower and upper thresholds
      if (price >= lowerThreshold && price <= upperThreshold) {
        // The price is within the specified range
        // You can add pattern detection logic here if needed
        return true; // Condition met for this resistance, trigger sell
      }
    }
  
    return false; // Condition not met for any resistance level
  }
  
  function findDuplicates(arr1) {
        let a = arr1.sort((a,b)=>b-a)

        let set = [...new Set(a)]
          return set[2]

}

// Example Usage
const nums = [3,2];
const target = 5;
console.log(findDuplicates([4, 3, 2, 7, 8, 2, 1, 6, 7])); // Output: [0, 1]
