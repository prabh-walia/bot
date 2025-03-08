import { Schema, model } from "./db.js";

const tradeSchema = new Schema({
  tradeId: String,
  symbol: String,
  side: String,
  amount: Number,
  entryPrice: Number,
  stopLossPrice: Number,
  takeProfitPrice: Number,
  executionTime: { type: Date, default: Date.now },
  stopLossFilledTime: Date,
  takeProfitFilledTime: Date,
  status: { type: String, default: "open" },
  pattern: String,
  result: String,
});

const statusSchema = new Schema({
  botStatus: {
    isRunning: Boolean,
    lastUpdated: Date,
  },
  trendStatus: {
    currentBias: String,
    updateTimestamp: Date,
    sourceTimeframe: String,
    smallTimeframe: String,
    TrendFrame: String,
    higherEMA: Number,
    lowerEMA: Number,
  },
  symbol: String,
  orderMultiple: Number,
  emergencyStatus: Boolean,
  lastEmergencyChange: Date,
});
export const Trade = model("Trades", tradeSchema);
export const Status = model("Status", statusSchema);
