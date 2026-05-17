// ─── Fatigue State Logic ──────────────────────────────────────────────────────

/** Score 1–10 → named state */
export function scoreToState(score) {
  if (score <= 5) return 'safe';
  if (score <= 7) return 'warning';
  if (score <= 9) return 'danger';
  return 'critical';
}

/**
 * Adaptive check-in interval based on hours driven.
 * @param {number} driveSeconds - elapsed drive time in seconds
 * @returns {number} interval in milliseconds
 */
export function getCheckinIntervalMs(driveSeconds) {
  const hours = driveSeconds / 3600;
  if (hours < 4) return 45 * 60 * 1000;  // 45 min
  if (hours < 8) return 30 * 60 * 1000;  // 30 min
  return 15 * 60 * 1000;                  // 15 min
}

/** Format seconds → HH:MM:SS */
export function formatDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

/** Format milliseconds countdown → MM:SS */
export function formatCountdown(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Whether a 12h hard-lock should trigger */
export function shouldHardLock(driveSeconds) {
  return driveSeconds >= 12 * 3600;
}
