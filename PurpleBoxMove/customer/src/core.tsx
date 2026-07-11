import React, { createContext, useContext, useReducer } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
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
  line: 'rgba(20,8,31,0.08)',
  line2: 'rgba(20,8,31,0.06)',
  line3: 'rgba(20,8,31,0.04)',
  green: '#22c55e',
  greenBg: 'rgba(34,197,94,0.15)',
  red: '#ef4444',
  redBg: 'rgba(239,68,68,0.06)',
  orange: '#f59e0b',
  overlay: 'rgba(20,8,31,0.55)',
  lavender: '#A78BFA',
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
  | 'login'
  | 'home' | 'booking' | 'quote' | 'tracking' | 'history' | 'profile'
  | 'moveDetail';

export type CustomerUser = {
  id: string; fullName: string; phone: string; email: string;
};

export type AppState = {
  screen: Screen;
  customer: CustomerUser | null;
  token: string | null;
  selectedMoveId: string | null;
  prevScreen: Screen | null;
  bookingStep: number;
  selectedService: string | null;
};

const initial: AppState = {
  screen: 'login', customer: null, token: null,
  selectedMoveId: null, prevScreen: null,
  bookingStep: 0, selectedService: null,
};

type Action =
  | { type: 'LOGIN'; customer: CustomerUser; token: string }
  | { type: 'LOGOUT' }
  | { type: 'GO'; screen: Screen; moveId?: string }
  | { type: 'UPDATE_PROFILE'; customer: CustomerUser }
  | { type: 'SET_BOOKING_STEP'; step: number }
  | { type: 'SET_SERVICE'; service: string };

function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'LOGIN': return { ...s, customer: a.customer, token: a.token, screen: 'home' };
    case 'LOGOUT': return { ...initial };
    case 'GO': return { ...s, screen: a.screen, selectedMoveId: a.moveId ?? s.selectedMoveId, prevScreen: s.screen };
    case 'UPDATE_PROFILE': return { ...s, customer: a.customer };
    case 'SET_BOOKING_STEP': return { ...s, bookingStep: a.step };
    case 'SET_SERVICE': return { ...s, selectedService: a.service, bookingStep: 1, screen: 'booking' };
    default: return s;
  }
}

type Ctx = {
  s: AppState;
  go: (screen: Screen, moveId?: string) => void;
  login: (customer: CustomerUser, token: string) => void;
  logout: () => void;
  updateProfile: (customer: CustomerUser) => void;
  setBookingStep: (step: number) => void;
  selectService: (service: string) => void;
};

const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [s, dispatch] = useReducer(reducer, initial);
  return (
    <AppCtx.Provider value={{
      s,
      go: (screen, moveId) => dispatch({ type: 'GO', screen, moveId }),
      login: (customer, token) => dispatch({ type: 'LOGIN', customer, token }),
      logout: () => dispatch({ type: 'LOGOUT' }),
      updateProfile: (customer) => dispatch({ type: 'UPDATE_PROFILE', customer }),
      setBookingStep: (step) => dispatch({ type: 'SET_BOOKING_STEP', step }),
      selectService: (service) => dispatch({ type: 'SET_SERVICE', service }),
    }}>
      {children}
    </AppCtx.Provider>
  );
}

/* ─── SHARED UI ─── */
export function Icon({ name, size = 20, color = C.ink }: { name: any; size?: number; color?: string }) {
  return <Feather name={name} size={size} color={color} />;
}

export function TabBar({ active }: { active: string }) {
  const { go } = useApp();
  const insets = useSafeAreaInsets();
  const tabs = [
    { id: 'home', icon: 'home', label: 'Home' },
    { id: 'history', icon: 'calendar', label: 'Bookings' },
    { id: 'tracking', icon: 'map-pin', label: 'Track' },
    { id: 'profile', icon: 'user', label: 'Profile' },
  ];
  return (
    <View style={[ui.tabBar, { paddingBottom: Math.max(insets.bottom, 16) + 14 }]}>
      {tabs.map(t => (
        <TouchableOpacity key={t.id} onPress={() => go(t.id as Screen)} style={ui.tab} activeOpacity={0.7}>
          <Icon name={t.icon} size={20} color={active === t.id ? C.purple : C.ink3} />
          <Text style={[ui.tabLabel, active === t.id && ui.tabLabelOn]}>{t.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={ui.backBtn} activeOpacity={0.7}>
      <Icon name="arrow-left" size={18} color={C.ink} />
    </TouchableOpacity>
  );
}

const ui = StyleSheet.create({
  tabBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-start',
    paddingTop: 10, backgroundColor: C.white,
    borderTopWidth: 1, borderTopColor: C.line,
  },
  tab: { alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 4 },
  tabLabel: { fontFamily: F.med, fontSize: 10, color: C.ink3 },
  tabLabelOn: { fontFamily: F.bold, color: C.purple },
  backBtn: {
    width: 36, height: 36, borderRadius: 12,
    backgroundColor: C.line3, alignItems: 'center', justifyContent: 'center',
  },
});
