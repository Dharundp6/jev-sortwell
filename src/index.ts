/** Library surface. The executable lives in cli.ts. */
export { capture, buildState, buildQuestions, candidates, DUPLICATE_AT, ROUTE_AT } from "./capture.js";
export { shortlist, stateFor, questionsFor, BATCH, type Shortlist } from "./shortlist.js";
export { formatCapture, formatShortlist } from "./format.js";
export { jevAsker, apiKeyFromEnv, noul, choice, score, JevError, SYSTEM_ONE_URL, DEFAULT_MODEL } from "./jev.js";
export {
  addBucket, addItem, closeBucket, markDone, newId, openBuckets, openItems,
  readBuckets, readItems, staleBuckets, storeDir, itemsPath, bucketsPath, unreadableLines,
} from "./store.js";
export { ACTIONS, KINDS, SHELVES } from "./types.js";
export type { Action, Asker, Bucket, Capture, Item, JevQuestion, JevResponse, Kind, Ranked, Shelf } from "./types.js";
