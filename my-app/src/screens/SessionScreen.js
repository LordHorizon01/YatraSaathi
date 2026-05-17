import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, Easing, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';

import { COLORS, RADIUS, SPACING, STATE_THEME } from '../theme';
import { useSession, Actions } from '../context/SessionContext';
import { formatDuration, formatCountdown } from '../utils/fatigueUtils';
import FatigueRing from '../components/FatigueRing';
import DangerOverlay from '../components/DangerOverlay';
import { endSession, pushLocation, getNearbyDangers } from '../services/api';

const GEO_INTERVAL_MS = 5_000;  // broadcast location every 5s per spec

export default function SessionScreen({ navigation }) {
  const { session, dispatch, stopDriveTimer } = useSession();
  const [nearbyDanger, setNearbyDanger]       = useState(null); // { distanceM }
  const [showDanger,   setShowDanger]         = useState(false);
  const [endConfirm,   setEndConfirm]         = useState(false);

  const geoRef      = useRef(null);
  const locationRef = useRef(null);
  const flashAnim   = useRef(new Animated.Value(0)).current;

  // ─── Location & Geo Loop ────────────────────────────────────────────────────
  useEffect(() => {
    let active = true;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      geoRef.current = setInterval(async () => {
        if (!active) return;
        try {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          locationRef.current = loc.coords;

          // Broadcast own position
          await pushLocation(
            session.vehicleId,
            loc.coords.latitude,
            loc.coords.longitude,
            session.fatigueScore,
          ).catch(() => {});

          // Poll for nearby dangers
          const dangers = await getNearbyDangers(loc.coords.latitude, loc.coords.longitude, 1).catch(() => []);
          if (dangers?.length > 0) {
            setNearbyDanger({ distanceM: Math.round(dangers[0].distance_m) });
            setShowDanger(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          }
        } catch (_) {}
      }, GEO_INTERVAL_MS);
    })();

    return () => {
      active = false;
      if (geoRef.current) clearInterval(geoRef.current);
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

  // ─── End Drive ──────────────────────────────────────────────────────────────
  const handleEndDrive = useCallback(async () => {
    if (!endConfirm) { setEndConfirm(true); return; }
    stopDriveTimer();
    if (geoRef.current) clearInterval(geoRef.current);
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
            <Text style={styles.countdownTimer}>{formatCountdown(session.nextCheckinMs)}</Text>
          </View>
        )}

        {/* POI Suggestion */}
        {session.suggestedPoi && (
          <View style={[styles.poiCard, { borderColor: COLORS.warning }]}>
            <Text style={styles.poiIcon}>☕</Text>
            <View>
              <Text style={styles.poiName}>{session.suggestedPoi.name}</Text>
              <Text style={styles.poiDist}>{session.suggestedPoi.distance_m}m ahead — Take a break</Text>
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
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg, borderRadius: 0 },

  header:     { alignItems: 'center', marginBottom: SPACING.lg },
  stateDot:   { width: 10, height: 10, borderRadius: 5, marginBottom: SPACING.xs },
  stateText:  { fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },
  stateHindi: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },

  driveTimer: { fontSize: 52, fontWeight: '800', color: COLORS.textPrimary, letterSpacing: -1, fontVariant: ['tabular-nums'] },
  driveLabel: { fontSize: 12, color: COLORS.textMuted, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: SPACING.xl },

  ringArea: { marginBottom: SPACING.xl },

  countdownCard: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.lg,
  },
  countdownLabel: { fontSize: 13, color: COLORS.textMuted },
  countdownTimer: { fontSize: 20, fontWeight: '700', color: COLORS.textPrimary, fontVariant: ['tabular-nums'] },

  poiCard: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    padding: SPACING.md, borderWidth: 1, width: '100%', marginBottom: SPACING.md,
  },
  poiIcon: { fontSize: 24 },
  poiName: { fontSize: 14, fontWeight: '700', color: COLORS.warning },
  poiDist: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },

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
});
