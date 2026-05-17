/**
 * SessionContext — Background-Safe Implementation
 *
 * The core problem with setInterval for a safety app:
 *   - iOS throttles JS timers to ~1/min when backgrounded.
 *   - Android kills the JS thread entirely after ~1 min without a foreground service.
 *
 * Solution: Never store driveSeconds as a running counter.
 * Instead, store the session START TIMESTAMP and compute elapsed time
 * from (Date.now() - startedAt) on every tick. This is accurate across
 * process kills, sleep, and background transitions.
 *
 * The foreground ticker (1s interval) only drives UI updates.
 * Background GPS and check-in scheduling are handled by backgroundTasks.js.
 */
import React, {
  createContext, useContext, useReducer, useRef, useCallback, useEffect,
} from 'react';
import { AppState } from 'react-native';
import { scoreToState, getCheckinIntervalMs, shouldHardLock } from '../utils/fatigueUtils';
import {
  startBackgroundLocation, stopBackgroundLocation,
  scheduleCheckinNotification, cancelCheckinNotification,
  persistSessionMeta, clearSessionMeta, KEYS,
} from '../services/backgroundTasks';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── State Shape ──────────────────────────────────────────────────────────────
const INITIAL_STATE = {
  sessionId:     null,
  vehicleId:     null,
  languagePref:  'hi',
  isActive:      false,
  startedAt:     null,   // epoch ms — source of truth for elapsed time
  driveSeconds:  0,      // derived; recomputed from startedAt on each tick
  fatigueScore:  1,
  fatigueState:  'safe',
  nextCheckinAt: null,   // epoch ms when next check-in fires
  checkinDue:    false,
  dangerBubble:  false,
  hardLocked:    false,
  suggestedPoi:  null,
  lastCheckinAt: null,
  streakDay:     0,
  safetyPoints:  0,
};

// ─── Actions ──────────────────────────────────────────────────────────────────
export const Actions = {
  START_SESSION:  'START_SESSION',
  END_SESSION:    'END_SESSION',
  TICK:           'TICK',           // updates driveSeconds from startedAt
  CHECKIN_DUE:    'CHECKIN_DUE',
  CHECKIN_RESULT: 'CHECKIN_RESULT',
  CLEAR_CHECKIN:  'CLEAR_CHECKIN',
  REST_CLEARED:   'REST_CLEARED',
  SET_LANGUAGE:   'SET_LANGUAGE',
  SET_VEHICLE_ID: 'SET_VEHICLE_ID',
};

// ─── Reducer ──────────────────────────────────────────────────────────────────
function sessionReducer(state, { type, payload }) {
  switch (type) {
    case Actions.START_SESSION: {
      const now          = Date.now();
      const intervalMs   = getCheckinIntervalMs(0);
      return {
        ...INITIAL_STATE,
        isActive:      true,
        sessionId:     payload.sessionId,
        vehicleId:     payload.vehicleId ?? state.vehicleId,
        languagePref:  state.languagePref,
        startedAt:     now,
        driveSeconds:  0,
        nextCheckinAt: now + intervalMs,
        streakDay:     state.streakDay,
        safetyPoints:  state.safetyPoints,
      };
    }

    case Actions.END_SESSION:
      return { ...state, isActive: false, dangerBubble: false, checkinDue: false, startedAt: null };

    case Actions.TICK: {
      // Recompute from wall clock — immune to timer drift and background pauses
      const driveSeconds  = Math.floor((Date.now() - state.startedAt) / 1000);
      const checkinDue    = state.nextCheckinAt !== null && Date.now() >= state.nextCheckinAt;
      const hardLocked    = shouldHardLock(driveSeconds);
      return {
        ...state,
        driveSeconds,
        checkinDue:  checkinDue || state.checkinDue,
        hardLocked:  hardLocked || state.hardLocked,
      };
    }

    case Actions.CHECKIN_RESULT: {
      const { fatigue_score, suggested_poi, danger_bubble_active } = payload;
      const driveSeconds  = Math.floor((Date.now() - state.startedAt) / 1000);
      const intervalMs    = getCheckinIntervalMs(driveSeconds);
      const pointsEarned  = fatigue_score <= 5 ? 10 : 0;
      return {
        ...state,
        fatigueScore:  fatigue_score,
        fatigueState:  scoreToState(fatigue_score),
        dangerBubble:  danger_bubble_active ?? false,
        suggestedPoi:  suggested_poi ?? null,
        checkinDue:    false,
        lastCheckinAt: new Date().toISOString(),
        safetyPoints:  state.safetyPoints + pointsEarned,
        nextCheckinAt: Date.now() + intervalMs,
      };
    }

    case Actions.CHECKIN_DUE:
      return { ...state, checkinDue: true };

    case Actions.CLEAR_CHECKIN:
      return { ...state, checkinDue: false };

    case Actions.REST_CLEARED:
      return { ...state, hardLocked: false, fatigueScore: 1, fatigueState: 'safe' };

    case Actions.SET_LANGUAGE:
      return { ...state, languagePref: payload.lang };

    case Actions.SET_VEHICLE_ID:
      return { ...state, vehicleId: payload.vehicleId };

    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────
const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [session, dispatch] = useReducer(sessionReducer, INITIAL_STATE);
  const tickRef    = useRef(null);
  const appState   = useRef(AppState.currentState);

  // ── Foreground tick (UI only) ──────────────────────────────────────────────
  const startDriveTimer = useCallback(async ({ sessionId, vehicleId, nextCheckinAt }) => {
    // Persist to AsyncStorage so background tasks can read it
    await persistSessionMeta({ sessionId, vehicleId, score: 1, nextCheckinAt: new Date(nextCheckinAt) });

    // Schedule first check-in notification
    await scheduleCheckinNotification(nextCheckinAt - Date.now());

    // Start foreground GPS + background task
    await startBackgroundLocation();

    // 1-second UI ticker — only updates driveSeconds display
    tickRef.current = setInterval(() => dispatch({ type: Actions.TICK }), 1000);
  }, []);

  const stopDriveTimer = useCallback(async () => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    await stopBackgroundLocation();
    await cancelCheckinNotification();
    await clearSessionMeta();
  }, []);

  // ── Sync AsyncStorage when score changes (background task needs it) ─────────
  useEffect(() => {
    if (!session.isActive) return;
    AsyncStorage.setItem(KEYS.FATIGUE_SCORE, String(session.fatigueScore)).catch(() => {});
  }, [session.fatigueScore, session.isActive]);

  // ── Reschedule check-in notification when nextCheckinAt changes ────────────
  useEffect(() => {
    if (!session.isActive || !session.nextCheckinAt) return;
    const delay = session.nextCheckinAt - Date.now();
    if (delay > 0) scheduleCheckinNotification(delay).catch(() => {});
  }, [session.nextCheckinAt, session.isActive]);

  // ── Re-sync timer on app foreground (catches background drift) ────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        if (session.isActive) dispatch({ type: Actions.TICK });
      }
      appState.current = nextState;
    });
    return () => sub.remove();
  }, [session.isActive]);

  return (
    <SessionContext.Provider value={{ session, dispatch, startDriveTimer, stopDriveTimer }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within <SessionProvider>');
  return ctx;
}
