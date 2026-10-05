export const MAX_MESSAGE_CACHE_SIZE = 300;
export const MTIME_THROTTLE_MS = 1000;
export const PAIRING_DELAY_MS = 3000;

export const MAX_FETCH_BYTES = 20 * 1024 * 1024;

export const MAX_CONVERT_INPUT_BYTES = 50 * 1024 * 1024;
export const MAX_CONVERT_OUTPUT_BYTES = 64 * 1024 * 1024;
export const CONVERT_TIMEOUT_MS = Number(process.env.PIXELYTE_CONVERT_TIMEOUT_MS || 180_000);
