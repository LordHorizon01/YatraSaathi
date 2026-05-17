/**
 * BackgroundService.js — Drive Session Lifecycle Manager
 *
 * Handles:
 *   - Persistent foreground notification (Android 14/15 compliance)
 *   - Headless JS audio submission task (survives UI process kill)
 *   - Drive metadata persistence to AsyncStorage
 *
 * NOTE: The actual mic recording flow (runCheckinFlow) lives in CheckinScreen.js
 * because it requires React hooks (useAudioRecorder). This file only handles
 * the non-UI parts that SessionContext needs at startup.
 */

import * as Notifications from 'expo-notifications';
import * as TaskManager   from 'expo-task-manager';
import AsyncStorage       from '@react-native-async-storage/async-storage';
import { KEYS, scheduleCheckinNotification, cancelCheckinNotification } from './backgroundTasks';
import { analyzeVoice }   from './api';
import { getCheckinIntervalMs } from '../utils/fatigueUtils';

// ─── Task Name ─────────────────────────────────────────────────────────────────
export const TASK_VOICE_SUBMISSION = 'saarthi-voice-submission';

// ─── Headless JS: Audio Submission Task ───────────────────────────────────────
// Wrapped in try-catch: TaskManager.defineTask crashes in Expo Go.
try {
  TaskManager.defineTask(TASK_VOICE_SUBMISSION, async () => {
    try {
      const [uri, sessionId, vehicleId, questionText, lang, latencyStr] =
        await AsyncStorage.multiGet([
          'saarthi:pending_audio_uri',
          KEYS.SESSION_ID,
          KEYS.VEHICLE_ID,
          'saarthi:pending_question',
          'saarthi:pending_lang',
          'saarthi:pending_latency_ms',
        ]).then(pairs => pairs.map(([, v]) => v));

      if (!uri || !sessionId || !vehicleId) return;

      await analyzeVoice({
        audioUri:     uri,
        sessionId,
        vehicleId,
        latencyMs:    parseInt(latencyStr ?? '0', 10),
        questionText: questionText ?? '',
        lang:         lang ?? 'hi',
      });

      await AsyncStorage.multiRemove([
        'saarthi:pending_audio_uri',
        'saarthi:pending_question',
        'saarthi:pending_lang',
        'saarthi:pending_latency_ms',
      ]);
    } catch (err) {
      console.error('[Saarthi] Voice submission task failed:', err.message);
    }
  });
} catch (_) {
  console.warn('[Saarthi] TaskManager not available (Expo Go). Headless submission disabled.');
}

// ─── Persistent Foreground Notification ───────────────────────────────────────
// Required on Android 14+ to prevent the OS from killing background services.
async function showDriveNotification(label = 'Drive active') {
  try {
    await Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: false,
        shouldPlaySound: false,
        shouldSetBadge:  false,
      }),
    });

    await Notifications.scheduleNotificationAsync({
      identifier: 'saarthi-drive-service',
      content: {
        title: '🛡 Saarthi AI — Co-driver Active',
        body:  label,
        sticky: true,
        data:   { type: 'foreground-service' },
      },
      trigger: null,
    });
  } catch (err) {
    console.warn('[Saarthi] Failed to show drive notification:', err.message);
  }
}

async function dismissDriveNotification() {
  try {
    await Notifications.dismissNotificationAsync('saarthi-drive-service');
  } catch (_) {}
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Called by SessionContext when a drive session starts.
 * Sets up the persistent notification and schedules the first check-in.
 */
export async function initDriveService({ sessionId, vehicleId, lang = 'hi' }) {
  await AsyncStorage.multiSet([
    [KEYS.SESSION_ID,  sessionId],
    [KEYS.VEHICLE_ID,  vehicleId],
    ['saarthi:lang',   lang],
    ['saarthi:drive_started_at', String(Date.now())],
  ]);

  await showDriveNotification('Your co-driver is watching. Drive safe.');

  // Schedule first check-in
  const firstIntervalMs = getCheckinIntervalMs(0);
  await AsyncStorage.setItem(KEYS.NEXT_CHECKIN_AT, String(Date.now() + firstIntervalMs));
  await scheduleCheckinNotification(firstIntervalMs);
}

/**
 * Called by SessionContext when a drive session ends.
 */
export async function teardownDriveService() {
  await dismissDriveNotification();
  await cancelCheckinNotification();
  await AsyncStorage.multiRemove([
    KEYS.SESSION_ID, KEYS.VEHICLE_ID, KEYS.NEXT_CHECKIN_AT,
    'saarthi:lang', 'saarthi:drive_started_at',
    'saarthi:pending_audio_uri', 'saarthi:pending_question',
    'saarthi:pending_lang', 'saarthi:pending_latency_ms',
  ]);
}
