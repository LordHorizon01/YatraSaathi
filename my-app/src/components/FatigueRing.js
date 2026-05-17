import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet, Easing } from 'react-native';
import { COLORS, STATE_THEME } from '../theme';

/**
 * Circular fatigue score ring.
 * Uses a simple border arc technique — no SVG dependency.
 * Score 1–10 maps to a colour from the STATE_THEME palette.
 */
export default function FatigueRing({ score = 1, state = 'safe', size = 160 }) {
  const glowAnim = useRef(new Animated.Value(0)).current;
  const { color } = STATE_THEME[state] ?? STATE_THEME.safe;

  // Pulse glow when in danger/critical state
  useEffect(() => {
    if (state === 'danger' || state === 'critical') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, { toValue: 1, duration: 800,  useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(glowAnim, { toValue: 0, duration: 800,  useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        ]),
      ).start();
    } else {
      glowAnim.setValue(0);
    }
  }, [state]);

  const opacity = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });
  const strokeWidth = size * 0.08;
  const radius      = (size - strokeWidth) / 2;

  return (
    <Animated.View style={[styles.wrapper, { width: size, height: size, opacity: state === 'danger' || state === 'critical' ? opacity : 1 }]}>
      {/* Outer ring */}
      <View style={[
        styles.ring,
        {
          width:        size,
          height:       size,
          borderRadius: size / 2,
          borderWidth:  strokeWidth,
          borderColor:  color,
          shadowColor:  color,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.6,
          shadowRadius:  strokeWidth * 2,
          elevation:     12,
        },
      ]}>
        {/* Inner content */}
        <View style={styles.inner}>
          <Text style={[styles.score, { color }]}>{score}</Text>
          <Text style={styles.label}>/10</Text>
          <Text style={[styles.stateLabel, { color }]}>
            {STATE_THEME[state]?.label ?? 'Safe'}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', justifyContent: 'center' },
  ring:    { alignItems: 'center', justifyContent: 'center' },
  inner:   { alignItems: 'center' },
  score: {
    fontSize:   48,
    fontWeight: '800',
    lineHeight: 52,
    letterSpacing: -1,
  },
  label: {
    fontSize:   14,
    fontWeight: '500',
    color:      COLORS.textMuted,
    marginTop:  -4,
  },
  stateLabel: {
    fontSize:   11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop:  6,
    textTransform: 'uppercase',
  },
});
