export class TaskManager {
    constructor() {
        this.tasks = {};
    }

    addTask(taskId, description) {
        this.tasks[taskId] = { status: "pending", description };
        console.log(`Task added: ${taskId} - ${description}`);
    }

    updateTaskStatus(taskId, status, error = null) {
        if (this.tasks[taskId]) {
            this.tasks[taskId].status = status;
            if (error) {
                this.tasks[taskId].error = error;
            }
            console.log(`Task updated: ${taskId} - ${status}`);
        }
    }

    getTaskStatus(taskId) {
        return this.tasks[taskId]?.status || "not found";
    }

    getPendingTasks() {
        return Object.entries(this.tasks).filter(([_, task]) => task.status === "pending");
    }

    retryTask(taskId, retryFn, maxRetries = 3) {
        let retries = 0;
        const retryInterval = 1000; // 

        const retry = async () => {
            if (retries >= maxRetries) {
                this.updateTaskStatus(taskId, "failed", "Max retries reached");
                console.error(`Task failed after ${maxRetries} retries: ${taskId}`);
                return;
            }
            try {
                console.log(`Retrying task ${taskId}, attempt ${retries + 1}`);
                await retryFn();
                this.updateTaskStatus(taskId, "executed");
            } catch (error) {
                retries++;
                console.warn(`Retry ${retries} for task ${taskId} failed:`, error.message);
                setTimeout(retry, retryInterval * (retries + 1)); // Exponential backoff
            }
        };

        retry();
    }
    getAllTasks() {
        return this.tasks;
    }
}
