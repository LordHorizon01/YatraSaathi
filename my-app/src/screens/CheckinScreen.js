import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, Linking, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';

import { COLORS, RADIUS, SPACING, STATE_THEME } from '../theme';
import { useSession, Actions } from '../context/SessionContext';
import { pickQuestion } from '../utils/questions';
import { startRecording, stopRecording, cancelRecording } from '../services/audioService';
import { analyzeVoice } from '../services/api';

// ─── Check-in State Machine ───────────────────────────────────────────────────
const PHASE = {
  SPEAKING:   'speaking',    // TTS playing question
  LISTENING:  'listening',   // Recording user response
  ANALYZING:  'analyzing',   // Awaiting backend response
  RESULT:     'result',      // Displaying result
};

const MAX_RECORD_SEC = 12;

export default function CheckinScreen({ navigation }) {
  const { session, dispatch } = useSession();

  const question = useRef(pickQuestion(session.languagePref)).current;
  const [phase,       setPhase]       = useState(PHASE.SPEAKING);
  const [countdown,   setCountdown]   = useState(MAX_RECORD_SEC);
  const [result,      setResult]      = useState(null); // FatigueLog payload
  const [error,       setError]       = useState(null);

  const waveAnim     = useRef(new Animated.Value(0)).current;
  const countdownRef = useRef(null);
  const recordStart  = useRef(null);    // epoch ms when recording began (after TTS)

  // ─── Phase: SPEAKING ───────────────────────────────────────────────────────
  useEffect(() => {
    Speech.speak(question, {
      language:    session.languagePref === 'en' ? 'en-IN' : 'hi-IN',
      rate:        0.9,
      onDone:      startListening,
      onError:     startListening,  // Fallback: proceed even if TTS fails
    });
    return () => Speech.stop();
  }, []);

  // ─── Phase: LISTENING ──────────────────────────────────────────────────────
  const startListening = async () => {
    setPhase(PHASE.LISTENING);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    startWaveAnimation();

    try {
      recordStart.current = await startRecording();
    } catch (e) {
      setError('Microphone unavailable. Please grant permission.');
      return;
    }

    // Countdown timer — auto-stop after MAX_RECORD_SEC
    let remaining = MAX_RECORD_SEC;
    countdownRef.current = setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining <= 0) finishRecording();
    }, 1000);
  };

  const finishRecording = async () => {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    waveAnim.stopAnimation();
    setPhase(PHASE.ANALYZING);

    try {
      const { uri, latencyMs } = await stopRecording(recordStart.current);

      // If recording failed, show error
      if (!uri) {
        setError('Recording failed — mic may not be available on this device. Try a physical phone.');
        const fallback = { fatigue_score: 3, latency_flag: 'ok', coherence_flag: 'ok', slur_flag: 'ok', danger_bubble_active: false };
        setResult(fallback);
        dispatch({ type: Actions.CHECKIN_RESULT, payload: fallback });
        setPhase(PHASE.RESULT);
        return;
      }

      // Grab current position for DangerBubble geo-broadcast
      let lat = 0, lng = 0;
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        lat = loc.coords.latitude;
        lng = loc.coords.longitude;
      } catch (_) {}

      const data = await analyzeVoice({
        audioUri:    uri,
        sessionId:   session.sessionId,
        vehicleId:   session.vehicleId,
        latencyMs,
        questionText: question,
        lang:        session.languagePref,
        lat,
        lng,
      });
      setResult(data);
      dispatch({
        type: Actions.CHECKIN_RESULT,
        payload: { ...data, _anchorPos: lat && lng ? { lat, lng } : null },
      });
      setPhase(PHASE.RESULT);
      Haptics.notificationAsync(
        data.fatigue_score <= 5
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning,
      );
    } catch (e) {
      console.error('[Saarthi] Check-in failed:', e.message, e.response?.data);
      // Show the actual error so we can debug
      const errMsg = e.response?.data?.detail || e.message || 'Unknown error';
      setError(`API Error: ${errMsg}`);
      const fallback = { fatigue_score: 6, latency_flag: 'critical', coherence_flag: 'ok', slur_flag: 'ok', danger_bubble_active: false };
      setResult(fallback);
      dispatch({ type: Actions.CHECKIN_RESULT, payload: fallback });
      setPhase(PHASE.RESULT);
    }
  };

  // ─── Waveform animation ────────────────────────────────────────────────────
  const startWaveAnimation = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(waveAnim, { toValue: 1, duration: 500, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(waveAnim, { toValue: 0, duration: 500, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ]),
    ).start();
  };

  const waveScale = waveAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });

  const handleDone = () => {
    dispatch({ type: Actions.CLEAR_CHECKIN });
    navigation.goBack();
  };

  // ─── Result State Theme ────────────────────────────────────────────────────
  const resultState = result
    ? (result.fatigue_score <= 5 ? 'safe' : result.fatigue_score <= 7 ? 'warning' : 'danger')
    : 'safe';
  const resultTheme = STATE_THEME[resultState];

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>

        {/* Question Card */}
        <View style={styles.questionCard}>
          <Text style={styles.questionLabel}>Saarthi asks:</Text>
          <Text style={styles.questionText}>"{question}"</Text>
        </View>

        {/* Phase UI */}
        {phase === PHASE.SPEAKING && (
          <View style={styles.phaseBox}>
            <ActivityIndicator size="large" color={COLORS.brand} />
            <Text style={styles.phaseLabel}>Asking question…</Text>
          </View>
        )}

        {phase === PHASE.LISTENING && (
          <View style={styles.phaseBox}>
            <Animated.View style={[styles.micRing, { transform: [{ scale: waveScale }] }]}>
              <Text style={styles.micIcon}>🎙</Text>
            </Animated.View>
            <Text style={[styles.phaseLabel, { color: COLORS.danger }]}>Recording — speak now</Text>
            <Text style={styles.countdown}>{countdown}s</Text>
            <Pressable style={styles.doneBtn} onPress={finishRecording}>
              <Text style={styles.doneBtnText}>Done Speaking</Text>
            </Pressable>
          </View>
        )}

        {phase === PHASE.ANALYZING && (
          <View style={styles.phaseBox}>
            <ActivityIndicator size="large" color={COLORS.brand} />
            <Text style={styles.phaseLabel}>Saarthi is analyzing…</Text>
          </View>
        )}

        {phase === PHASE.RESULT && result && (
          <View style={styles.resultCard}>
            <Text style={[styles.resultScore, { color: resultTheme.color }]}>
              {resultTheme.icon} Score: {result.fatigue_score}/10
            </Text>
            <Text style={[styles.resultState, { color: resultTheme.color }]}>{resultTheme.label}</Text>

            <View style={styles.flagsRow}>
              <FlagChip label="Latency" flag={result.latency_flag} />
              <FlagChip label="Coherence" flag={result.coherence_flag} />
              <FlagChip label="Clarity" flag={result.slur_flag} />
            </View>

            {result.suggested_poi && (
              <View style={styles.poiSuggestion}>
                <View style={styles.poiSuggestionRow}>
                  <Text style={styles.poiText}>
                    ☕ {result.suggested_poi.name}
                  </Text>
                  <Text style={styles.poiDistText}>
                    {result.suggested_poi.distance_m >= 1000
                      ? `${(result.suggested_poi.distance_m / 1000).toFixed(1)} km ahead`
                      : `${result.suggested_poi.distance_m} m ahead`}
                  </Text>
                </View>
                {result.suggested_poi.address ? (
                  <Text style={styles.poiAddr} numberOfLines={1}>
                    📍 {result.suggested_poi.address}
                  </Text>
                ) : null}
                <Pressable
                  style={styles.mapsBtn}
                  onPress={() => {
                    const url = result.suggested_poi.maps_url
                      || `https://maps.google.com/maps?q=${result.suggested_poi.lat},${result.suggested_poi.lng}`;
                    Linking.openURL(url).catch(() => {});
                  }}
                >
                  <Text style={styles.mapsBtnText}>🗺️  Open in Google Maps</Text>
                </Pressable>
              </View>
            )}

            <Pressable style={[styles.doneBtn, { backgroundColor: resultTheme.color, marginTop: SPACING.xl }]} onPress={handleDone}>
              <Text style={[styles.doneBtnText, { color: COLORS.black }]}>Back to Drive</Text>
            </Pressable>
          </View>
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}

      </View>
    </SafeAreaView>
  );
}

// ─── Flag Chip ────────────────────────────────────────────────────────────────
function FlagChip({ label, flag }) {
  const color = flag === 'ok' ? COLORS.safe : flag === 'warning' ? COLORS.warning : COLORS.danger;
  return (
    <View style={[styles.chip, { borderColor: color, backgroundColor: `${color}18` }]}>
      <Text style={[styles.chipLabel, { color }]}>{label}</Text>
      <Text style={[styles.chipFlag,  { color }]}>{flag?.toUpperCase()}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: COLORS.bg },
  container: { flex: 1, padding: SPACING.lg, justifyContent: 'center', alignItems: 'center' },

  questionCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.xl,
    padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.border,
    width: '100%', marginBottom: SPACING.xl,
  },
  questionLabel: { fontSize: 11, color: COLORS.textMuted, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: SPACING.sm },
  questionText:  { fontSize: 17, color: COLORS.textPrimary, fontWeight: '600', lineHeight: 26, fontStyle: 'italic' },

  phaseBox:   { alignItems: 'center', gap: SPACING.md },
  phaseLabel: { fontSize: 15, color: COLORS.textSecondary, fontWeight: '500' },

  micRing: {
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: COLORS.dangerDim, borderWidth: 2, borderColor: COLORS.danger,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: COLORS.danger, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5, shadowRadius: 20, elevation: 10,
  },
  micIcon:    { fontSize: 44 },
  countdown:  { fontSize: 36, fontWeight: '800', color: COLORS.textPrimary, fontVariant: ['tabular-nums'] },

  doneBtn: {
    backgroundColor: COLORS.surfaceElevated, borderRadius: RADIUS.full,
    paddingVertical: 14, paddingHorizontal: 32,
    borderWidth: 1, borderColor: COLORS.border,
  },
  doneBtnText: { fontSize: 14, fontWeight: '700', color: COLORS.textPrimary },

  resultCard: { alignItems: 'center', width: '100%' },
  resultScore: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  resultState: { fontSize: 14, fontWeight: '600', marginTop: 4, marginBottom: SPACING.lg },

  flagsRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.lg },
  chip: {
    flex: 1, borderRadius: RADIUS.md, borderWidth: 1,
    paddingVertical: SPACING.sm, alignItems: 'center',
  },
  chipLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  chipFlag:  { fontSize: 12, fontWeight: '800', marginTop: 2 },

  poiSuggestion: {
    backgroundColor: COLORS.warningDim, borderRadius: RADIUS.lg,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.warning,
    width: '100%', gap: SPACING.sm,
  },
  poiSuggestionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  poiText:     { fontSize: 14, color: COLORS.warning, fontWeight: '700', flex: 1 },
  poiDistText: { fontSize: 13, color: COLORS.warning, fontWeight: '800' },
  poiAddr:     { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  mapsBtn: {
    backgroundColor: COLORS.brand, borderRadius: RADIUS.md,
    paddingVertical: 8, paddingHorizontal: 14,
    alignItems: 'center', marginTop: 4,
  },
  mapsBtnText: { fontSize: 12, fontWeight: '700', color: COLORS.white },

  errorText: { color: COLORS.danger, fontSize: 13, marginTop: SPACING.md, textAlign: 'center' },
});
