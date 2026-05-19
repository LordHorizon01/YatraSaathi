import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';

import { COLORS, RADIUS, SPACING, STATE_THEME } from '../theme';
import { useSession, Actions } from '../context/SessionContext';
import { formatDuration } from '../utils/fatigueUtils';
import FatigueRing from '../components/FatigueRing';
import DangerOverlay from '../components/DangerOverlay';
import PoiSuggestionPanel from '../components/PoiSuggestionPanel';
import { endSession, pushLocation, connectDangerWS, updateWSPosition } from '../services/api';

const GEO_INTERVAL_MS = 5_000;  // broadcast location every 5s per spec

export default function SessionScreen({ navigation }) {
  const { session, dispatch, stopDriveTimer } = useSession();
  const [nearbyDanger,    setNearbyDanger]    = useState(null);
  const [showDanger,      setShowDanger]      = useState(false);
  const [endConfirm,      setEndConfirm]      = useState(false);
  const [showPoiPanel,    setShowPoiPanel]    = useState(false);
  const [manualDismissed, setManualDismissed] = useState(false);
  // Live GPS position — used for the always-on "Find Rest Stops" button
  const [livePos,         setLivePos]         = useState(null);

  // Score zones:
  //   5-7 → WARNING  → POI panel auto-shows (driver is drowsy but awake)
  //   8-9 → DANGER   → POI panel is MANUAL  (driver might be micro-sleeping; show button instead)
  //  10   → CRITICAL → hard-locked, already handled
  useEffect(() => {
    const score      = session.fatigueScore;
    const hasData    = session.nearbyPois?.length > 0 || session.anchorPos;
    const inWarning  = score >= 5 && score <= 7;
    const inDanger   = score >= 8 && score <= 9;

    if (inWarning && hasData && !manualDismissed) {
      setShowPoiPanel(true);       // auto-open at 5-7
    } else if (!inWarning && !inDanger) {
      setShowPoiPanel(false);      // reset when score improves
      setManualDismissed(false);   // allow re-trigger on next warning
    }
    // At 8-9 we do NOT auto-open — the button below handles it
  }, [session.fatigueScore, session.nearbyPois, session.anchorPos]);

  const geoRef      = useRef(null);
  const locationRef = useRef(null);
  const wsRef       = useRef(null);
  const flashAnim   = useRef(new Animated.Value(0)).current;

  // ─── Location Broadcast + WebSocket Danger Alerts ──────────────────────────
  useEffect(() => {
    let active = true;
    const vid = session.vehicleId || `PHONE-${Date.now()}`;

    // Connect to DangerBubble WebSocket IMMEDIATELY (don't wait for GPS).
    // Register with (0,0) now; update coords when GPS is available.
    console.log('[Saarthi] Connecting WS for', vid);
    try {
      const ws = connectDangerWS(vid, 0, 0);
      wsRef.current = ws;

      ws.onopen  = () => console.log('[Saarthi] WS connected ✅');
      ws.onerror = (e) => console.warn('[Saarthi] WS error:', e.message);

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[Saarthi] WS message received:', data);
          if (data.type === 'danger') {
            setNearbyDanger({ distanceM: data.distance_m, score: data.fatigue_score });
            setShowDanger(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          }
        } catch (_) {}
      };

      ws.onclose = () => {
        console.warn('[Saarthi] WS closed, reconnecting in 3s...');
        if (active) {
          setTimeout(() => {
            if (active) {
              const lat = locationRef.current?.latitude  ?? 0;
              const lng = locationRef.current?.longitude ?? 0;
              const reconnWs = connectDangerWS(vid, lat, lng);
              wsRef.current = reconnWs;
            }
          }, 3000);
        }
      };
    } catch (e) {
      console.warn('[Saarthi] WS init failed:', e.message);
    }

    // GPS location broadcast (best-effort — WS works even without this)
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          console.warn('[Saarthi] Location permission denied — GPS broadcast disabled');
          return;
        }
        const initial = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        locationRef.current = initial.coords;
        // Store live position for the always-on Find Rest Stops button
        if (active) setLivePos({ lat: initial.coords.latitude, lng: initial.coords.longitude });

        // Update WS with real position
        if (wsRef.current) {
          updateWSPosition(wsRef.current, initial.coords.latitude, initial.coords.longitude);
        }

        // Periodic location broadcast to Redis geo-index
        geoRef.current = setInterval(async () => {
          if (!active) return;
          try {
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            locationRef.current = loc.coords;
            if (active) setLivePos({ lat: loc.coords.latitude, lng: loc.coords.longitude });
            await pushLocation(vid, loc.coords.latitude, loc.coords.longitude, session.fatigueScore).catch(() => {});
            if (wsRef.current) updateWSPosition(wsRef.current, loc.coords.latitude, loc.coords.longitude);
          } catch (_) {}
        }, GEO_INTERVAL_MS);
      } catch (e) {
        console.warn('[Saarthi] GPS setup failed:', e.message);
      }
    })();

    return () => {
      active = false;
      if (geoRef.current) clearInterval(geoRef.current);
      if (wsRef.current) {
        try { wsRef.current.close(); } catch (_) {}
        wsRef.current = null;
      }
    };
  }, [session.vehicleId]);

  // ─── Auto-navigate to Check-in when due ─────────────────────────────────────
  useEffect(() => {
    if (session.checkinDue && !session.hardLocked) {
      navigation.navigate('Checkin');
    }
  }, [session.checkinDue]);

  // ─── Danger state screen flash ──────────────────────────────────────────────
  useEffect(() => {
    if (session.fatigueState === 'danger' || session.fatigueState === 'critical') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(flashAnim, { toValue: 1, duration: 600, useNativeDriver: false }),
          Animated.timing(flashAnim, { toValue: 0, duration: 600, useNativeDriver: false }),
        ]),
      ).start();
    } else {
      flashAnim.setValue(0);
    }
  }, [session.fatigueState]);

  // ─── Next check-in countdown (derived from epoch) ──────────────────────────
  const nextCheckinCountdown = session.nextCheckinAt
    ? Math.max(0, Math.ceil((session.nextCheckinAt - Date.now()) / 1000))
    : 0;

  const formatCountdownDisplay = (totalSec) => {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // ─── End Drive ──────────────────────────────────────────────────────────────
  const handleEndDrive = useCallback(async () => {
    if (!endConfirm) { setEndConfirm(true); return; }
    await stopDriveTimer();
    if (geoRef.current) clearInterval(geoRef.current);
    if (wsRef.current) { try { wsRef.current.close(); } catch (_) {} }
    await endSession(session.sessionId).catch(() => {});
    dispatch({ type: Actions.END_SESSION });
    navigation.replace('Dashboard');
  }, [endConfirm, session.sessionId]);

  const borderColor = flashAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [COLORS.bg, COLORS.danger],
  });

  const stateTheme = STATE_THEME[session.fatigueState] ?? STATE_THEME.safe;

  return (
    <SafeAreaView style={styles.safe}>
      <Animated.View style={[styles.container, { borderWidth: 2, borderColor }]}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={[styles.stateDot, { backgroundColor: stateTheme.color }]} />
            <Text style={[styles.stateText, { color: stateTheme.color }]}>{stateTheme.label}</Text>
            <Text style={styles.stateHindi}>{stateTheme.labelHi}</Text>
          </View>

          {/* Drive Timer */}
          <Text style={styles.driveTimer}>{formatDuration(session.driveSeconds)}</Text>
          <Text style={styles.driveLabel}>Drive Duration</Text>

          {/* Fatigue Ring */}
          <View style={styles.ringArea}>
            <FatigueRing score={session.fatigueScore} state={session.fatigueState} size={180} />
          </View>

          {/* Next Check-in Countdown */}
          {!session.hardLocked && (
            <View style={styles.countdownCard}>
              <Text style={styles.countdownLabel}>Next Check-in</Text>
              <Text style={styles.countdownTimer}>{formatCountdownDisplay(nextCheckinCountdown)}</Text>
            </View>
          )}

          {/* Always-visible "Find Rest Stops" button — uses live GPS, works at ANY score */}
          {!showPoiPanel && (
            <Pressable
              style={[
                styles.findRestBtn,
                // Red tint at high fatigue, amber at warning, subtle at safe
                session.fatigueScore >= 8
                  ? { borderColor: COLORS.danger, backgroundColor: 'rgba(255,69,58,0.12)', shadowColor: COLORS.danger }
                  : session.fatigueScore >= 5
                  ? { borderColor: COLORS.warning, backgroundColor: 'rgba(255,176,32,0.10)', shadowColor: COLORS.warning }
                  : { borderColor: COLORS.border, backgroundColor: COLORS.surface, shadowOpacity: 0 },
              ]}
              onPress={() => {
                setManualDismissed(false);
                setShowPoiPanel(true);
              }}
            >
              <Text style={styles.findRestBtnIcon}>🍛</Text>
              <View style={{ flex: 1 }}>
                <Text style={[
                  styles.findRestBtnTitle,
                  session.fatigueScore >= 8
                    ? { color: COLORS.danger }
                    : session.fatigueScore >= 5
                    ? { color: COLORS.warning }
                    : { color: COLORS.textSecondary },
                ]}>
                  Find Rest Stops Nearby
                </Text>
                <Text style={styles.findRestBtnSub}>Dhabas • Hotels • Restaurants</Text>
              </View>
              <Text style={[
                styles.findRestBtnArrow,
                session.fatigueScore >= 8 ? { color: COLORS.danger }
                  : session.fatigueScore >= 5 ? { color: COLORS.warning }
                  : { color: COLORS.textMuted },
              ]}>›</Text>
            </Pressable>
          )}

          {/* POI Suggestion Panel — auto at 5-7, manual at 8-9, or user-triggered */}
          {showPoiPanel && (
            <PoiSuggestionPanel
              anchorLat={session.anchorPos?.lat ?? livePos?.lat ?? null}
              anchorLng={session.anchorPos?.lng ?? livePos?.lng ?? null}
              initialPois={session.nearbyPois?.length ? session.nearbyPois : []}
              onDismiss={() => {
                setShowPoiPanel(false);
                setManualDismissed(true);
              }}
            />
          )}

          {/* Legacy single-POI card (shown only when panel is hidden & not in danger zone) */}
          {!showPoiPanel && session.fatigueScore < 8 && session.suggestedPoi && (
            <View style={[styles.poiCard, { borderColor: COLORS.warning }]}>
              <Text style={styles.poiIcon}>☕️</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.poiName}>{session.suggestedPoi.name}</Text>
                <Text style={styles.poiDist}>
                  {session.suggestedPoi.distance_m >= 1000
                    ? `${(session.suggestedPoi.distance_m / 1000).toFixed(1)} km ahead`
                    : `${session.suggestedPoi.distance_m} m ahead`} — Take a break
                </Text>
              </View>
            </View>
          )}

          {/* DangerBubble Active Badge */}
          {session.dangerBubble && (
            <View style={styles.dangerBadge}>
              <Text style={styles.dangerBadgeText}>📡 DangerBubble Active — Alerting nearby drivers</Text>
            </View>
          )}

          {/* Hard Lock */}
          {session.hardLocked && (
            <View style={styles.hardLock}>
              <Text style={styles.hardLockTitle}>🛑 Rest Mandatory</Text>
              <Text style={styles.hardLockBody}>
                You've driven 12+ hours. Park safely and rest for 20 minutes to continue.
              </Text>
            </View>
          )}

          {/* End Drive Button */}
          <Pressable
            style={[styles.endBtn, endConfirm && { backgroundColor: COLORS.danger }]}
            onPress={handleEndDrive}
          >
            <Text style={styles.endBtnText}>
              {endConfirm ? 'Confirm End Drive' : 'End Drive'}
            </Text>
          </Pressable>
          {endConfirm && (
            <Pressable onPress={() => setEndConfirm(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          )}

          {/* DEV ONLY: Instant check-in for testing */}
          {__DEV__ && (
            <Pressable
              style={styles.debugBtn}
              onPress={() => navigation.navigate('Checkin')}
            >
              <Text style={styles.debugBtnText}>🧪 Test Check-in Now</Text>
            </Pressable>
          )}

          {/* DEV ONLY: Simulate a nearby fatigued driver */}
          {__DEV__ && (
            <Pressable
              style={[styles.debugBtn, { borderColor: '#FF4444', marginTop: 8 }]}
              onPress={() => {
                setNearbyDanger({ vehicleId: 'TEST-DRIVER', distanceM: 350, fatigueScore: 9 });
                setShowDanger(true);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              }}
            >
              <Text style={[styles.debugBtnText, { color: '#FF4444' }]}>🚨 Test DangerBubble</Text>
            </Pressable>
          )}
        </ScrollView>
      </Animated.View>

      <DangerOverlay
        visible={showDanger}
        distanceM={nearbyDanger?.distanceM ?? 0}
        onDismiss={() => setShowDanger(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: COLORS.bg },
  container: { flex: 1, borderRadius: 0 },
  scroll:    { flex: 1 },
  scrollContent: {
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },

  header:     { alignItems: 'center', marginBottom: SPACING.lg },
  stateDot:   { width: 10, height: 10, borderRadius: 5, marginBottom: SPACING.xs },
  stateText:  { fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },
  stateHindi: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },

  driveTimer: { fontSize: 52, fontWeight: '800', color: COLORS.textPrimary, letterSpacing: -1, fontVariant: ['tabular-nums'] },
  driveLabel: { fontSize: 12, color: COLORS.textMuted, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: SPACING.xl },

  ringArea: { marginBottom: SPACING.xl },

  countdownCard: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    alignSelf: 'stretch',
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.lg,
  },
  countdownLabel: { fontSize: 13, color: COLORS.textMuted },
  countdownTimer: { fontSize: 20, fontWeight: '700', color: COLORS.textPrimary, fontVariant: ['tabular-nums'] },

  poiCard: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    alignSelf: 'stretch',
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    padding: SPACING.md, borderWidth: 1, marginBottom: SPACING.md,
  },
  poiIcon: { fontSize: 24 },
  poiName: { fontSize: 14, fontWeight: '700', color: COLORS.warning },
  poiDist: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },

  // Manual "Find Rest Stops" button (danger zone 8-9)
  findRestBtn: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255,69,58,0.12)',
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1.5,
    borderColor: COLORS.danger,
    marginBottom: SPACING.md,
    // glow effect via shadow
    shadowColor: COLORS.danger,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 6,
  },
  findRestBtnIcon:  { fontSize: 22 },
  findRestBtnTitle: { fontSize: 14, fontWeight: '800', color: COLORS.danger },
  findRestBtnSub:   { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  findRestBtnArrow: { fontSize: 22, color: COLORS.danger, fontWeight: '700' },

  dangerBadge: {
    backgroundColor: COLORS.dangerDim, borderRadius: RADIUS.full,
    paddingVertical: 8, paddingHorizontal: SPACING.md,
    borderWidth: 1, borderColor: COLORS.danger, marginBottom: SPACING.md,
  },
  dangerBadgeText: { fontSize: 12, color: COLORS.danger, fontWeight: '600' },

  hardLock: {
    backgroundColor: COLORS.criticalDim, borderRadius: RADIUS.lg,
    padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.critical,
    alignItems: 'center', marginBottom: SPACING.lg, width: '100%',
  },
  hardLockTitle: { fontSize: 18, fontWeight: '800', color: COLORS.critical, marginBottom: SPACING.sm },
  hardLockBody:  { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 21 },

  endBtn: {
    backgroundColor: COLORS.surfaceElevated, borderRadius: RADIUS.full,
    paddingVertical: 14, paddingHorizontal: 36,
    borderWidth: 1, borderColor: COLORS.border, marginTop: SPACING.lg,
  },
  endBtnText:  { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  cancelText:  { fontSize: 13, color: COLORS.textMuted, marginTop: SPACING.sm },

  debugBtn: {
    backgroundColor: '#1a1a2e', borderRadius: RADIUS.full,
    paddingVertical: 10, paddingHorizontal: 24,
    borderWidth: 1, borderColor: '#FFD700', marginTop: SPACING.md,
  },
  debugBtnText: { fontSize: 13, fontWeight: '600', color: '#FFD700' },
});
