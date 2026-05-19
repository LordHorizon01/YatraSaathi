import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Linking, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { COLORS, RADIUS, SHADOW, SPACING, STATE_THEME } from '../theme';
import { useSession, Actions } from '../context/SessionContext';
import { startSession } from '../services/api';
import { getNearbyPois } from '../services/poiService';

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

  // ─── Pre-drive Dhaba/Hotel Finder ────────────────────────────────────────
  const [poiLoading,  setPoiLoading]  = useState(false);
  const [poiList,     setPoiList]     = useState([]);
  const [poiError,    setPoiError]    = useState(null);
  const [poiVisible,  setPoiVisible]  = useState(false);

  const handleFindNearby = async () => {
    setPoiError(null);
    setPoiVisible(true);
    setPoiLoading(true);
    setPoiList([]);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setPoiError('Location permission denied. Please allow location access.');
        setPoiLoading(false);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const lat = loc.coords.latitude;
      const lng = loc.coords.longitude;
      try {
        const pois = await getNearbyPois(lat, lng, lat, lng, 8000);
        setPoiList(pois);
        // Clear any stale error if we got results
        setPoiError(null);
      } catch (fetchErr) {
        // Only show error if we have no results at all
        setPoiError('Could not fetch nearby stops. Check your connection.');
      }
    } catch (locErr) {
      setPoiError('Could not get your location. Please enable GPS.');
    }
    setPoiLoading(false);
  };

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();
  }, []);

  const handleStartDrive = async () => {
    setLoading(true);
    try {
      // Ensure we always have a vehicleId — generate one if not registered yet
      const effectiveVehicleId = session.vehicleId && session.vehicleId !== 'null'
        ? session.vehicleId
        : `DRV-${Date.now().toString(36).toUpperCase()}`;

      // Attempt backend session creation; fall back gracefully if offline
      let sessionId = `local-${Date.now()}`;
      try {
        const res = await startSession(effectiveVehicleId, session.languagePref);
        sessionId = res.session_id;
      } catch (err) {
        console.warn('Backend session start failed, using local session ID:', err.message);
      }
      
      dispatch({ type: Actions.START_SESSION, payload: { sessionId, vehicleId: effectiveVehicleId } });
      const nextCheckinAt = Date.now() + 45 * 60 * 1000;
      
      try {
        await startDriveTimer({ sessionId, vehicleId: effectiveVehicleId, nextCheckinAt, lang: session.languagePref });
      } catch (err) {
        console.warn('Failed to start drive timer/background tasks:', err.message);
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

          {/* ── Find Nearby Dhabas / Hotels ─ Prominent section ABOVE start button ── */}
          <View style={styles.findDhabaSection}>
            <Text style={styles.findDhabaSectionTitle}>🍛  FIND REST STOPS NEARBY</Text>
            <Pressable
              style={styles.findDhabaBtn}
              onPress={handleFindNearby}
            >
              <View style={styles.findDhaBtnLeft}>
                <View style={styles.findDhaBtnIconWrap}>
                  <Text style={styles.findDhaBtnIcon}>🏨</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.findDhaBtnLabel}>Dhabas / Hotels / Restaurants</Text>
                  <Text style={styles.findDhaBtnSub}>Find rest stops within 8 km of you</Text>
                </View>
              </View>
              <Text style={styles.findDhaBtnArrow}>›</Text>
            </Pressable>
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

          {/* POI Results Panel */}
          {poiVisible && (
            <View style={styles.poiPanel}>
              {/* Panel Header */}
              <View style={styles.poiPanelHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.poiPanelTitle}>🏨  Dhabas / Hotels / Restaurants</Text>
                  <Text style={styles.poiPanelSub}>Nearby rest stops along your route</Text>
                </View>
                <Pressable onPress={() => setPoiVisible(false)} hitSlop={12}>
                  <Text style={styles.poiPanelClose}>✕</Text>
                </Pressable>
              </View>

              {poiLoading && (
                <View style={styles.poiCenterRow}>
                  <ActivityIndicator color={COLORS.brand} />
                  <Text style={styles.poiStatusText}>  Searching nearby…</Text>
                </View>
              )}

              {/* Show error ONLY when there are no results to display */}
              {poiError && !poiLoading && poiList.length === 0 && (
                <Text style={styles.poiErrorText}>{poiError}</Text>
              )}

              {!poiLoading && !poiError && poiList.length === 0 && (
                <Text style={styles.poiEmptyText}>
                  No dhabas / restaurants found within 8 km.
                </Text>
              )}

              {!poiLoading && poiList.map((poi, idx) => (
                <View key={poi.id ?? idx} style={styles.poiRow}>
                  <View style={styles.poiRank}>
                    <Text style={styles.poiRankText}>{idx + 1}</Text>
                  </View>
                  <Text style={styles.poiTypeIcon}>
                    {poi.type === 'dhaba' ? '🍛' : poi.type === 'hotel' ? '🏨' : '🍽️'}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.poiName} numberOfLines={1}>{poi.name}</Text>
                    {poi.address ? <Text style={styles.poiAddr} numberOfLines={1}>{poi.address}</Text> : null}
                    {poi.rating  ? <Text style={styles.poiRating}>⭐ {poi.rating}</Text> : null}
                  </View>
                  <View style={styles.poiRight}>
                    <Text style={styles.poiDist}>
                      {poi.distance_m >= 1000
                        ? `${(poi.distance_m / 1000).toFixed(1)} km`
                        : `${Math.round(poi.distance_m)} m`}
                    </Text>
                    <Pressable
                      style={styles.poiMapsBtn}
                      onPress={() => {
                        const url = poi.maps_url ||
                          `https://maps.google.com/maps?q=${poi.lat},${poi.lng}`;
                        Linking.openURL(url).catch(() => {});
                      }}
                    >
                      <Text style={styles.poiMapsBtnText}>🗺 Maps</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}

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

  // ─ Find Nearby Dhabas section ─
  findDhabaSection: {
    alignSelf: 'stretch',
    marginBottom: SPACING.xl,
  },
  findDhabaSectionTitle: {
    fontSize: 13, fontWeight: '800', color: COLORS.warning,
    letterSpacing: 0.5,
    marginBottom: SPACING.sm,
  },
  findDhabaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,176,32,0.13)',
    borderRadius: RADIUS.xl,
    borderWidth: 2,
    borderColor: COLORS.warning,
    paddingVertical: 16,
    paddingHorizontal: SPACING.md,
    shadowColor: COLORS.warning,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 6,
  },
  findDhaBtnLeft:    { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, flex: 1 },
  findDhaBtnIconWrap: {
    width: 44, height: 44, borderRadius: RADIUS.md,
    backgroundColor: 'rgba(255,176,32,0.2)',
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  findDhaBtnIcon:  { fontSize: 24 },
  findDhaBtnLabel: { fontSize: 15, fontWeight: '800', color: COLORS.warning },
  findDhaBtnSub:   { fontSize: 11, color: COLORS.textMuted, marginTop: 3 },
  findDhaBtnArrow: { fontSize: 28, color: COLORS.warning, fontWeight: '700' },

  // POI Results Panel (pre-drive)
  poiPanel: {
    alignSelf: 'stretch',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    borderWidth: 1, borderColor: COLORS.warning,
    marginBottom: SPACING.xl,
    overflow: 'hidden',
  },
  poiPanelHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    backgroundColor: 'rgba(255,176,32,0.10)',
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,176,32,0.18)',
  },
  poiPanelTitle:  { fontSize: 13, fontWeight: '800', color: COLORS.warning },
  poiPanelSub:    { fontSize: 11, color: COLORS.textMuted, marginTop: 1 },
  poiPanelClose:  { fontSize: 15, color: COLORS.textMuted, padding: 4 },

  poiCenterRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: SPACING.lg },
  poiStatusText:  { fontSize: 13, color: COLORS.textSecondary },
  poiErrorText:   { fontSize: 13, color: COLORS.danger, textAlign: 'center', padding: SPACING.lg },
  poiEmptyText:   { fontSize: 12, color: COLORS.textMuted, textAlign: 'center', padding: SPACING.lg },

  poiRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACING.sm, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    gap: SPACING.sm,
  },
  poiRank: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: COLORS.warning,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  poiRankText:    { fontSize: 11, fontWeight: '800', color: COLORS.black },
  poiTypeIcon:    { fontSize: 20, flexShrink: 0 },
  poiName:        { fontSize: 13, fontWeight: '700', color: COLORS.textPrimary },
  poiAddr:        { fontSize: 11, color: COLORS.textMuted, marginTop: 1 },
  poiRating:      { fontSize: 11, color: COLORS.textSecondary, marginTop: 1 },
  poiRight:       { alignItems: 'flex-end', gap: 4, flexShrink: 0 },
  poiDist:        { fontSize: 13, fontWeight: '800', color: COLORS.warning },
  poiMapsBtn: {
    backgroundColor: COLORS.brand, borderRadius: RADIUS.sm,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  poiMapsBtnText: { fontSize: 11, fontWeight: '700', color: COLORS.white },

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
