export const average = (arr) => {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
};

export const calculateEMA = (prices, period) => {
  const k = 2 / (period + 1);
  let ema = prices[0];

  for (let i = 1; i < prices.length; i++) {
    ema = (prices[i] - ema) * k + ema;
  }

  return ema;
};
const baseQuantity = 0.01; // Base quantity for small candles

// Function to calculate quantity based on candle size percent
export const getQuantity = (candleSizePercent) => {
  const feePercent = 0.1; // Fixed fee percentage (0.1%)
  const maxFeePercentage = 10; // Maximum allowed fee percentage of profits

  // For large candles, we want smaller quantities
  if (candleSizePercent > 1.5) {
    return 0; // No trade for candle sizes above 0.9%
  }

  // Calculate the potential profit (for example, 2.5x the candle size)
  // const potentialProfitPercent = candleSizePercent * 2.5; // Expected profit based on candle size

  // // Calculate the fee amount
  // const feeAmount = (feePercent / 100) * baseQuantity; // Fee based on quantity

  // // Ensure the fee is no more than 10% of the potential profit
  // if (feeAmount > (maxFeePercentage / 100) * potentialProfitPercent) {
  //     return 0; // Skip trade if the fee would take more than 10% of the profit
  // }

  // // Calculate the quantity, inversely proportional to the candle size, but limited
  // const calculatedQuantity = (0.1 / candleSizePercent) * baseQuantity;

  // // Round the quantity to the nearest multiple of 0.001 (since 0.001 is the minimum lot size)
  // const roundedQuantity = Math.round(calculatedQuantity * 1000) / 1000;

  // // Ensure the rounded quantity is not smaller than 0.001 (minimum lot size)
  // if (roundedQuantity < 0.001) {
  //     return 0.001;
  // }

  return 0.004;
};
// Function to find recent support and resistance levels
export function findSwings(ohlcv, length) {
  const swings = [];
  let previousHigh = null;
  let previousLow = null;

  for (let i = length; i < ohlcv.length; i++) {
    const pivotHigh = isPivotHigh(ohlcv, i, length);
    const pivotLow = isPivotLow(ohlcv, i, length);

    if (pivotHigh) {
      const swingType =
        previousHigh === null || pivotHigh > previousHigh ? "HH" : "LH";
      swings.push({ index: i, type: swingType, price: pivotHigh });
      previousHigh = pivotHigh;
    }

    if (pivotLow) {
      const swingType =
        previousLow === null || pivotLow < previousLow ? "LL" : "HL";
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

    if (swing.type === "LL" && lastLL.length < 2) {
      lastLL.push(swing);
    } else if (swing.type === "HL" && lastHL.length < 2) {
      lastHL.push(swing);
    } else if (swing.type === "HH" && lastHH.length < 2) {
      lastHH.push(swing);
    } else if (swing.type === "LH" && lastLH.length < 2) {
      lastLH.push(swing);
    }

    // Break the loop if we have found the last 2 occurrences for all zones
    if (
      lastLL.length === 2 &&
      lastHL.length === 2 &&
      lastHH.length === 2 &&
      lastLH.length === 2
    ) {
      break;
    }
  }

  return {
    support: [...lastLL, ...lastHL],
    resistance: [...lastHH, ...lastLH],
  };
}

export function validateTradeConditionBullish(price, supportLevels) {
  // Loop through each support level
  for (const support of supportLevels) {
    const supportPrice = support.price;

    // Calculate the thresholds (0.1% below and above the support price)
    const lowerThreshold = supportPrice * 0.99;
    const upperThreshold = supportPrice * 1.01;

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
    const lowerThreshold = resistancePrice * 0.99; // 0.1% below
    const upperThreshold = resistancePrice * 1.01; // 0.1% above

    // Check if the price is within the range between the lower and upper thresholds
    if (price >= lowerThreshold && price <= upperThreshold) {
      // The price is within the specified range
      // You can add pattern detection logic here if needed
      return true; // Condition met for this resistance, trigger sell
    }
  }

  return false; // Condition not met for any resistance level
}

export function checkBullishPatternAboveEma(lastTwoSwings) {
  if (lastTwoSwings.length !== 2) {
    throw new Error("Input must contain exactly two swings");
  }

  const [secondLast, last] = lastTwoSwings;

  // Check if second last is (HL or LL) and last is HH
  if (
    (secondLast.type === "HL" || secondLast.type === "LL") &&
    last.type === "HH"
  ) {
    return {
      patternMatched: true,
      secondLastSwing: secondLast,
      lastSwing: last,
    };
  }

  return { patternMatched: false };
}

export function findPivotHighs(prices, leftLen, rightLen) {
  const highs = [];
  for (let i = leftLen; i < prices.length - rightLen; i++) {
    let isPivotHigh = true;

    // Check left side
    for (let j = 1; j <= leftLen; j++) {
      if (prices[i] <= prices[i - j]) {
        isPivotHigh = false;
        break;
      }
    }

    // Check right side
    for (let j = 1; j <= rightLen; j++) {
      if (prices[i] <= prices[i + j]) {
        isPivotHigh = false;
        break;
      }
    }

    if (isPivotHigh) {
      highs.push({ index: i, price: prices[i] });
    }
  }
  return highs;
}

export function findPivotLows(prices, leftLen, rightLen) {
  const lows = [];
  for (let i = leftLen; i < prices.length - rightLen; i++) {
    let isPivotLow = true;

    // Check left side
    for (let j = 1; j <= leftLen; j++) {
      if (prices[i] >= prices[i - j]) {
        isPivotLow = false;
        break;
      }
    }

    // Check right side
    for (let j = 1; j <= rightLen; j++) {
      if (prices[i] >= prices[i + j]) {
        isPivotLow = false;
        break;
      }
    }

    if (isPivotLow) {
      lows.push({ index: i, price: prices[i] });
    }
  }
  return lows;
}
export function calculatePivotPoints({ high, low, close }) {
  const pivot = (high + low + close) / 3;

  const r1 = 2 * pivot - low;
  const s1 = 2 * pivot - high;
  const r2 = pivot + (high - low);
  const s2 = pivot - (high - low);
  const r3 = high + 2 * (pivot - low);
  const s3 = low - 2 * (high - pivot);

  return {
    pivot: parseFloat(pivot.toFixed(2)),
    R1: parseFloat(r1.toFixed(2)),
    S1: parseFloat(s1.toFixed(2)),
    R2: parseFloat(r2.toFixed(2)),
    S2: parseFloat(s2.toFixed(2)),
    R3: parseFloat(r3.toFixed(2)),
    S3: parseFloat(s3.toFixed(2)),
  };
}
