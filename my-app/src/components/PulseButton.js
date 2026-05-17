import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS, RADIUS, SHADOW } from '../theme';

/**
 * Large, animated CTA button with idle breathe pulse and press feedback.
 * Used for both "Start Drive" and "End Drive" actions.
 */
export default function PulseButton({ label, subLabel, onPress, variant = 'start', disabled = false }) {
  const pulseAnim  = useRef(new Animated.Value(1)).current;
  const pressAnim  = useRef(new Animated.Value(1)).current;

  const isStart  = variant === 'start';
  const primary  = isStart ? COLORS.safe    : COLORS.danger;
  const dim      = isStart ? COLORS.safeDim : COLORS.dangerDim;

  // Idle breathing pulse
  useEffect(() => {
    if (disabled) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 1400, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(pulseAnim, { toValue: 1.00, duration: 1400, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [disabled]);

  const handlePressIn = () => {
    Animated.spring(pressAnim, { toValue: 0.94, useNativeDriver: true, speed: 30 }).start();
  };
  const handlePressOut = () => {
    Animated.spring(pressAnim, { toValue: 1.00, useNativeDriver: true, speed: 20 }).start();
  };

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={styles.pressable}
    >
      {/* Outer glow ring */}
      <Animated.View style={[
        styles.glowRing,
        { borderColor: primary, backgroundColor: dim, transform: [{ scale: pulseAnim }] },
      ]}>
        {/* Inner button */}
        <Animated.View style={[
          styles.button,
          {
            backgroundColor: primary,
            transform: [{ scale: pressAnim }],
            opacity: disabled ? 0.4 : 1,
            shadowColor: primary,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.7,
            shadowRadius: 24,
            elevation: 14,
          },
        ]}>
          <Text style={styles.icon}>{isStart ? '▶' : '■'}</Text>
          <Text style={styles.label}>{label}</Text>
          {subLabel ? <Text style={styles.subLabel}>{subLabel}</Text> : null}
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const SIZE  = 180;
const GLOW  = 220;

const styles = StyleSheet.create({
  pressable: { alignItems: 'center', justifyContent: 'center' },
  glowRing: {
    width:        GLOW,
    height:       GLOW,
    borderRadius: GLOW / 2,
    borderWidth:  1.5,
    alignItems:   'center',
    justifyContent: 'center',
  },
  button: {
    width:          SIZE,
    height:         SIZE,
    borderRadius:   SIZE / 2,
    alignItems:     'center',
    justifyContent: 'center',
  },
  icon:     { fontSize: 28, color: COLORS.black, marginBottom: 4 },
  label:    { fontSize: 18, fontWeight: '800', color: COLORS.black, letterSpacing: 0.5 },
  subLabel: { fontSize: 11, fontWeight: '500', color: 'rgba(0,0,0,0.6)', marginTop: 2 },
});
