import { fetchAndAnalyzeCandles, fetchAndAnalyzeBiggerFrame, avgSwingHigh, avgSwingLow, Trend,checkDownTrend,checkSidewaysTrend,checkUpTrend,checkFrequentSideways } from "./fetchAndAnalyze.js";
import { isBullishEngulfing, isBearishEngulfing, isBullishHammer, isBearishHammer, isInsideCandle, isBearishHaramiPattern, isBullishHaramiPattern } from "./patterns.js";
import { placeOrder, monitorOrders } from "./trade.js";
import { binance } from "./binanceClient.js";

import { SYMBOL, AMOUNT, FIXED_RISK_AMOUNT , LEVERAGE,BIGGER_TIMEFRAME} from "./config.js";
import { getQuantity ,getSupportAndResistanceZones,validateTradeConditionBearish,validateTradeConditionBullish,findSwings} from "./utils.js";
import  { initWebSocket, getCurrentPrice, onPriceUpdate, closeWebSocket }  from  "./websocket.js"
let trade = false;
let Ratio = 2.8
let high=null;let low=null;
 let price =null
 let pastTrend =null
 let error= 0;
 let neutral =false
 let hasLoggedTradeTracking =false
 let tradeExecutionOpen = false;
let hasLoggedFindingTrades = false;
let patternFound = false
let fallbackTradeActive = false;
let BullishValidated = false
let BearishValidated = false
let patterns = []

let BullishPatternFound = false
let BearishPatternFound = false
let patternType;
let totalProfit = 0;
let totalLoss = 0;
let isBullishTrade = false
let isBearishTrade = false
let profitTrades =0;
let totalTrades = 0;
let totalFees=0;
 let tradeCompletedAt=0
 let trend;
 const getRandomDelay = () => Math.floor(Math.random() * (190 - 60 + 1)) + 100;
 const getRealTimePrice =()=>{
    try {
        initWebSocket("btcusdt");

        onPriceUpdate((prices) => {
         
        price = parseFloat(prices)

        !trade&&tracker();
   
        });
    
    }
    catch(err) {
    console.log("error ->",err);
    }
}


const tracker=()=>{
    if(trade==false){
        if (!hasLoggedTradeTracking) { 
            console.log(`Tracing trades :   ......`);
            hasLoggedTradeTracking = true; 
        }
       
    if(BullishValidated){
        let count=0;
       count==0&& console.log(  `pattern - bullish - ${BullishValidated} price = ${price} -H- ${high} -L- ${low}`);
        count++;

    if(price>high){
        console.log("price crossed high +")
        isBullishTrade= true
        BullishValidated=false;
        hasLoggedTradeTracking = false;
    } else if(price<low) {
        console.log("Price reversed")
       
        BullishValidated= false
        tradeExecutionOpen= false
        patternFound=false
        hasLoggedTradeTracking = false;
        high = null;
        low = null
    }
     else {
    
      hasLoggedTradeTracking = false;
       }
      }
   else if(BearishValidated){
        let count = 0
        count==0&&console.log(  `pattern trade- bearish - ${BearishValidated}  price = ${price} -H- ${high} -L- ${low}`);
        count++;

    if(price<low){
        console.log("price crossed low +")
        isBearishTrade= true
        BearishValidated=false;
        hasLoggedTradeTracking = false;
    }else if(price>high){
        console.log("Price reversed")
     
    BearishValidated=false
    tradeExecutionOpen= false
    hasLoggedTradeTracking = false;
    patternFound=false
    high = null;
    low = null
    }
    else {
        
        hasLoggedTradeTracking = false;
    }
    }
}
 };


const TradeExecutor = async (stopLossPrice,Ratio,patternType)=>{
    console.log("inside trade executor"); 
    if (stopLossPrice == null || isNaN(stopLossPrice)) {
        throw new Error(`Invalid stopLossPrice: Stop loss price is required and must be a number. coming from trade exector sl->${stopLossPrice} `);
    }
    
  while(trade==false){
   if(isBullishTrade ){

        console.log("Trade going to be executed .... buy");
        trade = true;
        const takeProfitPrice = price + Ratio * (price - stopLossPrice);
        console.log(`SL = ${stopLossPrice} TP = ${takeProfitPrice}  entry - ${price}`);
        const candleSizePercent = ((price - stopLossPrice) / price) * 100;
          let  quantity= getQuantity(candleSizePercent)
          console.log("quantity ->",quantity);
            if(quantity != 0 ) {
                const { stopLossOrder, takeProfitOrder ,currentPrice,tradeId} = await placeOrder(SYMBOL, 'buy', quantity, stopLossPrice, takeProfitPrice,patternType);
              
                fallbackTradeActive =true
                patterns.push(patternType)
               let  outcome = await monitorOrders(SYMBOL, stopLossOrder.id, takeProfitOrder.id,price,stopLossPrice,'buy',quantity,tradeId,patternType);
     
               totalTrades++;
               if (outcome[0] === "profit") {
                tradeCompletedAt = Date.now();
                console.log(` profit -price ->${currentPrice} ${typeof currentPrice}  outcome1- ${outcome[1]}  ${typeof outcome[1]}`);
                 let profit =quantity *(outcome[1]-currentPrice)
                 profitTrades++;
                  totalProfit += profit
                  let fees = quantity * (0.1 / 100);
                  totalFees += fees*currentPrice
            }else {
                console.log(` loss -price ->${currentPrice} ${typeof currentPrice}  outcome1- ${outcome[1]}  ${typeof outcome[1]}`);
                let loss = quantity * (currentPrice - outcome[1])
                totalLoss += loss
                let fees = quantity * (0.1 / 100);
                  totalFees += fees*currentPrice
            }
            }
        
      
     
        trade = false;
        high=null;
        low = null
        isBullishTrade= false
        tradeExecutionOpen= false
        BullishValidated=false
        BullishPatternFound=false
        fallbackTradeActive= false
    
    

   }
   if(isBearishTrade){
    console.log("Trade going to be executed .... sell");
    trade = true;
    const takeProfitPrice = price - Ratio * (stopLossPrice - price);
    console.log(`SL = ${stopLossPrice} TP = ${takeProfitPrice} entry ${price}`);
    const candleSizePercent = (( stopLossPrice-price) / price) * 100;
   let  quantity= getQuantity(candleSizePercent)
    console.log("quantity ->",quantity);
    
    if(quantity !=0 ){
        const { stopLossOrder, takeProfitOrder ,currentPrice,tradeId} = await placeOrder(SYMBOL, 'sell', quantity, stopLossPrice, takeProfitPrice,patternType);

        fallbackTradeActive =true
        patterns.push(patternType)
        let outcome = await monitorOrders(SYMBOL, stopLossOrder.id, takeProfitOrder.id,price,high,'sell',quantity,tradeId,patternType);
        totalTrades++;
        
        if (outcome[0] === "profit") {
            tradeCompletedAt = Date.now();
            console.log(`profit -price ->${currentPrice} ${typeof currentPrice}  outcome1- ${outcome[1]}  ${typeof outcome[1]}`);
            let profit =quantity *(currentPrice-outcome[1])
            profitTrades++;
           totalProfit += profit ;
           let fees = quantity * (0.1 / 100);
                  totalFees += fees*currentPrice
       }else {
        console.log(`loss price ->${currentPrice} ${typeof currentPrice} outcome1- ${outcome[1]} ${typeof outcome[1]}`);
           let loss = quantity * (outcome[1]- currentPrice )
           totalLoss += loss
           let fees = quantity * (0.1 / 100);
             totalFees += fees*currentPrice
       }
    }

    BearishPatternFound=false
    fallbackTradeActive =false
  
    high = null;
    low =null
    tradeExecutionOpen= false
    trade = false
    BearishValidated=false;
    isBearishTrade=false

   }
   await new Promise(resolve=>setTimeout(resolve,100))
}


}


 const trackRealTimePrice = async () => {

    while (true) {
       
        try {
        
                 const now = new Date();
                 const nextIntervalMinutes = Math.ceil(now.getMinutes() / 5) * 5; 
                 const nextInterval = new Date(now);
                 nextInterval.setMinutes(nextIntervalMinutes, 0, 0); 
                 nextInterval.setMilliseconds(50); 
     
                 let delay = nextInterval.getTime() - now.getTime(); // delay added
     
                 if (delay < 0) {
                     // If the calculated time is in the past, adjust to the next 5-minute interval
                     delay += 5 * 60 * 1000;
                 }
     

                 await new Promise(resolve => setTimeout(resolve, delay - 1));
     
                 //  wait to hit time with 100ms accuracy
                 while (new Date().getTime() < nextInterval.getTime()) {
          
                 }
     
                 
                 console.log("Running trade logic at:", new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }));

            if (trade) {
           
                await new Promise(resolve => setTimeout(resolve, 1000)); 
                continue;
            }
         
         
            if (Date.now() - tradeCompletedAt < 3 * 60 * 1000) {
                console.log("Within the 3-minute cooldown period, waiting...");
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue; 
            }


            const fetchInterval = getRandomDelay();
            console.log("Price fetched:", price);

            console.log("Fetching and analyzing candles...");
            const { ema200,ohlcv_B} = await fetchAndAnalyzeBiggerFrame(BIGGER_TIMEFRAME);
            
            await new Promise(resolve => setTimeout(resolve, fetchInterval));
            const { ohlcv, ema } = await fetchAndAnalyzeCandles();

            console.log("Candles fetched and analyzed.");

            const lastCandle = ohlcv[ohlcv.length - 2];
            console.log("last candle -", ohlcv[ohlcv.length-2])
            const prevCandle = ohlcv[ohlcv.length - 3];
            const secondLastCandle = ohlcv[ohlcv.length - 4];
            const swings = findSwings(ohlcv,4);
            const excludedIndexes = [199];
            const zones = getSupportAndResistanceZones(swings,excludedIndexes)
            console.log("swings ->", zones);
            trade === false && console.log("Finding Trades ....");
            if (!hasLoggedFindingTrades) {
                console.log("Finding Trades .........");
                hasLoggedFindingTrades = true;
            }
            console.log("EMA->",ema200);
            console.log("amc=", ema200*0.977)
            if(price>ema200*1.035){
                if(price>ema200*1.11 && (checkUpTrend(ohlcv_B))){
                trend="neutral"
                console.log("  bearished 3%");
                   if (checkFrequentSideways(ohlcv_B)){
                    trend = 'bearish'
                   }
                }
             
                else {
                    trend = "bullish"
                    console.log("  bullished");
                }
                neutral=false
           
            }

            else if(price < ema200*0.965 ){
               if(price < ema200*0.916 && (checkDownTrend(ohlcv_B))){
                   trend = "neutral"
                   console.log("  bullished 3%");
                   if (checkFrequentSideways(ohlcv_B)){
                    trend = 'bullish'
                   }
               }

               
               else {
                  trend = "bearish"
                  console.log("  bearished");

               }
             
               neutral=false
                
            }
        
                    const priceWithinRange = price >= ema200 * 0.962 && price <= ema200 * 1.038;
                    const priceWithinRange2 = price >= ema * 0.98 && price <= ema * 1.02
                        console.log("Trend ->",trend)
   
                        if (trend === "bullish") {
                             let { stopLossPrice, ratio ,patternType} = determineBullishTradeParameters(
                                lastCandle, prevCandle,secondLastCandle, zones, price, priceWithinRange,priceWithinRange2,ohlcv
                            );
                            console.log(`p-${patternFound},t-${tradeExecutionOpen}`)
                            if(patternFound && tradeExecutionOpen==false){
                                console.log(" going to run trade executer")
                                tradeExecutionOpen= true
                               if(stopLossPrice)
                                {
                                    TradeExecutor(stopLossPrice,ratio,patternType)
                                } 
                                else {
                                    tradeExecutionOpen= false
                                }
                            }

                        }

                       else if ( trend =="bearish") {
                        let { stopLossPrice, ratio,patternType } = determineBearishTradeParameters(
                            lastCandle, prevCandle,secondLastCandle, zones, price, priceWithinRange,priceWithinRange2,ohlcv
                        );

                        if(patternFound && tradeExecutionOpen==false){
                            tradeExecutionOpen= true
                            if(stopLossPrice)
                                {
                                    TradeExecutor(stopLossPrice,ratio,patternType)
                                } 
                                else {
                                    tradeExecutionOpen= false
                                }
                        }


                       }
                       else {
                      if(checkUpTrend(ohlcv_B)|| checkFrequentSideways(ohlcv_B)){
                        trend = "bullish"
                      }
                      else if(checkDownTrend(ohlcv_B)){
                        trend = "bearish"
                      }
                      
                   
                       }
        
                        
   
        console.log(`profit ${totalProfit - totalLoss} `)
        console.log(`loss ${totalLoss} `)
        console.log("total trades -",totalTrades)
        console.log("total profitable trades -",profitTrades)
        console.log("Total fees ->", totalFees)
        console.log("errorZ - ", error)
         patterns.map((pattern)=>  console.log("patterns ->",pattern))
        

      
        } catch (error) {
            error += error;
            console.error('Error tracking real-time price:', error);
            console.log("errorZ - ", error)
        }

    }
};


const main = async () => {
    try {
       
        getRealTimePrice();
        await trackRealTimePrice();
    } catch (error) {
        console.error('Error in main function:', error);
    }
};

main();




const determineBullishTradeParameters = (lastCandle, prevCandle,secondLastCandle, zones, price, priceWithinRange,priceWithinRange2,ohlcv) => {
    let stopLossPrice, ratio;

    if (isBullishHammer(lastCandle, prevCandle, secondLastCandle) || isBullishEngulfing(lastCandle, prevCandle)|| isBullishHaramiPattern(lastCandle,prevCandle)) {
        console.log("Validated candle");

        if (isBullishEngulfing(lastCandle, prevCandle)  && (validateTradeConditionBullish(price,zones.support)|| checkFrequentSideways(ohlcv))) {
            patternType = "engulfing";
            stopLossPrice = prevCandle[3];
            high = Math.max(lastCandle[2], prevCandle[2]);
            low = stopLossPrice;
            patternFound=true
           
           if(neutral){
              ratio = 1.9
           }else {
             if(priceWithinRange) {
                ratio = 5.2
             }
            else  if(priceWithinRange2) {
                ratio = 3.4
             }
             else {
                ratio = 2.4
             }
            
           }
             BullishValidated=true
             console.log("pattern -r", patternType)
            return { stopLossPrice, ratio , patternType }
        } else if (isBullishHammer(lastCandle, prevCandle, secondLastCandle) && (validateTradeConditionBullish(price,zones.support)||checkFrequentSideways(ohlcv))) {
            patternType = "Hammer";
            stopLossPrice = lastCandle[3];
            high = lastCandle[2];
            low = stopLossPrice;
            patternFound=true
            if(neutral){
                ratio = 1.9
             }else {
                if(priceWithinRange) {
                   ratio = 5.2
                }
               else  if(priceWithinRange2) {
                   ratio = 3.4
                }
                else {
                   ratio = 2.5
                }
               
              }
            console.log("hammer");
             BullishValidated=true
             console.log("pattern -r", patternType)
            return { stopLossPrice,  ratio ,patternType};
        } 
        else if(isBullishHaramiPattern(lastCandle,prevCandle) && (validateTradeConditionBullish(price,zones.support))){
            patternType = "harami";
            stopLossPrice = prevCandle[3];
            high = Math.min(lastCandle[2], prevCandle[2]);
            low = stopLossPrice;
            patternFound=true
           
           if(neutral){
              ratio = 1.9
           }else {
            if(priceWithinRange) {
               ratio = 5.2
            }
           else  if(priceWithinRange2) {
               ratio =3.3
            }
            else {
               ratio = 2.5
            }
           
          }
           console.log("harami");
             BullishValidated=true
             console.log("pattern -r", patternType)
            return { stopLossPrice, ratio ,patternType};
        }
        else {
            console.log("Pattern not recognized");
            return { stopLossPrice: null, ratio: null };
        }


    } else {
        console.log("Pattern not found");
        return { stopLossPrice: null,  ratio: null,patternType:null };
    }
};
const determineBearishTradeParameters = (lastCandle, prevCandle,secondLastCandle, zones, price, priceWithinRange,priceWithinRange2,ohlcv) => {
    let stopLossPrice, ratio;

    if (isBearishEngulfing(lastCandle, prevCandle) || isBearishHammer(lastCandle, prevCandle,secondLastCandle) || isBearishHaramiPattern(lastCandle,prevCandle)) {
        console.log("Validated candle");

        if (isBearishEngulfing(lastCandle, prevCandle ) && ( validateTradeConditionBearish(price, zones.resistance)|| checkFrequentSideways(ohlcv))) {
            patternType = "engulfing";
            stopLossPrice = prevCandle[2];
            low = Math.min(lastCandle[3], prevCandle[3]);
            high = stopLossPrice;
            patternFound = true;

            if(neutral){
                ratio = 1.9
             }else {
                if(priceWithinRange) {
                   ratio = 5
                }
               else  if(priceWithinRange2) {
                   ratio = 3.1
                }
                else {
                   ratio = 2.5
                }
               
              }
             console.log("pattern -r", patternType)
            BearishValidated = true;
            return { stopLossPrice, ratio,patternType };
        } else if (isBearishHammer(lastCandle, prevCandle,secondLastCandle) && validateTradeConditionBearish(price, zones.resistance)&& checkFrequentSideways(ohlcv) ) {
            patternType = "Hammer";
            stopLossPrice = lastCandle[2];
            high = stopLossPrice
            low = lastCandle[3];
            patternFound = true;
            if(neutral){
                ratio = 1.9
             }else {
                if(priceWithinRange) {
                   ratio = 5
                }
               else  if(priceWithinRange2) {
                   ratio = 3.1
                }
                else {
                   ratio = 2.5
                }
               
              }
  
            BearishValidated = true;
            console.log("pattern -r", patternType)
            return { stopLossPrice, ratio,patternType };
        } 
        else if(isBearishHaramiPattern(lastCandle,prevCandle) && (validateTradeConditionBearish(price, zones.resistance))){
            patternType = "harami";
            stopLossPrice = Math.max(prevCandle[2],lastCandle[2]);
            low = Math.max(lastCandle[3], prevCandle[3]);
            high = stopLossPrice;
            patternFound = true;

            if(neutral){
                ratio = 1.9
             }else {
                if(priceWithinRange) {
                   ratio = 5
                }
               else  if(priceWithinRange2) {
                   ratio = 3.2
                }
                else {
                   ratio = 2.5
                }
               
              }
            console.log("pattern -r", patternType)
            BearishValidated = true;
            return { stopLossPrice, ratio ,patternType};
        }
        else {
            console.log("Pattern not recognized");
            return { stopLossPrice: null, ratio: null,patternType:null };
        }

    } else {
        console.log("Pattern not found");
        return { stopLossPrice: null,  ratio: null,patternType:null};
    }
};
