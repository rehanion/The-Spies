// Upload and quota limits. Every value can be overridden with an environment
// variable so operators can tighten limits without code changes. Defaults are
// deliberately below the Supabase Free plan quotas (1 GB storage, 50 MB max
// object size) so SPIES stops accepting uploads before a provider quota is hit.

export interface Limits {
  maxTemplateFileBytes: number;
  maxFilesPerTemplate: number;
  maxScreenshotBytes: number;
  maxScreenshotsPerTemplate: number;
  maxScreenshotPixels: number;
  maxAvatarBytes: number;
  previewMaxWidth: number;
  thumbWidth: number;
  maxZipEntries: number;
  maxZipTotalUncompressedBytes: number;
  maxZipCompressionRatio: number;
  maxZipPathDepth: number;
  perUserStorageBytes: number;
  perUserDailyUploads: number;
  perUserDailySubmissions: number;
  platformStorageSoftLimitBytes: number;
}

const MB = 1024 * 1024;

export const DEFAULT_LIMITS: Limits = {
  maxTemplateFileBytes: 20 * MB,
  maxFilesPerTemplate: 5,
  maxScreenshotBytes: 8 * MB,
  maxScreenshotsPerTemplate: 8,
  maxScreenshotPixels: 4096 * 4096,
  maxAvatarBytes: 2 * MB,
  previewMaxWidth: 1920,
  thumbWidth: 640,
  maxZipEntries: 200,
  maxZipTotalUncompressedBytes: 100 * MB,
  maxZipCompressionRatio: 100,
  maxZipPathDepth: 8,
  perUserStorageBytes: 150 * MB,
  perUserDailyUploads: 40,
  perUserDailySubmissions: 5,
  // Supabase Free includes 1 GB of storage; stop at 800 MB to leave headroom.
  platformStorageSoftLimitBytes: 800 * MB,
};

const ENV_KEYS: Record<keyof Limits, string> = {
  maxTemplateFileBytes: "LIMIT_MAX_TEMPLATE_FILE_BYTES",
  maxFilesPerTemplate: "LIMIT_MAX_FILES_PER_TEMPLATE",
  maxScreenshotBytes: "LIMIT_MAX_SCREENSHOT_BYTES",
  maxScreenshotsPerTemplate: "LIMIT_MAX_SCREENSHOTS_PER_TEMPLATE",
  maxScreenshotPixels: "LIMIT_MAX_SCREENSHOT_PIXELS",
  maxAvatarBytes: "LIMIT_MAX_AVATAR_BYTES",
  previewMaxWidth: "LIMIT_PREVIEW_MAX_WIDTH",
  thumbWidth: "LIMIT_THUMB_WIDTH",
  maxZipEntries: "LIMIT_MAX_ZIP_ENTRIES",
  maxZipTotalUncompressedBytes: "LIMIT_MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES",
  maxZipCompressionRatio: "LIMIT_MAX_ZIP_COMPRESSION_RATIO",
  maxZipPathDepth: "LIMIT_MAX_ZIP_PATH_DEPTH",
  perUserStorageBytes: "LIMIT_PER_USER_STORAGE_BYTES",
  perUserDailyUploads: "LIMIT_PER_USER_DAILY_UPLOADS",
  perUserDailySubmissions: "LIMIT_PER_USER_DAILY_SUBMISSIONS",
  platformStorageSoftLimitBytes: "LIMIT_PLATFORM_STORAGE_SOFT_LIMIT_BYTES",
};

// Hard ceilings: values above these are clamped because the provider would
// reject them anyway (Supabase Free: 50 MB per object, bucket limit 20 MB).
const HARD_MAX: Partial<Record<keyof Limits, number>> = {
  maxTemplateFileBytes: 20 * MB,
  maxScreenshotBytes: 20 * MB,
  maxAvatarBytes: 5 * MB,
  platformStorageSoftLimitBytes: 950 * MB,
};

export function readLimits(env: Record<string, string | undefined>): Limits {
  const out = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(ENV_KEYS) as (keyof Limits)[]) {
    const raw = env[ENV_KEYS[key]];
    if (raw === undefined || raw.trim() === "") continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) continue;
    const ceiling = HARD_MAX[key];
    out[key] = ceiling !== undefined ? Math.min(n, ceiling) : n;
  }
  return out;
}
