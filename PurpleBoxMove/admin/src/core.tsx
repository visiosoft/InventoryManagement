import React, { createContext, useContext, useReducer } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ViewStyle, TextStyle, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setToken } from './api';

/* ─── THEME ─── */
export const C = {
  purple: '#5B2BC9',
  purpleDark: '#4A1FA0',
  purple2: '#7C4DFF',
  purpleLite: '#F7F3FF',
  purpleBg: '#EDE5FF',
  ink: '#14081F',
  ink2: '#4A4357',
  ink3: '#756E80',
  muted: '#A0977F',
  faint: '#CFC9D6',
  paper: '#FBF8F2',
  warm: '#F1EDE3',
  white: '#FFFFFF',
  border: 'rgba(20,8,31,0.08)',
  line: 'rgba(20,8,31,0.12)',
  line2: 'rgba(20,8,31,0.08)',
  divider: 'rgba(20,8,31,0.07)',
  green: '#22A15B',
  greenBg: '#E3F5EA',
  greenFg: '#186B3D',
  red: '#D1495B',
  redBg: '#FBE7EA',
  redFg: '#9B2233',
  orange: '#E8930C',
  orangeBg: '#FFF0DB',
  orangeFg: '#9A5B00',
  overlay: 'rgba(20,8,31,0.42)',
};

export const F = {
  reg: 'Jakarta',
  med: 'Jakarta-Med',
  semi: 'Jakarta-Semi',
  bold: 'Jakarta-Bold',
  display: 'Bricolage',
  displayXB: 'Bricolage-XB',
  mono: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
};

/* ─── STATUS COLORS ─── */
export const STATUS_COLORS: Record<string, { bar: string; chipBg: string; chipFg: string; label: string }> = {
  draft:       { bar: '#C9C2B3', chipBg: '#F1EDE3', chipFg: '#756E80', label: 'Draft' },
  confirmed:   { bar: '#5B2BC9', chipBg: '#EDE5FF', chipFg: '#4A1FA0', label: 'Confirmed' },
  in_progress: { bar: '#E8930C', chipBg: '#FFF0DB', chipFg: '#9A5B00', label: 'In Progress' },
  progress:    { bar: '#E8930C', chipBg: '#FFF0DB', chipFg: '#9A5B00', label: 'In Progress' },
  completed:   { bar: '#22A15B', chipBg: '#E3F5EA', chipFg: '#186B3D', label: 'Completed' },
  invoiced:    { bar: '#22A15B', chipBg: '#E3F5EA', chipFg: '#186B3D', label: 'Invoiced' },
  cancelled:   { bar: '#D1495B', chipBg: '#FBE7EA', chipFg: '#9B2233', label: 'Cancelled' },
  survey_done: { bar: '#22A15B', chipBg: '#E3F5EA', chipFg: '#186B3D', label: 'Survey Done' },
  sent:        { bar: '#5B2BC9', chipBg: '#EDE5FF', chipFg: '#4A1FA0', label: 'Sent' },
  approved:    { bar: '#22A15B', chipBg: '#E3F5EA', chipFg: '#186B3D', label: 'Approved' },
  accepted:    { bar: '#22A15B', chipBg: '#E3F5EA', chipFg: '#186B3D', label: 'Accepted' },
  rejected:    { bar: '#D1495B', chipBg: '#FBE7EA', chipFg: '#9B2233', label: 'Rejected' },
  declined:    { bar: '#D1495B', chipBg: '#FBE7EA', chipFg: '#9B2233', label: 'Declined' },
  converted:   { bar: '#5B2BC9', chipBg: '#EDE5FF', chipFg: '#4A1FA0', label: 'Converted' },
  paid:        { bar: '#22A15B', chipBg: '#E3F5EA', chipFg: '#186B3D', label: 'Paid' },
  partial:     { bar: '#E8930C', chipBg: '#FFF0DB', chipFg: '#9A5B00', label: 'Partial' },
  overdue:     { bar: '#D1495B', chipBg: '#FBE7EA', chipFg: '#9B2233', label: 'Overdue' },
  unpaid:      { bar: '#E8930C', chipBg: '#FFF0DB', chipFg: '#9A5B00', label: 'Unpaid' },
  scheduled:   { bar: '#5B2BC9', chipBg: '#EDE5FF', chipFg: '#4A1FA0', label: 'Scheduled' },
  new:         { bar: '#5B2BC9', chipBg: '#EDE5FF', chipFg: '#4A1FA0', label: 'New' },
  contacted:   { bar: '#E8930C', chipBg: '#FFF0DB', chipFg: '#9A5B00', label: 'Contacted' },
  qualified:   { bar: '#22A15B', chipBg: '#E3F5EA', chipFg: '#186B3D', label: 'Qualified' },
  quoted:      { bar: '#5B2BC9', chipBg: '#EDE5FF', chipFg: '#4A1FA0', label: 'Quoted' },
  won:         { bar: '#22A15B', chipBg: '#E3F5EA', chipFg: '#186B3D', label: 'Won' },
  lost:        { bar: '#D1495B', chipBg: '#FBE7EA', chipFg: '#9B2233', label: 'Lost' },
  follow_up:   { bar: '#E8930C', chipBg: '#FFF0DB', chipFg: '#9A5B00', label: 'Follow Up' },
  active:      { bar: '#22A15B', chipBg: '#E3F5EA', chipFg: '#186B3D', label: 'Active' },
  available:   { bar: '#22A15B', chipBg: '#E3F5EA', chipFg: '#186B3D', label: 'Available' },
  viewed:      { bar: '#7C4DFF', chipBg: '#F7F3FF', chipFg: '#5B2BC9', label: 'Viewed' },
  to_book:     { bar: '#E8930C', chipBg: '#FFF0DB', chipFg: '#9A5B00', label: 'To Book' },
  surveyed:    { bar: '#22A15B', chipBg: '#E3F5EA', chipFg: '#186B3D', label: 'Surveyed' },
};

const DEFAULT_STATUS = { bar: '#C9C2B3', chipBg: '#F1EDE3', chipFg: '#756E80', label: '' };

export function getStatusStyle(status: string) {
  return STATUS_COLORS[status] || { ...DEFAULT_STATUS, label: status };
}

/* ─── STATE ─── */
export type Screen =
  | 'login'
  | 'dashboard'
  | 'jobs' | 'jobDetail' | 'newJob'
  | 'schedule'
  | 'profile'
  | 'quotes' | 'quoteDetail' | 'newQuote'
  | 'invoices' | 'invoiceDetail' | 'newInvoice'
  | 'siteVisits' | 'newSiteVisit'
  | 'leads'
  | 'workers'
  | 'fleet';

export type AppUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions?: string[];
};

export type AppState = {
  screen: Screen;
  user: AppUser | null;
  token: string | null;
  selectedJobId: string | null;
  selectedItemId: string | null;
  prevScreen: Screen | null;
};

const initial: AppState = {
  screen: 'login',
  user: null,
  token: null,
  selectedJobId: null,
  selectedItemId: null,
  prevScreen: null,
};

type Action =
  | { type: 'LOGIN'; user: AppUser; token: string }
  | { type: 'LOGOUT' }
  | { type: 'GO'; screen: Screen; jobId?: string; itemId?: string };

function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'LOGIN':
      return { ...s, user: a.user, token: a.token, screen: 'dashboard' };
    case 'LOGOUT':
      return { ...initial };
    case 'GO':
      return {
        ...s,
        screen: a.screen,
        selectedJobId: a.jobId ?? s.selectedJobId,
        selectedItemId: a.itemId ?? s.selectedItemId,
        prevScreen: s.screen,
      };
    default:
      return s;
  }
}

type Ctx = {
  s: AppState;
  go: (screen: Screen, jobId?: string, itemId?: string) => void;
  login: (user: AppUser, token: string) => void;
  logout: () => void;
};

const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

export function MoveProvider({ children }: { children: React.ReactNode }) {
  const [s, dispatch] = useReducer(reducer, initial);
  const value: Ctx = {
    s,
    go: (screen, jobId, itemId) => dispatch({ type: 'GO', screen, jobId, itemId }),
    login: (user, token) => dispatch({ type: 'LOGIN', user, token }),
    logout: () => dispatch({ type: 'LOGOUT' }),
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

/* ─── SHARED UI ─── */
export function Icon({ name, size = 20, color = C.ink }: { name: any; size?: number; color?: string }) {
  return <Feather name={name} size={size} color={color} />;
}

export function PrimaryButton({ label, icon, onPress, disabled, style }: {
  label: string; icon?: any; onPress: () => void; disabled?: boolean; style?: ViewStyle;
}) {
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={disabled ? undefined : onPress}
      style={[ui.primary, disabled && { opacity: 0.5 }, style]}>
      {icon && <Icon name={icon} size={18} color={C.white} />}
      <Text style={ui.primaryTxt}>{label}</Text>
    </TouchableOpacity>
  );
}

export function OutlineButton({ label, icon, onPress, style }: {
  label: string; icon?: any; onPress: () => void; style?: ViewStyle;
}) {
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={[ui.outline, style]}>
      {icon && <Icon name={icon} size={16} color={C.ink} />}
      <Text style={ui.outlineTxt}>{label}</Text>
    </TouchableOpacity>
  );
}

export function TopBar({ title, subtitle, onBack, right }: {
  title?: string; subtitle?: string; onBack?: () => void; right?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[ui.topbar, { paddingTop: insets.top + 8 }]}>
      {onBack && (
        <TouchableOpacity onPress={onBack} style={ui.backBtn} activeOpacity={0.7}>
          <Icon name="chevron-left" size={16} color={C.white} />
        </TouchableOpacity>
      )}
      <View style={{ flex: 1 }}>
        {title && <Text style={ui.topTitle}>{title}</Text>}
        {subtitle && <Text style={ui.topSubtitle}>{subtitle}</Text>}
      </View>
      {right}
    </View>
  );
}

export function Footer({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return <View style={[ui.footer, { paddingBottom: Math.max(insets.bottom, 16) + 6 }]}>{children}</View>;
}

/* ─── BOTTOM NAV (dark floating pill) ─── */
const LEFT_TABS: { key: Screen; icon: string; label: string }[] = [
  { key: 'dashboard', icon: 'home', label: 'Home' },
  { key: 'schedule', icon: 'calendar', label: 'Schedule' },
];
const RIGHT_TABS: { key: Screen; icon: string; label: string }[] = [
  { key: 'jobs', icon: 'briefcase', label: 'Jobs' },
  { key: 'profile', icon: 'user', label: 'You' },
];

export function BottomNav() {
  const { s, go } = useApp();
  const insets = useSafeAreaInsets();

  const renderTab = (tab: { key: Screen; icon: string; label: string }) => {
    const active = s.screen === tab.key;
    return (
      <TouchableOpacity key={tab.key} onPress={() => go(tab.key)} style={ui.navTab} activeOpacity={0.7}>
        <Icon name={tab.icon} size={21} color={active ? C.white : 'rgba(255,255,255,0.4)'} />
        <Text style={[ui.navLabel, active && ui.navLabelOn]}>{tab.label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[ui.navOuter, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <View style={ui.navPill}>
        {LEFT_TABS.map(renderTab)}
        <View style={ui.navCenter}>
          <TouchableOpacity onPress={() => go('newJob')} style={ui.navPlusBtn} activeOpacity={0.85}>
            <Icon name="plus" size={24} color={C.white} />
          </TouchableOpacity>
        </View>
        {RIGHT_TABS.map(renderTab)}
      </View>
    </View>
  );
}

/* ─── STATUS BADGE (chip style) ─── */
export function StatusBadge({ status }: { status: string }) {
  const st = getStatusStyle(status);
  return (
    <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: st.chipBg }}>
      <Text style={{ fontFamily: F.bold, fontSize: 10, color: st.chipFg, letterSpacing: 0.3 }}>
        {(st.label || status).replace(/_/g, ' ')}
      </Text>
    </View>
  );
}

/* ─── STAT CARD ─── */
export function StatCard({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <View style={ui.statCard}>
      <Text style={[ui.statVal, color ? { color } : null]}>{value}</Text>
      <Text style={ui.statLabel}>{label}</Text>
    </View>
  );
}

/* ─── SECTION LABEL (uppercase muted) ─── */
export function SectionLabel({ children, right }: { children: string; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <Text style={ui.sectionLabel}>{children}</Text>
      {right}
    </View>
  );
}

export { TextInput, View, Text, TouchableOpacity, StyleSheet };
export type { ViewStyle, TextStyle };

/* ─── STYLES ─── */
const ui = StyleSheet.create({
  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 54, borderRadius: 18, backgroundColor: C.purple,
    shadowColor: C.purple, shadowOpacity: 0.32, shadowRadius: 12, shadowOffset: { width: 0, height: 10 }, elevation: 6,
  },
  primaryTxt: { color: C.white, fontFamily: F.bold, fontSize: 15 },
  outline: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 50, borderRadius: 18, backgroundColor: 'transparent', borderWidth: 1, borderColor: C.line,
  },
  outlineTxt: { color: C.ink3, fontFamily: F.bold, fontSize: 14 },

  topbar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 22, paddingBottom: 12,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 13,
    backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center',
  },
  topTitle: { fontFamily: F.displayXB, fontSize: 24, color: C.ink, letterSpacing: -0.5 },
  topSubtitle: { fontFamily: F.semi, fontSize: 12, color: C.muted, marginTop: 2 },

  footer: {
    paddingHorizontal: 22, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: C.divider, backgroundColor: C.paper,
  },

  navOuter: {
    position: 'absolute' as const, left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, zIndex: 30,
  },
  navPill: {
    height: 64, borderRadius: 26, backgroundColor: C.ink,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8,
    shadowColor: C.ink, shadowOpacity: 0.32, shadowRadius: 17,
    shadowOffset: { width: 0, height: 14 }, elevation: 20,
  },
  navTab: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, height: 64,
  },
  navLabel: { fontFamily: F.bold, fontSize: 10, color: 'rgba(255,255,255,0.4)' },
  navLabelOn: { color: C.white },
  navCenter: { flex: 0, width: 64, alignItems: 'center', justifyContent: 'center' },
  navPlusBtn: {
    width: 52, height: 52, borderRadius: 20,
    backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center',
    shadowColor: C.purple, shadowOpacity: 0.5, shadowRadius: 10,
    shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },

  statCard: {
    flex: 1, backgroundColor: C.white, borderWidth: 1, borderColor: C.border,
    borderRadius: 18, padding: 12,
  },
  statVal: {
    fontFamily: F.displayXB, fontSize: 26, color: C.ink,
    letterSpacing: -0.5, lineHeight: 28,
  },
  statLabel: { fontFamily: F.semi, fontSize: 11, color: C.ink3, marginTop: 5 },

  sectionLabel: {
    fontFamily: F.bold, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' as const,
    color: C.muted,
  },
});
