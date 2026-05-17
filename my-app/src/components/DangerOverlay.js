import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { COLORS, RADIUS, SPACING } from '../theme';

/**
 * Full-screen red overlay shown when a fatigued driver is detected
 * within 1km of the current user. Triggered via DangerBubble protocol.
 */
export default function DangerOverlay({ visible, distanceM = 0, onDismiss }) {
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim   = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    if (visible) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Animated.parallel([
        Animated.timing(opacityAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.spring(scaleAnim,   { toValue: 1, speed: 15, bounciness: 6, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.timing(opacityAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
      scaleAnim.setValue(0.9);
    }
  }, [visible]);

  return (
    <Modal transparent visible={visible} animationType="none" statusBarTranslucent>
      <Animated.View style={[styles.backdrop, { opacity: opacityAnim }]}>
        <Animated.View style={[styles.card, { transform: [{ scale: scaleAnim }] }]}>
          <Text style={styles.warningIcon}>⚠️</Text>
          <Text style={styles.title}>Fatigued Driver Nearby</Text>
          <Text style={styles.distance}>{distanceM}m ahead</Text>
          <Text style={styles.body}>
            A vehicle in your vicinity has triggered a DangerBubble.{'\n'}
            Reduce speed and increase following distance.
          </Text>
          <Text style={styles.hindi}>सतर्क रहें – थका हुआ वाहन पास में है</Text>
          <Pressable style={styles.dismissBtn} onPress={onDismiss}>
            <Text style={styles.dismissText}>Acknowledged — I'm Alert</Text>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex:            1,
    backgroundColor: 'rgba(255,34,34,0.25)',
    alignItems:      'center',
    justifyContent:  'center',
    padding:         SPACING.lg,
  },
  card: {
    backgroundColor: '#1A0A0A',
    borderRadius:    RADIUS.xl,
    borderWidth:     1.5,
    borderColor:     COLORS.danger,
    padding:         SPACING.xl,
    alignItems:      'center',
    width:           '100%',
    shadowColor:     COLORS.danger,
    shadowOffset:    { width: 0, height: 0 },
    shadowOpacity:   0.6,
    shadowRadius:    24,
    elevation:       16,
  },
  warningIcon: { fontSize: 52, marginBottom: SPACING.md },
  title: {
    fontSize:      22,
    fontWeight:    '800',
    color:         COLORS.danger,
    textAlign:     'center',
    letterSpacing: -0.3,
  },
  distance: {
    fontSize:   14,
    fontWeight: '600',
    color:      COLORS.textSecondary,
    marginTop:  SPACING.xs,
    marginBottom: SPACING.md,
  },
  body: {
    fontSize:   14,
    color:      COLORS.textSecondary,
    textAlign:  'center',
    lineHeight: 21,
  },
  hindi: {
    fontSize:   13,
    color:      COLORS.textMuted,
    marginTop:  SPACING.sm,
    fontStyle:  'italic',
    textAlign:  'center',
  },
  dismissBtn: {
    marginTop:       SPACING.lg,
    backgroundColor: COLORS.danger,
    borderRadius:    RADIUS.full,
    paddingVertical: 14,
    paddingHorizontal: 28,
  },
  dismissText: { fontSize: 14, fontWeight: '700', color: COLORS.white },
});
