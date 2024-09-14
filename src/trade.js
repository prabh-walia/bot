import { binance } from "./binanceClient.js";
import { SYMBOL } from "./config.js";
import { initWebSocket, getCurrentPrice, onPriceUpdate, closeWebSocket } from "./websocket.js"
import { TaskManager } from "./TaskManager.js";
import Trade from "./model.js";
const taskManager = new TaskManager();

export const placeOrder = async (symbol, side, amount, stopLossPrice, takeProfitPrice) => {
    console.log("take prfit price -",takeProfitPrice);
    const currentPrice = parseFloat(getCurrentPrice());
    const taskId = `placeOrder-${symbol}-${side}-${amount}`;
    taskManager.addTask(taskId, "Placing primary order ");

    try {
        // Place the primary market order
        const primaryOrder = await binance.createOrder(symbol, 'market', side, amount);
        taskManager.updateTaskStatus(taskId, "executed");
        console.log('Primary market order executed');
        let tradeId = primaryOrder.id
        const trade = new Trade({
            tradeId: tradeId,
            symbol,
            side,
            amount,
            entryPrice: currentPrice,
    
        });
        await trade.save();
        console.log('Trade saved:', trade);
         let slSide= side =="buy"?"sell":"buy"
        // Place stop loss order
        const stopLossOrder = await binance.createOrder(symbol, 'STOP_MARKET', slSide, amount, undefined, {
            'stopPrice': stopLossPrice
        });
        taskManager.updateTaskStatus(taskId, "stop loss order placed");

        console.log('Stop loss order created'); 

        // Place take profit order
        const takeProfitOrder = await binance.createOrder(symbol, 'TAKE_PROFIT_MARKET', slSide, amount, undefined, {
            'stopPrice': takeProfitPrice
        });
        taskManager.updateTaskStatus(taskId, "take profit order placed");

        console.log('Take profit order created:');

        return {  stopLossOrder, takeProfitOrder ,currentPrice,tradeId};

    } catch (error) {
        console.error('Error creating orders:', error);
        taskManager.updateTaskStatus(taskId, "failed", error.message);
        taskManager.retryTask(taskId, () => placeOrder(symbol, side, amount, stopLossPrice, takeProfitPrice));
 
    }
};

export const monitorOrders = async (symbol, stopLossOrderId, takeProfitOrderId, entry, sl, side, amount,tradeId) => {
    let stopLossAdjusted = false;
    let secondLossAdjusted = false;
    const retries = 5; // Set a retry limit
    const monitorTaskId = `monitorOrders-${symbol}`;
    taskManager.addTask(monitorTaskId, `Monitoring orders for ${symbol}`);
    try {
        while (true) {
            for (let i = 0; i < retries; i++) {
                try {
                    // Fetch the status of the stop loss and take profit orders
                    const stopLossOrderStatus = await binance.fetchOrder(stopLossOrderId, symbol);
                    const takeProfitOrderStatus = await binance.fetchOrder(takeProfitOrderId, symbol);
                 
                    const currentPrice = parseFloat(getCurrentPrice());
                    // Log current order statuses
                    
                    // Check if either order is filled
                    if (stopLossOrderStatus.status === 'closed') {
                        console.log('Stop loss order filled. Cancelling take profit order...');
                        await binance.cancelOrder(takeProfitOrderId, symbol);
                        console.log('Take profit order cancelled');
                        taskManager.updateTaskStatus(monitorTaskId, "stop loss filled and tp order cancelled");

                        const trade = await Trade.findOne({ tradeId: tradeId });
                        if (trade) {
                            trade.stopLossFilledTime = new Date(); // Set stop loss filled time
                            trade.status = "closed"; // Update status to closed
                            trade.stopLossPrice = stopLossOrderStatus.price; 
                            trade.takeProfitFilledTime = null; // Reset take profit filled time
                            trade.takeProfitPrice = null;
                            trade.result = "loss"// Set stop loss price
                            await trade.save();
                            console.log('Trade updated with stop loss execution:', trade);
                        }
                        return ["loss", stopLossOrderStatus.price];
                    } else if (takeProfitOrderStatus.status === 'closed') {
                        console.log('Take profit order filled. Cancelling stop loss order...');
                        await binance.cancelOrder(stopLossOrderId, symbol);
                        console.log('Stop loss order cancelled');
                        const trade = await Trade.findOne({ tradeId: tradeId });
                        if (trade) {
                            trade.takeProfitFilledTime = new Date(); // Set take profit filled time
                            trade.status = "closed"; // Update status to closed
                            trade.takeProfitPrice = takeProfitOrderStatus.price; 
                            // Set take profit price
                            trade.stopLossFilledTime = null; // Reset stop loss filled time if needed
                            trade.stopLossPrice = null
                            trade.result = "profit"
                            await trade.save();
                            console.log('Trade updated with take profit execution:', trade);
                        }
                        taskManager.updateTaskStatus(monitorTaskId, "take profit executed and sl order cancelled");
                        return ["profit", takeProfitOrderStatus.price];
                    }

       
                    if (side === 'sell') {
                        let Loss = sl - entry;
                        if ((currentPrice < entry - (Loss * 1.095)) ) {
                            if(secondLossAdjusted == false && currentPrice < entry - (Loss * 1.68) && stopLossAdjusted == true){
                                console.log('Price reached 1.8x of loss. Adjusting stop loss again...');
      
                                await binance.cancelOrder(stopLossOrderId, symbol);
                                taskManager.updateTaskStatus(monitorTaskId, "previous sl order cancelled");
                                console.log('Second stop loss order cancelled');

                                const newStopLossPrice = entry + (Loss * 0.05); // Adjusted to 20% more near
                                const slSide = 'buy';

                                const newStopLossOrder = await binance.createOrder(symbol, 'STOP_MARKET', slSide, amount, undefined, {
                                    'stopPrice': newStopLossPrice
                                });

                                secondLossAdjusted = true;
                                taskManager.updateTaskStatus(monitorTaskId, "second sl order created");
                                console.log('Second new stop loss order created', newStopLossPrice);

                                stopLossOrderId = newStopLossOrder.id; // Update the stop loss order ID
                            }
                            else if(stopLossAdjusted == false){
                                console.log('Price reached partial take profit threshold. Adjusting stop loss...');
                                await binance.cancelOrder(stopLossOrderId, symbol);
                                taskManager.updateTaskStatus(monitorTaskId, "previous sl trail order cancelled");
                                console.log('Current stop loss order cancelled');
    
                                const newStopLossPrice = entry + (Loss * 0.25);
                                const slSide = 'buy';
    
                                const newStopLossOrder = await binance.createOrder(symbol, 'STOP_MARKET', slSide, amount, undefined, {
                                    'stopPrice': newStopLossPrice
                                });
                                taskManager.updateTaskStatus(monitorTaskId, "new sl order created");
                                stopLossAdjusted = true;
                                console.log('New stop loss order created', newStopLossPrice);
    
                                stopLossOrderId = newStopLossOrder.id; // Update the stop loss order ID
                            }
                        }
                    } else {
                        let Loss = entry - sl;
                        if ((currentPrice > entry + (Loss * 1.095)) ) {
                            if(currentPrice > entry + (Loss * 1.68) && secondLossAdjusted == false && stopLossAdjusted == true){
                                console.log('Price reached 1.8x of loss. Adjusting stop loss again...');
                                await binance.cancelOrder(stopLossOrderId, symbol);
                                console.log('Second stop loss order cancelled');
                                taskManager.updateTaskStatus(monitorTaskId, "previous sl order cancelled");
                                const newStopLossPrice = entry - (Loss * 0.05); // Adjusted to 20% more near
                                const slSide = 'sell';
    
                                const newStopLossOrder = await binance.createOrder(symbol, 'STOP_MARKET', slSide, amount, undefined, {
                                    'stopPrice': newStopLossPrice
                                });
                                taskManager.updateTaskStatus(monitorTaskId, "second sl order created");
                                secondLossAdjusted = true;
                                console.log('Second new stop loss order created', newStopLossPrice);
    
                                stopLossOrderId = newStopLossOrder.id; // Update the stop loss order ID
                            }
                            else if(stopLossAdjusted == false){
                                console.log('Price reached partial take profit threshold. Adjusting stop loss...');
                                await binance.cancelOrder(stopLossOrderId, symbol);
                                console.log('Current stop loss order cancelled');
                                taskManager.updateTaskStatus(monitorTaskId, "previous sl trail order cancelled");
                                const newStopLossPrice = entry - (Loss * 0.25);
                                const slSide = 'sell';
    
                                const newStopLossOrder = await binance.createOrder(symbol, 'STOP_MARKET', slSide, amount, undefined, {
                                    'stopPrice': newStopLossPrice
                                });
                                taskManager.updateTaskStatus(monitorTaskId, "new sl order created");
                                stopLossAdjusted = true;
                                console.log('New stop loss order created', newStopLossPrice);
    
                                stopLossOrderId = newStopLossOrder.id; // Update the stop loss order ID
                            }
                        }
                    }

                    break; // Exit retry loop if successful
                } catch (error) {
                    if (i < retries - 1) {
                        console.warn(`Retry ${i + 1} for monitoring orders failed:`, error.message);
                        await new Promise(resolve => setTimeout(resolve, (i + 1) * 1300)); // Exponential backoff
                    } else {
                        console.error('Error monitoring orders after retries:', error);
                        taskManager.updateTaskStatus(monitorTaskId, "failed", error.message);
                      
                        throw error;
                    }
                }
            }

            // Wait before checking again
            await new Promise(resolve => setTimeout(resolve, 2000)); // Check every 2 seconds
        }
    } catch (error) {
        console.error('Final Error monitoring orders:', error.message);
        taskManager.updateTaskStatus(monitorTaskId, "failed", error.message);
        throw error;
    }

};



export const displayTaskStatus = () => {
    const tasks = taskManager.getAllTasks();
    console.log("Task Status Overview:");
    for (const [taskId, task] of Object.entries(tasks)) {
        console.log(`Task ID: ${taskId}`);
        console.log(`  Description: ${task.description}`);
        console.log(`  Status: ${task.status}`);
        if (task.error) {
            console.log(`  Error: ${task.error}`);
        }
        console.log(); // Blank line for readability
    }
};