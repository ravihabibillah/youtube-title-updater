type YouTubeErrorShape = {
  errors?: Array<{ reason?: string }>;
  response?: { data?: { error?: { errors?: Array<{ reason?: string }> } } };
};

export function youtubeErrorReason(error: unknown): string | undefined {
  const value = error as YouTubeErrorShape;
  return value.response?.data?.error?.errors?.[0]?.reason ?? value.errors?.[0]?.reason;
}

export function isYoutubeQuotaError(error: unknown): boolean {
  return ["quotaExceeded", "rateLimitExceeded", "dailyLimitExceeded"].includes(youtubeErrorReason(error) ?? "");
}

export function youtubeErrorMessage(error: unknown): string {
  const reason = youtubeErrorReason(error);
  if (isYoutubeQuotaError(error)) return "Kuota YouTube Data API hari ini habis. Coba lagi setelah kuota direset.";
  if (reason === "authError" || reason === "youtubeSignupRequired") return "Otorisasi YouTube kedaluwarsa. Hubungkan ulang channel.";
  return "Permintaan YouTube gagal. Coba muat ulang video.";
}
