import PQueue from "p-queue";

// Max 5 concurrent registry calls to respect upstream rate limits
export const registryQueue: PQueue = new PQueue({ concurrency: 5 });
