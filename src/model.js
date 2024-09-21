import { Schema, model } from './db.js';

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
    status: { type: String, default: 'open' },
    pattern :String ,
    result : String
   
});

const Trade = model('Trades', tradeSchema);

export default Trade;
