import { Status } from "./model.js";

export let trend;
export const findTrend = async () => {
  try {
    const status = await Status.findOne();
    const currentBias = status?.trendStatus?.currentBias;
    trend = "bearish";
  } catch (error) {
    console.error("Error finding trend:", error);
  }
};
