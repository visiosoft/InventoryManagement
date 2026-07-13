import React, { createContext, useContext, useReducer, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setToken } from './api';

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
  paper: '#FDFCFA',
  white: '#FFFFFF',
  line: 'rgba(20,8,31,0.08)',
  line2: 'rgba(20,8,31,0.06)',
  line3: 'rgba(20,8,31,0.04)',
  green: '#059669',
  greenBg: '#ECFDF5',
  greenLight: '#22C55E',
  red: '#EF4444',
  redBg: 'rgba(239,68,68,0.06)',
  orange: '#F59E0B',
  orangeBg: '#FFF7ED',
  orangeDark: '#D97706',
  blue: '#2563EB',
  blueBg: '#EFF6FF',
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

export type Screen = 'login' | 'jobs' | 'jobDetail' | 'profile';

export type CrewUser = {
  id: string; name: string; phone: string; role: string;
};

export type AppState = {
  screen: Screen;
  worker: CrewUser | null;
  token: string | null;
  selectedJobId: string | null;
  prevScreen: Screen | null;
};

const initial: AppState = {
  screen: 'login', worker: null, token: null,
  selectedJobId: null, prevScreen: null,
};

type Action =
  | { type: 'LOGIN'; worker: CrewUser; token: string }
  | { type: 'LOGOUT' }
  | { type: 'RESTORE'; worker: CrewUser; token: string }
  | { type: 'GO'; screen: Screen; jobId?: string };

function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'LOGIN': return { ...s, worker: a.worker, token: a.token, screen: 'jobs' };
    case 'LOGOUT': return { ...initial };
    case 'RESTORE': return { ...s, worker: a.worker, token: a.token, screen: 'jobs' };
    case 'GO': return { ...s, screen: a.screen, selectedJobId: a.jobId ?? s.selectedJobId, prevScreen: s.screen };
    default: return s;
  }
}

const SESSION_KEY = 'pb_crew_session';

type Ctx = {
  s: AppState;
  go: (screen: Screen, jobId?: string) => void;
  login: (worker: CrewUser, token: string) => void;
  logout: () => void;
};

const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [s, dispatch] = useReducer(reducer, initial);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(SESSION_KEY).then(raw => {
      if (raw) {
        try {
          const { worker, token } = JSON.parse(raw);
          if (worker && token) {
            setToken(token);
            dispatch({ type: 'RESTORE', worker, token });
          }
        } catch {}
      }
      setReady(true);
    });
  }, []);

  const login = (worker: CrewUser, token: string) => {
    AsyncStorage.setItem(SESSION_KEY, JSON.stringify({ worker, token }));
    dispatch({ type: 'LOGIN', worker, token });
  };

  const logout = () => {
    AsyncStorage.removeItem(SESSION_KEY);
    setToken(null);
    dispatch({ type: 'LOGOUT' });
  };

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.paper }}>
        <ActivityIndicator color={C.purple} size="large" />
      </View>
    );
  }

  return (
    <AppCtx.Provider value={{
      s,
      go: (screen, jobId) => dispatch({ type: 'GO', screen, jobId }),
      login,
      logout,
    }}>
      {children}
    </AppCtx.Provider>
  );
}

export function Icon({ name, size = 20, color = C.ink }: { name: any; size?: number; color?: string }) {
  return <Feather name={name} size={size} color={color} />;
}

export function TabBar({ active }: { active: string }) {
  const { go } = useApp();
  const insets = useSafeAreaInsets();
  const tabs = [
    { id: 'jobs', icon: 'calendar', label: 'Jobs' },
    { id: 'profile', icon: 'user', label: 'Profile' },
  ];
  return (
    <View style={[ui.tabBar, { paddingBottom: Math.max(insets.bottom, 16) + 14 }]}>
      {tabs.map(t => (
        <TouchableOpacity key={t.id} onPress={() => go(t.id as Screen)} style={ui.tab} activeOpacity={0.7}>
          <Icon name={t.icon} size={22} color={active === t.id ? C.purple : C.ink3} />
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
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: C.white, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
});
