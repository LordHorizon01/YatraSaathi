import React, { useEffect, useRef, useState } from 'react';
import {
  Animated, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, RADIUS, SHADOW, SPACING, STATE_THEME } from '../theme';
import { useSession, Actions } from '../context/SessionContext';
import { startSession } from '../services/api';

const LANGUAGES = [
  { code: 'hi', label: 'हिंदी' },
  { code: 'en', label: 'English' },
  { code: 'ta', label: 'தமிழ்' },
  { code: 'te', label: 'తెలుగు' },
  { code: 'bn', label: 'বাংলা' },
  { code: 'mr', label: 'मराठी' },
  { code: 'kn', label: 'ಕನ್ನಡ' },
];

export default function DashboardScreen({ navigation }) {
  const { session, dispatch, startDriveTimer } = useSession();
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();
  }, []);

  const handleStartDrive = async () => {
    setLoading(true);
    try {
      // Attempt backend session creation; fall back gracefully if offline
      let sessionId = `local-${Date.now()}`;
      try {
        const res = await startSession(session.vehicleId, session.languagePref);
        sessionId = res.session_id;
      } catch (err) {
        console.warn('Backend session start failed, using local session ID:', err.message);
      }
      
      dispatch({ type: Actions.START_SESSION, payload: { sessionId, vehicleId: session.vehicleId } });
      const nextCheckinAt = Date.now() + 45 * 60 * 1000; // first interval (0–4h = 45min)
      
      try {
        await startDriveTimer({ sessionId, vehicleId: session.vehicleId, nextCheckinAt });
      } catch (err) {
        console.warn('Failed to start drive timer/background tasks:', err.message);
        // Continue anyway so the user isn't stuck if background permissions are rejected
      }
      
      navigation.navigate('Session');
    } catch (err) {
      console.error('Critical failure in handleStartDrive:', err);
      alert('Failed to start session. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const selectLanguage = (code) => {
    dispatch({ type: Actions.SET_LANGUAGE, payload: { lang: code } });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.brandRow}>
              <View style={styles.logoMark}>
                <Text style={styles.logoIcon}>🛡</Text>
              </View>
              <View>
                <Text style={styles.brandName}>Saarthi AI</Text>
                <Text style={styles.brandTagline}>Your co-driver never sleeps</Text>
              </View>
            </View>
          </View>

          {/* Stats Row */}
          <View style={styles.statsRow}>
            <StatCard icon="🔥" value={session.streakDay} label="Streak" unit="days" />
            <StatCard icon="⭐" value={session.safetyPoints} label="Points" unit="pts" />
            <StatCard icon="🛡" value="A+" label="Rating" unit="" />
          </View>

          {/* Language Selector */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Language / भाषा</Text>
            <View style={styles.langRow}>
              {LANGUAGES.map((l) => (
                <Pressable
                  key={l.code}
                  style={[styles.langChip, session.languagePref === l.code && styles.langChipActive]}
                  onPress={() => selectLanguage(l.code)}
                >
                  <Text style={[styles.langText, session.languagePref === l.code && styles.langTextActive]}>
                    {l.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Start Button Area */}
          <View style={styles.startArea}>
            <Text style={styles.startHint}>Ready to hit the road?</Text>
            <Pressable
              style={[styles.startBtn, loading && { opacity: 0.6 }]}
              onPress={handleStartDrive}
              disabled={loading}
            >
              <Text style={styles.startBtnIcon}>▶</Text>
              <Text style={styles.startBtnLabel}>{loading ? 'Starting…' : 'Start Drive'}</Text>
              <Text style={styles.startBtnSub}>Saarthi will watch over you</Text>
            </Pressable>
          </View>

          {/* Info Cards */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>How It Works</Text>
            <InfoCard
              icon="🎙"
              title="Voice Check-ins"
              body="Saarthi asks you a casual question at adaptive intervals. Your response reveals your alertness."
            />
            <InfoCard
              icon="📡"
              title="DangerBubble"
              body="If you're fatigued, a 400m virtual zone warns other drivers automatically."
            />
            <InfoCard
              icon="☕"
              title="Dhaba Finder"
              body="When you're drowsy, Saarthi suggests the nearest rest stop by name."
            />
          </View>

        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ icon, value, label, unit }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statIcon}>{icon}</Text>
      <Text style={styles.statValue}>{value}<Text style={styles.statUnit}>{unit}</Text></Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function InfoCard({ icon, title, body }) {
  return (
    <View style={styles.infoCard}>
      <Text style={styles.infoIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoTitle}>{title}</Text>
        <Text style={styles.infoBody}>{body}</Text>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: COLORS.bg },
  scroll: { padding: SPACING.lg, paddingBottom: SPACING.xxl },

  header: { marginBottom: SPACING.xl },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  logoMark: {
    width: 52, height: 52, borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  logoIcon:      { fontSize: 26 },
  brandName:     { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary, letterSpacing: -0.4 },
  brandTagline:  { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },

  statsRow:    { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.xl },
  statCard:    {
    flex: 1, backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg, padding: SPACING.md,
    borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center',
  },
  statIcon:    { fontSize: 20, marginBottom: 4 },
  statValue:   { fontSize: 20, fontWeight: '800', color: COLORS.textPrimary },
  statUnit:    { fontSize: 11, fontWeight: '500', color: COLORS.textMuted },
  statLabel:   { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },

  section:      { marginBottom: SPACING.xl },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: SPACING.md },

  langRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  langChip:    { paddingVertical: 8, paddingHorizontal: 14, borderRadius: RADIUS.full, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  langChipActive: { backgroundColor: COLORS.brandDim, borderColor: COLORS.brand },
  langText:    { fontSize: 13, fontWeight: '500', color: COLORS.textSecondary },
  langTextActive: { color: COLORS.brand, fontWeight: '700' },

  startArea:    { alignItems: 'center', marginVertical: SPACING.xl },
  startHint:    { fontSize: 14, color: COLORS.textMuted, marginBottom: SPACING.lg },
  startBtn: {
    width: 200, height: 200, borderRadius: 100,
    backgroundColor: COLORS.safe,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: COLORS.safe,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55, shadowRadius: 28, elevation: 14,
  },
  startBtnIcon:  { fontSize: 32, color: COLORS.black, marginBottom: 4 },
  startBtnLabel: { fontSize: 20, fontWeight: '800', color: COLORS.black },
  startBtnSub:   { fontSize: 11, color: 'rgba(0,0,0,0.55)', marginTop: 4, textAlign: 'center', paddingHorizontal: 16 },

  infoCard: {
    flexDirection: 'row', gap: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg, padding: SPACING.md,
    borderWidth: 1, borderColor: COLORS.border,
    marginBottom: SPACING.sm,
  },
  infoIcon:  { fontSize: 24, width: 32, textAlign: 'center' },
  infoTitle: { fontSize: 14, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 4 },
  infoBody:  { fontSize: 13, color: COLORS.textSecondary, lineHeight: 19 },
});
