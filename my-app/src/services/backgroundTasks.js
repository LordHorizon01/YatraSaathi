/**
 * Background Tasks — registered ONCE at app boot (before any navigator renders).
 *
 * Strategy:
 *  1. GPS is tracked via expo-location's background task (OS keeps it alive).
 *  2. Check-in scheduling uses expo-notifications with a scheduled local notification
 *     that fires even when the app is backgrounded — tapping it foregrounds the app
 *     and opens CheckinScreen.
 *  3. The drive *elapsed time* is never stored as a running counter; instead we
 *     persist the session start timestamp and recompute on every render.
 *     This survives process kills completely.
 */
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { pushLocation } from './api';

// ─── Task Names (string constants shared between registration & usage) ─────────
export const TASK_BG_LOCATION  = 'saarthi-bg-location';

// ─── Keys stored in AsyncStorage ──────────────────────────────────────────────
export const KEYS = {
  SESSION_START:    'saarthi:session_start',    // ISO timestamp
  SESSION_ID:       'saarthi:session_id',
  VEHICLE_ID:       'saarthi:vehicle_id',
  FATIGUE_SCORE:    'saarthi:fatigue_score',
  NEXT_CHECKIN_AT:  'saarthi:next_checkin_at',  // ISO timestamp of next due check-in
};

// ─── Background Location Task ─────────────────────────────────────────────────
// The OS calls this even when the screen is off. We use it to:
//   a) Keep the geo-index updated in Redis.
//   b) Check if a scheduled check-in is now overdue.
TaskManager.defineTask(TASK_BG_LOCATION, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;

  const loc = data.locations[0];
  const [vehicleId, scoreStr, nextCheckinAt] = await Promise.all([
    AsyncStorage.getItem(KEYS.VEHICLE_ID),
    AsyncStorage.getItem(KEYS.FATIGUE_SCORE),
    AsyncStorage.getItem(KEYS.NEXT_CHECKIN_AT),
  ]);

  if (!vehicleId) return;

  const score = parseInt(scoreStr ?? '1', 10);

  // Push location to Redis (best-effort; silently fails offline)
  await pushLocation(vehicleId, loc.coords.latitude, loc.coords.longitude, score).catch(() => {});
});

// ─── Public API ───────────────────────────────────────────────────────────────

/** Start background GPS tracking. Call when drive session begins. */
export async function startBackgroundLocation() {
  try {
    // Android requires Foreground permission BEFORE Background permission can be requested
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') {
      console.warn('[Saarthi] Foreground location denied.');
      return;
    }

    const { status } = await Location.requestBackgroundPermissionsAsync();
    if (status !== 'granted') {
      console.warn('[Saarthi] Background location denied — GPS updates will pause when screen is off.');
      return;
    }
    const already = await Location.hasStartedLocationUpdatesAsync(TASK_BG_LOCATION).catch(() => false);
    if (!already) {
      await Location.startLocationUpdatesAsync(TASK_BG_LOCATION, {
        accuracy:               Location.Accuracy.Balanced,
        distanceInterval:       50,      // metres
        timeInterval:           5_000,   // ms
        showsBackgroundLocationIndicator: true,
        foregroundService: {             // Android
          notificationTitle: 'Saarthi AI is watching',
          notificationBody:  'Your co-driver is active. Drive safe.',
          notificationColor: '#00D68F',
        },
      });
    }
  } catch (err) {
    console.warn('[Saarthi] Failed to start background location:', err.message);
  }
}

/** Stop background GPS. Call on session end. */
export async function stopBackgroundLocation() {
  const running = await Location.hasStartedLocationUpdatesAsync(TASK_BG_LOCATION).catch(() => false);
  if (running) {
    await Location.stopLocationUpdatesAsync(TASK_BG_LOCATION);
  }
}

/** Persist session metadata so the background task can read it. */
export async function persistSessionMeta({ sessionId, vehicleId, score, nextCheckinAt }) {
  const pairs = [
    [KEYS.SESSION_ID,      sessionId],
    [KEYS.VEHICLE_ID,      vehicleId],
    [KEYS.FATIGUE_SCORE,   String(score)],
    [KEYS.NEXT_CHECKIN_AT, nextCheckinAt?.toISOString() ?? ''],
  ];
  if (!sessionId) pairs.push([KEYS.SESSION_START, new Date().toISOString()]);
  await AsyncStorage.multiSet(pairs);
}

/** Clear all session metadata on drive end. */
export async function clearSessionMeta() {
  await AsyncStorage.multiRemove(Object.values(KEYS));
}

/** Schedule a local notification for the next voice check-in. */
export async function scheduleCheckinNotification(delayMs) {
  await Notifications.cancelAllScheduledNotificationsAsync();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Saarthi Check-in 🎙',
      body:  'Time for your voice check-in. Tap to respond.',
      sound: true,
      data:  { screen: 'Checkin' },
    },
    trigger: { seconds: Math.ceil(delayMs / 1000) },
  });
}

/** Cancel any pending check-in notification. */
export async function cancelCheckinNotification() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}
