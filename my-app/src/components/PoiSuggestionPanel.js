/**
 * PoiSuggestionPanel
 *
 * Shown when fatigue score is 5-7 (warning zone). Features:
 *   • Lists nearby dhabas/restaurants/hotels sorted by distance
 *   • Live distance updates as driver moves (polls every 10s via GPS)
 *   • Detects "missed" POIs (driver passed them — distance increasing again)
 *   • Shows already-missed POIs briefly with a "PASSED" badge
 *   • Upcoming POIs displayed as next suggestions
 *   • "Open in Maps" button on every card
 *   • Animated slide-in entry
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { COLORS, RADIUS, SPACING } from '../theme';
import { getNearbyPois } from '../services/poiService';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDist(metres) {
  if (metres == null) return '—';
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)} km`;
  return `${Math.round(metres)} m`;
}

function poiIcon(type) {
  switch (type) {
    case 'dhaba':      return '🍛';
    case 'hotel':      return '🏨';
    case 'restaurant': return '🍽️';
    default:           return '☕';
  }
}

function mapsUrl(poi) {
  // Prefer the URL returned by the backend; fall back to coords
  return poi.maps_url || `https://maps.google.com/maps?q=${poi.lat},${poi.lng}`;
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// A POI is "missed" if driver has moved PAST it — i.e. they were once < 300 m
// and are now moving farther away (distance increasing for 2 consecutive readings).
const MISSED_THRESHOLD_M   = 300;   // must have been this close to count as "missed"
const MISSED_SHOW_SEC       = 30;   // show missed POI badge for this many seconds

// ─── Component ────────────────────────────────────────────────────────────────
export default function PoiSuggestionPanel({
  anchorLat,      // lat where the check-in happened (used for initial fetch)
  anchorLng,
  initialPois,    // pre-fetched POIs from the check-in response (may be empty)
  onDismiss,      // called when user explicitly closes the panel
}) {
  const [pois,        setPois]        = useState(initialPois || []);
  const [missedIds,   setMissedIds]   = useState(new Set());
  const [loading,     setLoading]     = useState(!initialPois?.length);
  const [driverPos,   setDriverPos]   = useState(null);

  // Track previous distances to detect "moving away" pattern
  const prevDistRef   = useRef({});   // { [id]: distanceM }
  const closeDistRef  = useRef({});   // { [id]: true }  — was ever very close
  const missedTimers  = useRef({});   // { [id]: timeout }

  const slideAnim = useRef(new Animated.Value(60)).current;
  const opacAnim  = useRef(new Animated.Value(0)).current;

  // ─── Slide-in on mount ─────────────────────────────────────────────────────
  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 0, duration: 400, easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(opacAnim, {
        toValue: 1, duration: 350, useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // ─── Initial fetch if needed ───────────────────────────────────────────────
  useEffect(() => {
    if (initialPois?.length) return; // already have data from check-in
    (async () => {
      setLoading(true);
      try {
        let lat = anchorLat;
        let lng = anchorLng;

        // If no anchor provided (no prior check-in), use current GPS position
        if (!lat || !lng) {
          try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status === 'granted') {
              const loc = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
              });
              lat = loc.coords.latitude;
              lng = loc.coords.longitude;
            }
          } catch (_) {}
        }

        if (!lat || !lng) {
          setLoading(false);
          return; // Can't fetch without any position
        }

        const list = await getNearbyPois(lat, lng, lat, lng, 8000);
        setPois(list);
      } catch (_) {}
      setLoading(false);
    })();
  }, [anchorLat, anchorLng]);

  // ─── Live distance refresh (every 10s) ────────────────────────────────────
  const refreshDistances = useCallback(async () => {
    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const dlat = loc.coords.latitude;
      const dlng = loc.coords.longitude;
      setDriverPos({ lat: dlat, lng: dlng });

      setPois((prev) => {
        const updated = prev.map((p) => ({
          ...p,
          distance_m: Math.round(haversine(dlat, dlng, p.lat, p.lng)),
        })).sort((a, b) => a.distance_m - b.distance_m);

        // ── Missed POI detection ──────────────────────────────────────────
        updated.forEach((p) => {
          const prev_d  = prevDistRef.current[p.id];
          const curr_d  = p.distance_m;

          // Track "ever been very close"
          if (curr_d <= MISSED_THRESHOLD_M) closeDistRef.current[p.id] = true;

          // If was close AND is now moving farther away → missed!
          if (
            closeDistRef.current[p.id] &&
            prev_d !== undefined &&
            curr_d > prev_d + 50   // moving away by > 50m
          ) {
            setMissedIds((m) => new Set([...m, p.id]));
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

            // Auto-clear the missed badge after MISSED_SHOW_SEC
            if (missedTimers.current[p.id]) clearTimeout(missedTimers.current[p.id]);
            missedTimers.current[p.id] = setTimeout(() => {
              setMissedIds((m) => {
                const next = new Set(m);
                next.delete(p.id);
                return next;
              });
            }, MISSED_SHOW_SEC * 1000);
          }

          prevDistRef.current[p.id] = curr_d;
        });

        return updated;
      });
    } catch (_) {}
  }, []);

  useEffect(() => {
    refreshDistances();
    const iv = setInterval(refreshDistances, 10_000);
    return () => {
      clearInterval(iv);
      Object.values(missedTimers.current).forEach(clearTimeout);
    };
  }, [refreshDistances]);

  // ─── Open Google Maps ──────────────────────────────────────────────────────
  const openMaps = useCallback((poi) => {
    const url = mapsUrl(poi);
    Linking.openURL(url).catch(() => {
      // fallback: open with geo: URI
      Linking.openURL(`geo:${poi.lat},${poi.lng}?q=${encodeURIComponent(poi.name)}`);
    });
  }, []);

  // ─── Categorise POIs ───────────────────────────────────────────────────────
  const upcoming = pois.filter((p) => !missedIds.has(p.id));
  const missed   = pois.filter((p) =>  missedIds.has(p.id));

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <Animated.View
      style={[
        styles.panel,
        { transform: [{ translateY: slideAnim }], opacity: opacAnim },
      ]}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.warningDot}>⚠</Text>
          <View>
            <Text style={styles.title}>Rest Stops Nearby</Text>
            <Text style={styles.subtitle}>Fatigue detected — take a break soon</Text>
          </View>
        </View>
        {onDismiss && (
          <Pressable onPress={onDismiss} style={styles.closeBtn} hitSlop={12}>
            <Text style={styles.closeX}>✕</Text>
          </Pressable>
        )}
      </View>

      {loading && (
        <Text style={styles.loadingText}>🔍 Searching nearby rest stops…</Text>
      )}

      {!loading && pois.length === 0 && (
        <Text style={styles.emptyText}>
          No dhabas/restaurants found within 8 km.{'\n'}
          Drive safely and pull over when you can.
        </Text>
      )}

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
      >
        {/* Upcoming stops */}
        {upcoming.map((poi, idx) => (
          <PoiCard
            key={poi.id}
            poi={poi}
            rank={idx + 1}
            missed={false}
            onOpenMaps={() => openMaps(poi)}
          />
        ))}

        {/* Missed stops — shown briefly */}
        {missed.length > 0 && (
          <>
            <Text style={styles.missedLabel}>⬆ Passed (behind you)</Text>
            {missed.map((poi) => (
              <PoiCard
                key={poi.id}
                poi={poi}
                rank={null}
                missed={true}
                onOpenMaps={() => openMaps(poi)}
              />
            ))}
          </>
        )}
      </ScrollView>
    </Animated.View>
  );
}

// ─── POI Card ─────────────────────────────────────────────────────────────────
function PoiCard({ poi, rank, missed, onOpenMaps }) {
  const cardBorder = missed ? COLORS.textMuted : COLORS.warning;
  const cardBg     = missed ? 'rgba(255,255,255,0.03)' : 'rgba(255,176,32,0.07)';

  return (
    <View style={[styles.card, { borderColor: cardBorder, backgroundColor: cardBg }]}>
      {/* Rank badge */}
      {rank && (
        <View style={styles.rankBadge}>
          <Text style={styles.rankText}>{rank}</Text>
        </View>
      )}

      {/* Icon + info */}
      <View style={styles.cardLeft}>
        <Text style={styles.poiIcon}>{poiIcon(poi.type)}</Text>
        <View style={styles.poiInfo}>
          <Text style={[styles.poiName, missed && { color: COLORS.textMuted }]} numberOfLines={1}>
            {poi.name}
          </Text>
          {poi.address ? (
            <Text style={styles.poiAddr} numberOfLines={1}>{poi.address}</Text>
          ) : null}
          {poi.rating ? (
            <Text style={styles.poiRating}>⭐ {poi.rating}</Text>
          ) : null}
        </View>
      </View>

      {/* Right side: distance + badges + maps button */}
      <View style={styles.cardRight}>
        {missed ? (
          <View style={styles.missedBadge}>
            <Text style={styles.missedBadgeText}>PASSED</Text>
          </View>
        ) : (
          <Text style={styles.distText}>{formatDist(poi.distance_m)}</Text>
        )}
        <Pressable
          style={styles.mapsBtn}
          onPress={onOpenMaps}
          hitSlop={8}
        >
          <Text style={styles.mapsBtnText}>🗺 Maps</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  panel: {
    backgroundColor:  COLORS.surface,
    borderRadius:     RADIUS.xl,
    borderWidth:      1,
    borderColor:      COLORS.warning,
    alignSelf:        'stretch',   // fill full width inside ScrollView
    marginBottom:     SPACING.md,
    overflow:         'hidden',
    maxHeight:        360,
  },

  header: {
    flexDirection:    'row',
    alignItems:       'center',
    justifyContent:   'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical:   SPACING.sm,
    backgroundColor:  'rgba(255,176,32,0.10)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,176,32,0.18)',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, flex: 1 },
  warningDot: { fontSize: 18, color: COLORS.warning },
  title:      { fontSize: 13, fontWeight: '800', color: COLORS.warning, letterSpacing: 0.3 },
  subtitle:   { fontSize: 11, color: COLORS.textMuted, marginTop: 1 },
  closeBtn:   { padding: 4 },
  closeX:     { fontSize: 14, color: COLORS.textMuted },

  loadingText: {
    color: COLORS.textSecondary, fontSize: 13,
    textAlign: 'center', padding: SPACING.lg,
  },
  emptyText: {
    color: COLORS.textMuted, fontSize: 12,
    textAlign: 'center', padding: SPACING.lg, lineHeight: 20,
  },

  scroll: { maxHeight: 280 },

  missedLabel: {
    fontSize: 11, fontWeight: '700', color: COLORS.textMuted,
    letterSpacing: 0.8, textTransform: 'uppercase',
    paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: 4,
  },

  card: {
    flexDirection:    'row',
    alignItems:       'center',
    marginHorizontal: SPACING.sm,
    marginVertical:   4,
    borderRadius:     RADIUS.md,
    borderWidth:      1,
    padding:          SPACING.sm,
    gap:              SPACING.sm,
  },
  rankBadge: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: COLORS.warning,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  rankText:    { fontSize: 11, fontWeight: '800', color: COLORS.black },

  cardLeft:    { flexDirection: 'row', alignItems: 'center', flex: 1, gap: SPACING.sm, overflow: 'hidden' },
  poiIcon:     { fontSize: 22, flexShrink: 0 },
  poiInfo:     { flex: 1, overflow: 'hidden' },
  poiName:     { fontSize: 13, fontWeight: '700', color: COLORS.textPrimary },
  poiAddr:     { fontSize: 11, color: COLORS.textMuted, marginTop: 1 },
  poiRating:   { fontSize: 11, color: COLORS.textSecondary, marginTop: 1 },

  cardRight:   { alignItems: 'flex-end', gap: 6, flexShrink: 0 },
  distText:    { fontSize: 13, fontWeight: '800', color: COLORS.warning },

  missedBadge: {
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: RADIUS.sm,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  missedBadgeText: { fontSize: 9, fontWeight: '800', color: COLORS.textMuted, letterSpacing: 0.8 },

  mapsBtn: {
    backgroundColor: COLORS.brand,
    borderRadius:    RADIUS.sm,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  mapsBtnText: { fontSize: 11, fontWeight: '700', color: COLORS.white },
});
