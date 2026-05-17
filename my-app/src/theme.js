// ─── Design System ────────────────────────────────────────────────────────────
export const COLORS = {
  // Backgrounds
  bg:              '#05050A',
  surface:         '#0D1017',
  surfaceElevated: '#131825',
  border:          '#1C2235',

  // Brand
  brand:    '#6366F1',
  brandDim: 'rgba(99,102,241,0.15)',

  // Fatigue States
  safe:        '#00D68F',
  safeDim:     'rgba(0,214,143,0.12)',
  warning:     '#FFB020',
  warningDim:  'rgba(255,176,32,0.12)',
  danger:      '#FF453A',
  dangerDim:   'rgba(255,69,58,0.12)',
  critical:    '#FF2222',
  criticalDim: 'rgba(255,34,34,0.20)',

  // Text
  textPrimary:   '#F0F2FF',
  textSecondary: '#8891B4',
  textMuted:     '#454D6A',

  white:       '#FFFFFF',
  black:       '#000000',
  transparent: 'transparent',
};

export const SPACING = {
  xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48,
};

export const RADIUS = {
  sm: 8, md: 12, lg: 16, xl: 24, full: 9999,
};

export const SHADOW = {
  sm: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.35, shadowRadius: 4, elevation: 4 },
  md: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.45, shadowRadius: 8, elevation: 8 },
  glow: (color) => ({ shadowColor: color, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.55, shadowRadius: 18, elevation: 10 }),
};

// State → visual token mapping (single source of truth)
export const STATE_THEME = {
  safe: {
    color:   COLORS.safe,
    dim:     COLORS.safeDim,
    label:   'All Clear',
    labelHi: 'सब ठीक है',
    icon:    '✓',
  },
  warning: {
    color:   COLORS.warning,
    dim:     COLORS.warningDim,
    label:   'Stay Alert',
    labelHi: 'ध्यान दें',
    icon:    '⚠',
  },
  danger: {
    color:   COLORS.danger,
    dim:     COLORS.dangerDim,
    label:   'Pull Over',
    labelHi: 'रुकिए!',
    icon:    '⛔',
  },
  critical: {
    color:   COLORS.critical,
    dim:     COLORS.criticalDim,
    label:   'Rest Mandatory',
    labelHi: 'आराम जरूरी',
    icon:    '🛑',
  },
};
