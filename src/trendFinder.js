import { Status } from "./model.js";

export const findTrend = async () => {
  try {
    const status = await Status.findOne();

    const currentBias = status?.trendStatus?.currentBias;
    return currentBias;
  } catch (error) {
    console.error("Error finding trend:", error);
  }
};
