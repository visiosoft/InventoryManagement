import React, { createContext, useContext, useReducer } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ViewStyle, TextStyle, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const C = {
  purple: '#5B2BC9',
  purpleDark: '#4A1FA0',
  purple2: '#7C4DFF',
  purpleLite: '#F7F3FF',
  purpleBg: '#EDE5FF',
  ink: '#14081F',
  ink2: '#4A4357',
  ink3: '#756E80',
  faint: '#CFC9D6',
  paper: '#FBF8F2',
  white: '#FFFFFF',
  line: 'rgba(20,8,31,0.12)',
  line2: 'rgba(20,8,31,0.08)',
  green: '#1F8A5B',
  greenBg: '#E7F7EE',
  red: '#D44444',
  redBg: '#FFF0F0',
  orange: '#E8850C',
  orangeBg: '#FFF8EE',
  overlay: 'rgba(20,8,31,0.55)',
};

export const F = {
  reg: 'Jakarta',
  med: 'Jakarta-Med',
  semi: 'Jakarta-Semi',
  bold: 'Jakarta-Bold',
  display: 'Bricolage',
  displayXB: 'Bricolage-XB',
};

export type Screen =
  | 'login' | 'otp'
  | 'hub' | 'history' | 'profile'
  | 'booking' | 'bookingSubmitted'
  | 'moveDetail';

export type CustomerUser = {
  id: string;
  fullName: string;
  phone: string;
  email: string;
};

export type AppState = {
  screen: Screen;
  customer: CustomerUser | null;
  token: string | null;
  phone: string;
  selectedMoveId: string | null;
  prevScreen: Screen | null;
};

const initial: AppState = {
  screen: 'login',
  customer: null,
  token: null,
  phone: '',
  selectedMoveId: null,
  prevScreen: null,
};

type Action =
  | { type: 'SET_PHONE'; phone: string }
  | { type: 'LOGIN'; customer: CustomerUser; token: string }
  | { type: 'LOGOUT' }
  | { type: 'GO'; screen: Screen; moveId?: string }
  | { type: 'UPDATE_PROFILE'; customer: CustomerUser };

function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'SET_PHONE':
      return { ...s, phone: a.phone, screen: 'otp' };
    case 'LOGIN':
      return { ...s, customer: a.customer, token: a.token, screen: 'hub' };
    case 'LOGOUT':
      return { ...initial };
    case 'GO':
      return {
        ...s,
        screen: a.screen,
        selectedMoveId: a.moveId ?? s.selectedMoveId,
        prevScreen: s.screen,
      };
    case 'UPDATE_PROFILE':
      return { ...s, customer: a.customer };
    default:
      return s;
  }
}

type Ctx = {
  s: AppState;
  go: (screen: Screen, moveId?: string) => void;
  setPhone: (phone: string) => void;
  login: (customer: CustomerUser, token: string) => void;
  logout: () => void;
  updateProfile: (customer: CustomerUser) => void;
};

const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [s, dispatch] = useReducer(reducer, initial);
  const value: Ctx = {
    s,
    go: (screen, moveId) => dispatch({ type: 'GO', screen, moveId }),
    setPhone: (phone) => dispatch({ type: 'SET_PHONE', phone }),
    login: (customer, token) => dispatch({ type: 'LOGIN', customer, token }),
    logout: () => dispatch({ type: 'LOGOUT' }),
    updateProfile: (customer) => dispatch({ type: 'UPDATE_PROFILE', customer }),
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

export function TopBar({ title, onBack, right }: {
  title?: string; onBack?: () => void; right?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[ui.topbar, { paddingTop: insets.top + 6 }]}>
      {onBack && (
        <TouchableOpacity onPress={onBack} style={ui.backBtn} activeOpacity={0.7}>
          <Icon name="chevron-left" size={20} color={C.ink} />
        </TouchableOpacity>
      )}
      {title && <Text style={ui.topTitle}>{title}</Text>}
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

export function Footer({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return <View style={[ui.footer, { paddingBottom: Math.max(insets.bottom, 16) + 6 }]}>{children}</View>;
}

const NAV_TABS: { key: Screen; icon: string; label: string }[] = [
  { key: 'hub', icon: 'home', label: 'Home' },
  { key: 'history', icon: 'clock', label: 'My Moves' },
  { key: 'profile', icon: 'user', label: 'Profile' },
];

export function BottomNav() {
  const { s, go } = useApp();
  const insets = useSafeAreaInsets();
  return (
    <View style={[ui.nav, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {NAV_TABS.map((tab) => {
        const active = s.screen === tab.key;
        return (
          <TouchableOpacity key={tab.key} onPress={() => go(tab.key)} style={ui.navTab} activeOpacity={0.7}>
            <View style={[ui.navIconWrap, active && ui.navIconWrapOn]}>
              <Icon name={tab.icon} size={20} color={active ? C.purple : C.ink3} />
            </View>
            <Text style={[ui.navLabel, active && ui.navLabelOn]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    new: { bg: C.purpleBg, color: C.purple, label: 'Submitted' },
    contacted: { bg: C.orangeBg, color: C.orange, label: 'In Review' },
    quoted: { bg: 'rgba(59,130,246,0.1)', color: '#3b82f6', label: 'Quoted' },
    won: { bg: C.greenBg, color: C.green, label: 'Confirmed' },
    lost: { bg: C.redBg, color: C.red, label: 'Declined' },
    draft: { bg: 'rgba(20,8,31,0.06)', color: C.ink3, label: 'Draft' },
    confirmed: { bg: C.purpleBg, color: C.purple, label: 'Confirmed' },
    survey_done: { bg: C.orangeBg, color: C.orange, label: 'Survey Done' },
    in_progress: { bg: 'rgba(59,130,246,0.1)', color: '#3b82f6', label: 'In Progress' },
    completed: { bg: C.greenBg, color: C.green, label: 'Completed' },
    invoiced: { bg: 'rgba(16,185,129,0.1)', color: '#10b981', label: 'Invoiced' },
    cancelled: { bg: C.redBg, color: C.red, label: 'Cancelled' },
  };
  const st = map[status] || { bg: 'rgba(20,8,31,0.06)', color: C.ink3, label: status };
  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: st.bg }}>
      <Text style={{ fontFamily: F.semi, fontSize: 11, color: st.color }}>{st.label}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[ui.card, style]}>{children}</View>;
}

export { TextInput, View, Text, TouchableOpacity, StyleSheet, ScrollView, KeyboardAvoidingView, Platform };
export type { ViewStyle, TextStyle };

const ui = StyleSheet.create({
  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 52, borderRadius: 14, backgroundColor: C.purple,
    shadowColor: C.purple, shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 4,
  },
  primaryTxt: { color: C.white, fontFamily: F.semi, fontSize: 15 },
  outline: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 48, borderRadius: 14, backgroundColor: C.white, borderWidth: 1.5, borderColor: C.line,
  },
  outlineTxt: { color: C.ink, fontFamily: F.semi, fontSize: 14 },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingBottom: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 999, borderWidth: 1, borderColor: C.line, backgroundColor: C.white, alignItems: 'center', justifyContent: 'center' },
  topTitle: { fontFamily: F.display, fontSize: 18, color: C.ink },
  footer: { paddingHorizontal: 22, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.line2, backgroundColor: C.paper },
  nav: { flexDirection: 'row', backgroundColor: C.white, borderTopWidth: 1, borderTopColor: C.line2, paddingTop: 8 },
  navTab: { flex: 1, alignItems: 'center', gap: 4 },
  navIconWrap: { width: 44, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  navIconWrapOn: { backgroundColor: C.purpleLite },
  navLabel: { fontFamily: F.med, fontSize: 10, color: C.faint },
  navLabelOn: { fontFamily: F.semi, color: C.purple },
  card: {
    backgroundColor: C.white, borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: C.line2,
  },
});
