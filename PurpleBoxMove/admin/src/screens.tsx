import React, { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react';
import {
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
  RefreshControl, FlatList, Alert, Image, Linking,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  C, F, Icon, PrimaryButton, OutlineButton, TopBar, Footer, BottomNav,
  StatusBadge, SectionLabel, StatCard, useApp, getStatusStyle,
} from './core';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, setToken } from './api';

const TAB_SCREENS = new Set(['dashboard', 'jobs', 'schedule', 'profile']);
const MONO = F.mono;

/* ─── Toast ─── */
const ToastCtx = createContext<{ toast: (m: string) => void }>({ toast: () => {} });
const useToast = () => useContext(ToastCtx);

/* ─── Helpers ─── */
function fmtDate(d: string | undefined) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function shortDate(d: string | undefined) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
function shortAddr(a: string | undefined) {
  if (!a) return '—';
  return a.length > 38 ? a.substring(0, 38) + '…' : a;
}
function isoDate(d: Date) { return d.toISOString().split('T')[0]; }
function fmtAED(n: number) { return `AED ${Math.round(n).toLocaleString()}`; }

function getJobAction(status: string): { label: string; bg: string; fg: string; next: string; toast: string } | null {
  switch (status) {
    case 'draft': return { label: 'Confirm', bg: C.ink, fg: C.white, next: 'confirmed', toast: 'Job confirmed' };
    case 'confirmed': return { label: 'Start', bg: '#EDE5FF', fg: '#4A1FA0', next: 'in_progress', toast: 'Job started' };
    case 'in_progress': return { label: 'Complete', bg: '#E3F5EA', fg: '#186B3D', next: 'completed', toast: 'Job completed' };
    case 'completed': return { label: 'Invoice', bg: '#F1EDE3', fg: '#756E80', next: '', toast: 'Invoice sent' };
    default: return null;
  }
}

/* ═══ ROUTER ═══ */
export function Router() {
  const { s } = useApp();
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((m: string) => {
    setToastMsg(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 2200);
  }, []);

  const map: Record<string, React.ReactNode> = {
    login: <LoginScreen />,
    dashboard: <DashboardScreen />,
    jobs: <JobsScreen />,
    jobDetail: <JobDetailScreen />,
    newJob: <NewJobScreen />,
    schedule: <ScheduleScreen />,
    profile: <ProfileScreen />,
    quotes: <QuotesScreen />,
    quoteDetail: <QuoteDetailScreen />,
    newQuote: <NewQuoteScreen />,
    invoices: <InvoicesScreen />,
    invoiceDetail: <InvoiceDetailScreen />,
    newInvoice: <NewInvoiceScreen />,
    siteVisits: <SiteVisitsScreen />,
    newSiteVisit: <NewSiteVisitScreen />,
    leads: <LeadsScreen />,
    workers: <WorkersScreen />,
    fleet: <FleetScreen />,
  };
  const showNav = TAB_SCREENS.has(s.screen);
  return (
    <ToastCtx.Provider value={{ toast }}>
      <View style={{ flex: 1, backgroundColor: C.paper }}>
        <View style={{ flex: 1 }}>{map[s.screen]}</View>
        {showNav && <BottomNav />}
        {!!toastMsg && (
          <View style={st.toast} pointerEvents="none">
            <Icon name="check" size={17} color="#6EE7A8" />
            <Text style={st.toastText}>{toastMsg}</Text>
          </View>
        )}
      </View>
    </ToastCtx.Provider>
  );
}

/* ═══ SHARED COMPONENTS ═══ */

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={{ alignItems: 'center', paddingTop: 60 }}>
      <Icon name={icon} size={40} color={C.faint} />
      <Text style={{ fontFamily: F.semi, fontSize: 15, color: C.ink3, marginTop: 14 }}>{text}</Text>
    </View>
  );
}

function FilterChips({ filters, active, counts, onSelect }: {
  filters: { key: string; label: string }[];
  active: string;
  counts?: Record<string, number>;
  onSelect: (k: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 7, paddingVertical: 12 }}>
      {filters.map(f => {
        const on = active === f.key;
        const cnt = counts?.[f.key];
        return (
          <TouchableOpacity key={f.key} onPress={() => onSelect(f.key)} activeOpacity={0.85}
            style={[st.fChip, on && st.fChipOn]}>
            <Text style={[st.fChipTxt, on && st.fChipTxtOn]}>{f.label}</Text>
            {cnt !== undefined && (
              <Text style={[st.fChipCount, on && { color: 'rgba(255,255,255,0.65)' }]}>{cnt}</Text>
            )}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function JobCard({ job, variant = 'jobs', onPress, onAction }: {
  job: any; variant?: 'jobs' | 'schedule'; onPress: () => void;
  onAction?: (next: string, toastMsg: string) => void;
}) {
  const sc = getStatusStyle(job.status);
  const action = getJobAction(job.status);
  const custName = job.customer?.fullName || '—';
  const ref = job.jobNo || '';
  const typeLabel = (job.jobType || 'move').replace(/_/g, ' ').toUpperCase();
  const price = job.clientPackage?.agreedPrice;
  const addr = job.pickupAddress || job.deliveryAddress || '';
  const time = job.scheduledTimeSlot || '';
  const day = job.scheduledDate ? shortDate(job.scheduledDate) : '';
  const dur = job.estimatedDurationHours ? `${job.estimatedDurationHours} hrs` : '';

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={st.card}>
      <View style={[st.cardBar, { backgroundColor: sc.bar }]} />
      <View style={{ flex: 1, padding: 14, paddingLeft: 15 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={{ fontFamily: F.bold, fontSize: 15, color: C.ink, letterSpacing: -0.15 }} numberOfLines={1}>{custName}</Text>
            {variant === 'jobs' && ref ? (
              <Text style={{ fontFamily: MONO, fontSize: 10, color: C.muted, letterSpacing: 0.2, marginTop: 3 }}>{ref}</Text>
            ) : null}
          </View>
          <StatusBadge status={job.status} />
        </View>
        {addr ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: variant === 'schedule' ? 8 : 6 }}>
            <Icon name="map-pin" size={12} color={C.ink3} />
            <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.ink3 }} numberOfLines={1}>{shortAddr(addr)}</Text>
          </View>
        ) : null}
        <View style={{ height: 1, backgroundColor: C.divider, marginVertical: 10 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
            {variant === 'jobs' ? (
              <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.ink3 }} numberOfLines={1}>
                {day}{time ? `, ${time}` : ''}{typeLabel ? ` · ${typeLabel}` : ''}
              </Text>
            ) : (
              <>
                <Text style={{ fontFamily: F.bold, fontSize: 10, letterSpacing: 0.5, color: C.muted, textTransform: 'uppercase' }}>{typeLabel}</Text>
                {price ? <Text style={{ fontFamily: F.display, fontSize: 14, color: C.ink, letterSpacing: -0.3, marginLeft: 8 }}>{fmtAED(price)}</Text> : null}
              </>
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {variant === 'jobs' && price ? (
              <Text style={{ fontFamily: F.display, fontSize: 15, color: C.ink, letterSpacing: -0.3, marginRight: 6 }}>{fmtAED(price)}</Text>
            ) : null}
            {action && onAction ? (
              <TouchableOpacity onPress={() => onAction(action.next, action.toast)} activeOpacity={0.85}
                style={{ height: 30, paddingHorizontal: 13, borderRadius: 11, backgroundColor: action.bg, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: F.bold, fontSize: 12, color: action.fg }}>{action.label}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={onPress} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ width: 30, height: 30, borderRadius: 11, borderWidth: 1, borderColor: 'rgba(20,8,31,0.12)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="chevron-right" size={14} color={C.ink3} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function RecordRow({ item, type, onPress, onPrimary, onSecondary }: {
  item: any; type: 'quote' | 'invoice' | 'visit';
  onPress: () => void;
  onPrimary?: () => void; onSecondary?: () => void;
}) {
  const status = item.status || 'draft';
  const sc = getStatusStyle(status);
  const custName = item.customer?.fullName || item.customerName || '—';
  const ref = item.quoteNo || item.invoiceNo || '';
  const addr = item.pickupAddress || item.deliveryAddress || item.address || '';

  let amount = '', sub = '';
  let primaryLabel = '', primaryBg = '', primaryFg = '';
  let secondaryLabel = '';

  if (type === 'quote') {
    amount = item.total ? fmtAED(item.total) : '';
    sub = status === 'sent' ? `Sent ${fmtDate(item.sentAt || item.updatedAt)}` : status === 'accepted' ? 'Accepted' : '';
    const qa = getQuoteAction(status);
    primaryLabel = qa.label; primaryBg = qa.bg; primaryFg = qa.fg;
    secondaryLabel = 'Preview';
  } else if (type === 'invoice') {
    amount = item.total ? fmtAED(item.total) : '';
    const due = item.dueDate ? `Due ${fmtDate(item.dueDate)}` : '';
    sub = status === 'paid' ? `Paid ${fmtDate(item.paidAt || item.updatedAt)}` : due;
    const ia = getInvoiceAction(status);
    primaryLabel = ia.label; primaryBg = ia.bg; primaryFg = ia.fg;
    secondaryLabel = 'Share';
  } else {
    amount = fmtDate(item.visitDate || item.createdAt);
    sub = item.surveyorName ? `${item.surveyorName}` : '';
    const va = getVisitAction(status);
    primaryLabel = va.label; primaryBg = va.bg; primaryFg = va.fg;
    secondaryLabel = 'Details';
  }

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={st.card}>
      <View style={[st.cardBar, { backgroundColor: sc.bar }]} />
      <View style={{ flex: 1, padding: 14, paddingLeft: 15 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={{ fontFamily: F.bold, fontSize: 15, color: C.ink, letterSpacing: -0.15 }} numberOfLines={1}>{custName}</Text>
            {ref ? <Text style={{ fontFamily: MONO, fontSize: 10, color: C.muted, letterSpacing: 0.2, marginTop: 3 }}>{ref}</Text> : null}
          </View>
          <StatusBadge status={status} />
        </View>
        {addr ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 }}>
            <Icon name="map-pin" size={12} color={C.ink3} />
            <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.ink3 }} numberOfLines={1}>{shortAddr(addr)}</Text>
          </View>
        ) : null}
        <View style={{ height: 1, backgroundColor: C.divider, marginVertical: 10 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            {amount ? <Text style={{ fontFamily: F.display, fontSize: 16, color: C.ink, letterSpacing: -0.3 }}>{amount}</Text> : null}
            {sub ? <Text style={{ fontFamily: F.reg, fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</Text> : null}
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {primaryLabel && onPrimary ? (
              <TouchableOpacity onPress={onPrimary} activeOpacity={0.85}
                style={{ height: 30, paddingHorizontal: 12, borderRadius: 11, backgroundColor: primaryBg, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: F.bold, fontSize: 12, color: primaryFg }}>{primaryLabel}</Text>
              </TouchableOpacity>
            ) : null}
            {secondaryLabel && onSecondary ? (
              <TouchableOpacity onPress={onSecondary} activeOpacity={0.85}
                style={{ height: 30, paddingHorizontal: 12, borderRadius: 11, borderWidth: 1, borderColor: 'rgba(20,8,31,0.12)', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: F.bold, fontSize: 12, color: C.ink3 }}>{secondaryLabel}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function getQuoteAction(s: string) {
  switch (s) {
    case 'draft': return { label: 'Send', bg: C.ink, fg: C.white };
    case 'sent': case 'viewed': return { label: 'Remind', bg: '#EDE5FF', fg: '#4A1FA0' };
    case 'accepted': return { label: 'Make job', bg: '#E3F5EA', fg: '#186B3D' };
    case 'declined': return { label: 'Duplicate', bg: '#F1EDE3', fg: '#756E80' };
    default: return { label: '', bg: '', fg: '' };
  }
}
function getInvoiceAction(s: string) {
  switch (s) {
    case 'draft': return { label: 'Send', bg: C.ink, fg: C.white };
    case 'unpaid': return { label: 'Remind', bg: '#FFF0DB', fg: '#9A5B00' };
    case 'overdue': return { label: 'Chase', bg: '#FBE7EA', fg: '#9B2233' };
    case 'paid': return { label: 'Receipt', bg: '#E3F5EA', fg: '#186B3D' };
    default: return { label: '', bg: '', fg: '' };
  }
}
function getVisitAction(s: string) {
  switch (s) {
    case 'to_book': case 'draft': return { label: 'Schedule', bg: C.ink, fg: C.white };
    case 'scheduled': return { label: 'Directions', bg: '#EDE5FF', fg: '#4A1FA0' };
    case 'surveyed': case 'survey_done': return { label: 'Quote', bg: '#E3F5EA', fg: '#186B3D' };
    default: return { label: '', bg: '', fg: '' };
  }
}

/* ─── Page header for overlay screens (Quotes/Invoices/Visits) ─── */
function PageHeader({ title, subtitle, onBack, onAdd }: {
  title: string; subtitle: string; onBack: () => void; onAdd: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 22, paddingTop: insets.top + 8, paddingBottom: 12 }}>
      <TouchableOpacity onPress={onBack} style={st.darkBackBtn} activeOpacity={0.7}>
        <Icon name="chevron-left" size={16} color={C.white} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: F.display, fontSize: 24, color: C.ink, letterSpacing: -0.7 }}>{title}</Text>
        <Text style={{ fontFamily: F.semi, fontSize: 12, color: C.muted, marginTop: 2 }}>{subtitle}</Text>
      </View>
      <TouchableOpacity onPress={onAdd} activeOpacity={0.85}
        style={{ width: 38, height: 38, borderRadius: 14, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center',
          shadowColor: C.purple, shadowOpacity: 0.32, shadowRadius: 10, shadowOffset: { width: 0, height: 8 }, elevation: 6 }}>
        <Icon name="plus" size={18} color={C.white} />
      </TouchableOpacity>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════
   LOGIN
   ═══════════════════════════════════════════════════════════════ */
function LoginScreen() {
  const { login } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const onLogin = async () => {
    if (!email.trim() || !password) { setErr('Enter email and password'); return; }
    setLoading(true); setErr('');
    try {
      const r = await api.login(email.trim().toLowerCase(), password);
      setToken(r.token);
      login(r.user, r.token);
    } catch (e: any) { setErr(e.message || 'Login failed'); }
    setLoading(false);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 26, paddingTop: 80 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <View style={st.logoMark}><View style={st.logoInner} /></View>
          <Text style={st.logoText}>PurpleBox<Text style={{ color: C.purple }}>.</Text></Text>
        </View>
        <Text style={st.eyebrow}>MOVING OPERATIONS</Text>
        <Text style={st.h1}>Sign in to manage{'\n'}your moving jobs.</Text>
        <Text style={[st.upperLabel, { marginTop: 36 }]}>EMAIL</Text>
        <View style={st.inputRow}>
          <Icon name="mail" size={18} color={C.muted} />
          <TextInput value={email} onChangeText={setEmail} placeholder="you@purplebox.ae"
            placeholderTextColor={C.faint} style={st.inputField}
            keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
        </View>
        <Text style={[st.upperLabel, { marginTop: 18 }]}>PASSWORD</Text>
        <View style={st.inputRow}>
          <Icon name="lock" size={18} color={C.muted} />
          <TextInput value={password} onChangeText={setPassword} placeholder="••••••••"
            placeholderTextColor={C.faint} style={st.inputField} secureTextEntry />
        </View>
        {!!err && <Text style={st.errText}>{err}</Text>}
        <View style={{ height: 28 }} />
        <PrimaryButton label={loading ? 'Signing in…' : 'Sign In'} onPress={onLogin} disabled={loading} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DASHBOARD
   ═══════════════════════════════════════════════════════════════ */
function DashboardScreen() {
  const { s, go } = useApp();
  const { toast } = useToast();
  const insets = useSafeAreaInsets();
  const [summary, setSummary] = useState<any>(null);
  const [todayJobs, setTodayJobs] = useState<any[]>([]);
  const [draftJobs, setDraftJobs] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const today = isoDate(new Date());
      const [sum, sched, drafts] = await Promise.all([
        api.getSummary(),
        api.getSchedule(today, today),
        api.getJobs({ status: 'draft', limit: '10' }),
      ]);
      setSummary(sum);
      setTodayJobs(sched || []);
      setDraftJobs(drafts.jobs || []);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
  const firstName = s.user?.name?.split(' ')[0] || 'Team';
  const initial = s.user?.name ? s.user.name.charAt(0).toUpperCase() : 'P';
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
  const monthName = now.toLocaleDateString('en-GB', { month: 'short' });

  const nextJob = todayJobs.find((j: any) => j.status === 'in_progress')
    || todayJobs[0]
    || summary?.upcomingJobs?.[0];

  const onJobAction = async (jobId: string, next: string, msg: string) => {
    if (!next) { toast(msg); return; }
    try {
      await api.updateJobStatus(jobId, next);
      toast(msg);
      load();
    } catch (e: any) { Alert.alert('Error', e.message); }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 116 }} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.purple} />}>

        {/* Header: date + greeting + bell + avatar */}
        <View style={{ paddingHorizontal: 22, paddingTop: insets.top + 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View>
              <Text style={{ fontFamily: F.semi, fontSize: 12, color: C.muted, letterSpacing: 1.2, textTransform: 'uppercase' }}>{dateStr}</Text>
              <Text style={{ fontFamily: F.display, fontSize: 30, color: C.ink, letterSpacing: -0.9, marginTop: 4 }}>{greeting}, {firstName}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
              <View style={st.bellBtn}>
                <Icon name="bell" size={19} color={C.ink} />
                <View style={st.bellDot} />
              </View>
              <View style={st.headerAvatar}>
                <Text style={{ fontFamily: F.display, fontSize: 16, color: C.white }}>{initial}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* 3 stat cards */}
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 22, marginTop: 20 }}>
          <StatCard value={String(todayJobs.length || summary?.activeJobs || 0)} label="Jobs today" />
          <StatCard value={String(draftJobs.length || 0)} label="Unconfirmed" color={C.orange} />
          <StatCard value={String(summary?.jobsThisMonth ?? 0)} label={`Booked, ${monthName}`} />
        </View>

        {/* UP NEXT */}
        {nextJob && (
          <View style={{ paddingHorizontal: 22, marginTop: 22 }}>
            <SectionLabel>Up next</SectionLabel>
            <View style={st.heroCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <View style={st.heroPill}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#6EE7A8' }} />
                    <Text style={{ fontFamily: F.bold, fontSize: 11, color: C.white }}>
                      {(nextJob.status || 'draft').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                    </Text>
                  </View>
                  <Text style={{ fontFamily: F.display, fontSize: 25, color: C.white, marginTop: 10 }}>{nextJob.customer?.fullName || '—'}</Text>
                  <Text style={{ fontFamily: F.med, fontSize: 13, color: 'rgba(255,255,255,0.72)', marginTop: 4 }}>
                    {(nextJob.jobType || 'Move').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())} · {nextJob.jobNo || '—'}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', marginLeft: 12 }}>
                  <Text style={{ fontFamily: F.display, fontSize: 30, color: C.white }}>{nextJob.scheduledTimeSlot || '—'}</Text>
                  {nextJob.estimatedDurationHours ? (
                    <Text style={{ fontFamily: F.med, fontSize: 12, color: 'rgba(255,255,255,0.72)', marginTop: 2 }}>{nextJob.estimatedDurationHours} hrs</Text>
                  ) : null}
                </View>
              </View>
              {nextJob.pickupAddress ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 }}>
                  <Icon name="map-pin" size={15} color="rgba(255,255,255,0.86)" />
                  <Text style={{ fontFamily: F.med, fontSize: 13, color: 'rgba(255,255,255,0.86)' }} numberOfLines={1}>{shortAddr(nextJob.pickupAddress)}</Text>
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
                <TouchableOpacity onPress={() => go('jobDetail', nextJob._id)} activeOpacity={0.85}
                  style={{ flex: 1, height: 46, borderRadius: 16, backgroundColor: C.white, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: F.bold, fontSize: 14, color: '#4A1FA0' }}>Open job</Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.85} onPress={() => {
                  const phone = nextJob.customer?.phone;
                  if (phone) Linking.openURL(`tel:${phone}`);
                  else toast('No phone number');
                }}
                  style={{ flex: 1, height: 46, borderRadius: 16, backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(255,255,255,0.34)', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: F.bold, fontSize: 14, color: C.white }}>Call</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* NEEDS YOUR CALL */}
        {draftJobs.length > 0 && (
          <View style={{ paddingHorizontal: 22, marginTop: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Text style={st.sectionLabelText}>NEEDS YOUR CALL</Text>
              <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: '#FFF0DB' }}>
                <Text style={{ fontFamily: F.bold, fontSize: 11, color: '#9A5B00' }}>{draftJobs.length}</Text>
              </View>
            </View>
            <View style={{ gap: 9 }}>
              {draftJobs.slice(0, 3).map((job: any) => (
                <View key={job._id} style={st.draftCard}>
                  <View style={st.draftTimeWell}>
                    <Text style={{ fontFamily: F.display, fontSize: 13, color: C.ink3 }}>{job.scheduledTimeSlot || 'TBD'}</Text>
                  </View>
                  <View style={{ flex: 1, marginHorizontal: 12 }}>
                    <Text style={{ fontFamily: F.bold, fontSize: 15, color: C.ink }} numberOfLines={1}>{job.customer?.fullName || '—'}</Text>
                    <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.ink3, marginTop: 2 }} numberOfLines={1}>
                      {shortDate(job.scheduledDate)} · {shortAddr(job.pickupAddress)}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => onJobAction(job._id, 'confirmed', 'Job confirmed')} activeOpacity={0.85}
                    style={{ height: 34, paddingHorizontal: 14, borderRadius: 12, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontFamily: F.bold, fontSize: 13, color: C.white }}>Confirm</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* SHORTCUTS */}
        <View style={{ paddingHorizontal: 22, marginTop: 24 }}>
          <SectionLabel>Shortcuts</SectionLabel>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {([
              { icon: 'file-text', label: 'Quotes', color: C.purple, screen: 'quotes' as const },
              { icon: 'credit-card', label: 'Invoices', color: C.green, screen: 'invoices' as const },
              { icon: 'map-pin', label: 'Site visits', color: C.orange, screen: 'siteVisits' as const },
              { icon: 'users', label: 'Crew', color: C.ink, screen: 'workers' as const },
            ] as const).map(s => (
              <TouchableOpacity key={s.label} onPress={() => go(s.screen)} activeOpacity={0.85} style={st.shortcutBtn}>
                <Icon name={s.icon} size={20} color={s.color} />
                <Text style={{ fontFamily: F.semi, fontSize: 11, color: C.ink }}>{s.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SCHEDULE
   ═══════════════════════════════════════════════════════════════ */
function ScheduleScreen() {
  const { go } = useApp();
  const { toast } = useToast();
  const insets = useSafeAreaInsets();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDay, setSelectedDay] = useState(isoDate(new Date()));

  const load = useCallback(async () => {
    try {
      const from = isoDate(new Date());
      const to = isoDate(new Date(Date.now() + 14 * 86400000));
      const data = await api.getSchedule(from, to);
      setJobs((data || []).filter((j: any) => j.status !== 'completed' && j.status !== 'cancelled'));
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const jobDays = new Set(jobs.map((j: any) => j.scheduledDate ? isoDate(new Date(j.scheduledDate)) : ''));
  const grouped = jobs.reduce((acc: Record<string, any[]>, j: any) => {
    const d = j.scheduledDate ? isoDate(new Date(j.scheduledDate)) : 'Unscheduled';
    (acc[d] = acc[d] || []).push(j);
    return acc;
  }, {});
  const dates = Object.keys(grouped).sort();
  const today = isoDate(new Date());

  const onAction = async (jobId: string, next: string, msg: string) => {
    if (!next) { toast(msg); return; }
    try { await api.updateJobStatus(jobId, next); toast(msg); load(); } catch (e: any) { Alert.alert('Error', e.message); }
  };

  const days: Date[] = [];
  for (let i = 0; i < 14; i++) { const d = new Date(); d.setDate(d.getDate() + i); days.push(d); }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 22, paddingTop: insets.top + 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <Text style={{ fontFamily: F.display, fontSize: 30, color: C.ink, letterSpacing: -0.9 }}>Schedule</Text>
          <Text style={{ fontFamily: F.semi, fontSize: 12, color: C.muted }}>Next 14 days</Text>
        </View>
      </View>

      {/* Day strip */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingHorizontal: 22, paddingVertical: 14 }}>
        {days.map(d => {
          const iso = isoDate(d);
          const on = iso === selectedDay;
          const hasJobs = jobDays.has(iso);
          const dow = d.toLocaleDateString('en-GB', { weekday: 'short' }).substring(0, 3).toUpperCase();
          return (
            <TouchableOpacity key={iso} onPress={() => setSelectedDay(iso)} activeOpacity={0.85}
              style={[st.dayPill, on && st.dayPillOn]}>
              <Text style={[st.dayDow, on && { color: C.white }]}>{dow}</Text>
              <Text style={[st.dayNum, on && { color: C.white }]}>{d.getDate()}</Text>
              <View style={[st.dayDot, on ? { backgroundColor: '#A78BFA' } : hasJobs ? { backgroundColor: C.purple } : { backgroundColor: 'transparent' }]} />
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.purple} size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 116 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.purple} />}>
          {dates.length === 0 ? <EmptyState icon="calendar" text="No upcoming jobs" /> :
            dates.map(date => (
              <View key={date} style={{ marginBottom: 20 }}>
                {/* Group header */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <Text style={{ fontFamily: F.bold, fontSize: 13, color: C.ink }}>
                    {date === today ? 'Today' : new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(20,8,31,0.10)' }} />
                  <Text style={{ fontFamily: F.bold, fontSize: 11, color: C.ink3 }}>{grouped[date].length}</Text>
                </View>
                {/* Timeline rows */}
                <View style={{ gap: 9 }}>
                  {grouped[date].map((job: any) => (
                    <View key={job._id} style={{ flexDirection: 'row' }}>
                      <View style={{ width: 46, alignItems: 'flex-end', paddingRight: 10, paddingTop: 14 }}>
                        <Text style={{ fontFamily: F.display, fontSize: 16, color: C.ink }}>{job.scheduledTimeSlot || '—'}</Text>
                        {job.estimatedDurationHours ? (
                          <Text style={{ fontFamily: F.semi, fontSize: 11, color: C.muted }}>{job.estimatedDurationHours} hrs</Text>
                        ) : null}
                      </View>
                      <View style={{ flex: 1 }}>
                        <JobCard job={job} variant="schedule" onPress={() => go('jobDetail', job._id)}
                          onAction={(next, msg) => onAction(job._id, next, msg)} />
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ))}
        </ScrollView>
      )}
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════
   JOBS LIST
   ═══════════════════════════════════════════════════════════════ */
const JOB_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'in_progress', label: 'Active' },
  { key: 'completed', label: 'Done' },
];

function JobsScreen() {
  const { go } = useApp();
  const { toast } = useToast();
  const insets = useSafeAreaInsets();
  const [jobs, setJobs] = useState<any[]>([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const p: Record<string, string> = { limit: '100' };
      if (search.trim()) p.q = search.trim();
      const r = await api.getJobs(p);
      setJobs(r.jobs || []);
    } catch {}
    setLoading(false);
  }, [search]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const counts: Record<string, number> = { all: jobs.length };
  jobs.forEach(j => { counts[j.status] = (counts[j.status] || 0) + 1; });

  const filtered = filter === 'all' ? jobs : jobs.filter(j => j.status === filter);

  const onAction = async (jobId: string, next: string, msg: string) => {
    if (!next) { toast(msg); return; }
    try { await api.updateJobStatus(jobId, next); toast(msg); load(); } catch (e: any) { Alert.alert('Error', e.message); }
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 22, paddingTop: insets.top + 10 }}>
        <Text style={{ fontFamily: F.display, fontSize: 30, color: C.ink, letterSpacing: -0.9 }}>Jobs</Text>
        {/* Search */}
        <View style={[st.searchBar, { marginTop: 14 }]}>
          <Icon name="search" size={17} color={C.muted} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Customer, reference, address"
            placeholderTextColor={C.faint} style={st.searchInput} autoCorrect={false} />
        </View>
        <FilterChips filters={JOB_FILTERS} active={filter} counts={counts} onSelect={setFilter} />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.purple} size="large" /></View>
      ) : (
        <FlatList data={filtered} keyExtractor={item => item._id}
          contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 116 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.purple} />}
          ListEmptyComponent={<EmptyState icon="inbox" text="No jobs found" />}
          ItemSeparatorComponent={() => <View style={{ height: 9 }} />}
          renderItem={({ item: job }) => (
            <JobCard job={job} variant="jobs" onPress={() => go('jobDetail', job._id)}
              onAction={(next, msg) => onAction(job._id, next, msg)} />
          )} />
      )}
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PROFILE
   ═══════════════════════════════════════════════════════════════ */
function ProfileScreen() {
  const { s, go, logout } = useApp();
  const { toast } = useToast();
  const insets = useSafeAreaInsets();
  const [summary, setSummary] = useState<any>(null);
  const user = s.user;
  const initial = user?.name ? user.name.charAt(0).toUpperCase() : 'P';

  useEffect(() => { api.getSummary().then(setSummary).catch(() => {}); }, []);

  const onLogout = () => {
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => { setToken(null); logout(); } },
    ]);
  };

  const menuItems = [
    { emoji: '\u{1F3E2}', label: 'Business details', meta: 'Company, addresses', onPress: () => toast('Coming soon') },
    { emoji: '\u{1F465}', label: 'Crew & availability', meta: `${summary?.crewCount || 0} members`, onPress: () => go('workers') },
    { emoji: '\u{1F4B3}', label: 'Payments & invoicing', meta: 'Bank, pricing', onPress: () => go('invoices') },
    { emoji: '\u{1F514}', label: 'Notifications', meta: 'Push, email alerts', onPress: () => toast('Coming soon') },
    { emoji: '\u{2753}', label: 'Help & support', meta: 'FAQ, contact us', onPress: () => toast('Coming soon') },
  ];

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 116 }}>
        <View style={{ paddingHorizontal: 22, paddingTop: insets.top + 14 }}>
          {/* Avatar + name */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={st.profileAvatar}>
              <Text style={{ fontFamily: F.display, fontSize: 24, color: C.white }}>{initial}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.display, fontSize: 24, color: C.ink, letterSpacing: -0.7 }}>{user?.name || '—'}</Text>
              <Text style={{ fontFamily: F.med, fontSize: 13, color: C.ink3, marginTop: 2 }}>
                {(user?.role || 'Operations').replace(/\b\w/g, (c: string) => c.toUpperCase())} · PurpleBox Dubai
              </Text>
            </View>
          </View>
        </View>

        {/* Stats */}
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 22, marginTop: 20 }}>
          <View style={st.statCardSm}>
            <Text style={[st.statValSm]}>{summary?.totalJobs ?? '—'}</Text>
            <Text style={st.statLabelSm}>Jobs done</Text>
          </View>
          <View style={st.statCardSm}>
            <Text style={st.statValSm}>4.9</Text>
            <Text style={st.statLabelSm}>Rating</Text>
          </View>
          <View style={st.statCardSm}>
            <Text style={st.statValSm}>{summary?.crewCount ?? 6}</Text>
            <Text style={st.statLabelSm}>Crew</Text>
          </View>
        </View>

        {/* Menu */}
        <View style={{ paddingHorizontal: 22, marginTop: 20 }}>
          <View style={st.menuCard}>
            {menuItems.map((m, i) => (
              <TouchableOpacity key={i} onPress={m.onPress} activeOpacity={0.7}
                style={[st.menuRow, i < menuItems.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.divider }]}>
                <View style={st.menuEmojiWell}>
                  <Text style={{ fontSize: 16 }}>{m.emoji}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: F.semi, fontSize: 14, color: C.ink }}>{m.label}</Text>
                </View>
                <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.muted, marginRight: 8 }}>{m.meta}</Text>
                <Icon name="chevron-right" size={15} color="#C9C2B3" />
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity onPress={onLogout} activeOpacity={0.7} style={st.signOutBtn}>
            <Text style={{ fontFamily: F.bold, fontSize: 14, color: C.ink3 }}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════
   JOB DETAIL (bottom sheet style)
   ═══════════════════════════════════════════════════════════════ */
function JobDetailScreen() {
  const { s, go } = useApp();
  const { toast } = useToast();
  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadJob = useCallback(async () => {
    if (!s.selectedJobId) return;
    try { setJob(await api.getJob(s.selectedJobId)); } catch {}
    setLoading(false);
  }, [s.selectedJobId]);

  useEffect(() => { loadJob(); }, [loadJob]);
  const onRefresh = async () => { setRefreshing(true); await loadJob(); setRefreshing(false); };
  const goBack = () => go(s.prevScreen === 'dashboard' ? 'dashboard' : s.prevScreen === 'schedule' ? 'schedule' : 'jobs');

  const onAction = async () => {
    if (!job) return;
    const act = getJobAction(job.status);
    if (!act) return;
    if (!act.next) { toast(act.toast); return; }
    try { await api.updateJobStatus(job._id, act.next); toast(act.toast); loadJob(); } catch (e: any) { Alert.alert('Error', e.message); }
  };

  if (loading) return (
    <View style={{ flex: 1, backgroundColor: C.overlay }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.white} size="large" /></View>
    </View>
  );
  if (!job) return (
    <View style={{ flex: 1 }}>
      <TopBar title="Job Details" onBack={goBack} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: F.semi, color: C.ink3 }}>Job not found</Text>
      </View>
    </View>
  );

  const cust = job.customer;
  const typeLabel = (job.jobType || 'Move').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
  const price = job.clientPackage?.agreedPrice;
  const act = getJobAction(job.status);
  const sc = getStatusStyle(job.status);

  return (
    <View style={{ flex: 1, backgroundColor: C.overlay }}>
      <TouchableOpacity style={{ height: '10%' }} onPress={goBack} activeOpacity={1} />
      <View style={{ flex: 1, backgroundColor: C.paper, borderTopLeftRadius: 32, borderTopRightRadius: 32,
        shadowColor: C.ink, shadowOpacity: 0.28, shadowRadius: 25, shadowOffset: { width: 0, height: -20 }, elevation: 20 }}>
        {/* Drag handle */}
        <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
          <View style={{ width: 42, height: 4, borderRadius: 2, backgroundColor: 'rgba(20,8,31,0.16)' }} />
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 30 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.purple} />}>
          {/* Header */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 6 }}>
            <View style={{ flex: 1 }}>
              <StatusBadge status={job.status} />
              <Text style={{ fontFamily: F.display, fontSize: 28, color: C.ink, letterSpacing: -0.8, marginTop: 8 }}>{cust?.fullName || '—'}</Text>
              <Text style={{ fontFamily: MONO, fontSize: 11, color: C.muted, letterSpacing: 0.2, marginTop: 4 }}>{job.jobNo}</Text>
            </View>
            <TouchableOpacity onPress={goBack} activeOpacity={0.7}
              style={{ width: 34, height: 34, borderRadius: 12, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="x" size={16} color={C.ink} />
            </TouchableOpacity>
          </View>

          {/* When + Value tiles */}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 18 }}>
            <View style={st.infoTile}>
              <Text style={st.infoLabel}>WHEN</Text>
              <Text style={{ fontFamily: F.display, fontSize: 17, color: C.ink, letterSpacing: -0.3 }}>{job.scheduledTimeSlot || '—'}</Text>
              <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.ink3, marginTop: 3 }}>
                {shortDate(job.scheduledDate)}{job.estimatedDurationHours ? ` · ${job.estimatedDurationHours} hrs` : ''}
              </Text>
            </View>
            <View style={st.infoTile}>
              <Text style={st.infoLabel}>VALUE</Text>
              <Text style={{ fontFamily: F.display, fontSize: 17, color: C.ink, letterSpacing: -0.3 }}>{price ? fmtAED(price) : '—'}</Text>
              <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.ink3, marginTop: 3 }}>{typeLabel}</Text>
            </View>
          </View>

          {/* Address + Crew card */}
          <View style={[st.detailCard, { marginTop: 12 }]}>
            {/* Address row */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={st.iconWell}><Icon name="map-pin" size={16} color={C.purple} /></View>
              <View style={{ flex: 1 }}>
                <Text style={st.infoLabel}>ADDRESS</Text>
                <Text style={{ fontFamily: F.semi, fontSize: 14, color: C.ink, marginTop: 2 }}>{shortAddr(job.pickupAddress) || '—'}</Text>
              </View>
              <TouchableOpacity activeOpacity={0.7} onPress={() => {
                if (job.pickupAddress) Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(job.pickupAddress)}`);
              }} style={st.outlineSmBtn}>
                <Text style={{ fontFamily: F.bold, fontSize: 12, color: C.ink3 }}>Route</Text>
              </TouchableOpacity>
            </View>
            <View style={{ height: 1, backgroundColor: C.divider, marginVertical: 12 }} />
            {/* Crew row */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={st.iconWell}><Icon name="users" size={16} color={C.purple} /></View>
              <View style={{ flex: 1 }}>
                <Text style={st.infoLabel}>CREW</Text>
                <Text style={{ fontFamily: F.semi, fontSize: 14, color: C.ink, marginTop: 2 }}>
                  {job.crew?.length ? `${job.crew.length} assigned` : 'Not assigned'}
                </Text>
              </View>
              <TouchableOpacity activeOpacity={0.7} onPress={() => toast('Crew assignment coming soon')} style={st.outlineSmBtn}>
                <Text style={{ fontFamily: F.bold, fontSize: 12, color: C.ink3 }}>Change</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Activity timeline */}
          <View style={{ marginTop: 20 }}>
            <Text style={[st.sectionLabelText, { marginBottom: 14 }]}>ACTIVITY</Text>
            {[
              { label: 'Job created', meta: fmtDate(job.createdAt), color: '#C9C2B3' },
              ...(job.timeline || []).map((t: any) => ({
                label: t.text || t.action || 'Updated',
                meta: `${t.author || '—'} · ${fmtDate(t.at)}`,
                color: sc.bar,
              })),
              { label: (sc.label || job.status).replace(/_/g, ' '), meta: 'Current status', color: sc.bar },
            ].map((entry, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 }}>
                <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: entry.color, marginTop: 4, marginRight: 12,
                  shadowColor: entry.color, shadowOpacity: 0.4, shadowRadius: 3, shadowOffset: { width: 0, height: 0 } }} />
                <View>
                  <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.ink }}>{entry.label}</Text>
                  <Text style={{ fontFamily: F.reg, fontSize: 11, color: C.muted, marginTop: 2 }}>{entry.meta}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Photos */}
          {job.images?.length > 0 && (
            <View style={{ marginTop: 8 }}>
              <Text style={[st.sectionLabelText, { marginBottom: 10 }]}>PHOTOS</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {job.images.map((img: any, i: number) => (
                  <View key={i} style={st.photoThumb}>
                    <Image source={{ uri: img.viewUrl || img.url }} style={{ width: '100%', height: '100%' }} />
                  </View>
                ))}
              </ScrollView>
            </View>
          )}
        </ScrollView>

        {/* Footer buttons */}
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 22, paddingVertical: 14, paddingBottom: 30, borderTopWidth: 1, borderTopColor: C.divider }}>
          {act ? (
            <TouchableOpacity onPress={onAction} activeOpacity={0.85}
              style={{ flex: 1, height: 52, borderRadius: 18, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center',
                shadowColor: C.purple, shadowOpacity: 0.32, shadowRadius: 12, shadowOffset: { width: 0, height: 10 }, elevation: 6 }}>
              <Text style={{ fontFamily: F.bold, fontSize: 15, color: C.white }}>
                {act.next ? `Mark as ${act.next.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}` : act.label}
              </Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity activeOpacity={0.7} onPress={() => {
            const phone = cust?.phone;
            if (phone) Linking.openURL(`tel:${phone}`);
            else toast('No phone number');
          }} style={{ width: 52, height: 52, borderRadius: 18, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="phone" size={20} color={C.ink} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════
   NEW JOB (3-step wizard)
   ═══════════════════════════════════════════════════════════════ */
const JOB_TYPES_GRID = [
  { value: 'local', label: 'Move', meta: 'Local or inter-emirate' },
  { value: 'storage', label: 'Storage', meta: 'Short or long term' },
  { value: 'delivery', label: 'Delivery', meta: 'Item delivery' },
  { value: 'packing', label: 'Packing', meta: 'Packing service' },
];
const TIME_SLOTS = ['08:00', '09:00', '11:00', '13:00', '15:00', '17:00'];

function NewJobScreen() {
  const { s, go } = useApp();
  const { toast } = useToast();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(1);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customers, setCustomers] = useState<any[]>([]);
  const [recentCustomers, setRecentCustomers] = useState<any[]>([]);

  const [jobType, setJobType] = useState('local');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.searchCustomers('').then(r => setRecentCustomers((r.data || []).slice(0, 5))).catch(() => {});
  }, []);

  useEffect(() => {
    if (customerSearch.length < 2) { setCustomers([]); return; }
    const t = setTimeout(async () => {
      try { const r = await api.searchCustomers(customerSearch); setCustomers(r.data || []); } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [customerSearch]);

  const selectCustomer = (c: any) => {
    setCustomerId(c._id);
    setCustomerName(c.fullName || '');
    setCustomerPhone(c.phone || '');
    setCustomerAddress(c.address || '');
    setCustomerSearch('');
    setCustomers([]);
  };

  const dateDays: Date[] = [];
  for (let i = 0; i < 14; i++) { const d = new Date(); d.setDate(d.getDate() + i); dateDays.push(d); }

  const goClose = () => go(s.prevScreen === 'dashboard' ? 'dashboard' : 'jobs');

  const onCreate = async () => {
    setSaving(true);
    try {
      let cId = customerId;
      if (!cId && customerName.trim()) {
        const c = await api.createCustomer({ fullName: customerName.trim(), phone: customerPhone.trim() || undefined });
        cId = c._id;
      }
      if (!cId) { Alert.alert('Error', 'Please enter a customer name'); setSaving(false); return; }
      await api.createJob({
        customer: cId,
        jobType,
        scheduledDate: selectedDate || undefined,
        scheduledTimeSlot: selectedTime || undefined,
        pickupAddress: customerAddress,
      });
      toast('Job created as draft');
      go('jobs');
    } catch (e: any) { Alert.alert('Error', e.message); }
    setSaving(false);
  };

  const titles = [
    { title: 'Who is it for?', sub: 'Search a past customer or add a new one' },
    { title: 'What and when?', sub: 'Pick the job type, date and start time' },
    { title: 'Check and book', sub: 'You can edit anything before sending' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      {/* Header: back / step indicator / close */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: insets.top + 8, paddingBottom: 8 }}>
        <TouchableOpacity onPress={() => step > 1 ? setStep(step - 1) : goClose()} activeOpacity={0.7}
          style={{ width: 36, height: 36, borderRadius: 13, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevron-left" size={16} color={C.ink} />
        </TouchableOpacity>
        <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.ink3 }}>Step {step} of 3</Text>
        <TouchableOpacity onPress={goClose} activeOpacity={0.7}
          style={{ width: 36, height: 36, borderRadius: 13, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="x" size={16} color={C.ink} />
        </TouchableOpacity>
      </View>

      {/* Progress bars */}
      <View style={{ flexDirection: 'row', gap: 5, paddingHorizontal: 22, marginBottom: 20 }}>
        {[1, 2, 3].map(n => (
          <View key={n} style={{ flex: 1, height: 4, borderRadius: 999, backgroundColor: n <= step ? C.purple : 'rgba(20,8,31,0.12)' }} />
        ))}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
          <Text style={{ fontFamily: F.display, fontSize: 28, color: C.ink, letterSpacing: -0.8 }}>{titles[step - 1].title}</Text>
          <Text style={{ fontFamily: F.med, fontSize: 13, color: C.ink3, marginTop: 4, marginBottom: 22 }}>{titles[step - 1].sub}</Text>

          {step === 1 && (
            <>
              <FieldCard label="CUSTOMER" value={customerName} onChange={setCustomerName} placeholder="Full name" icon="user" />
              <FieldCard label="PHONE" value={customerPhone} onChange={setCustomerPhone} placeholder="+971 XX XXX XXXX" icon="phone" keyboard="phone-pad" />
              <FieldCard label="ADDRESS" value={customerAddress} onChange={setCustomerAddress} placeholder="Pickup address" icon="map-pin" />

              {!customerId && recentCustomers.length > 0 && (
                <View style={{ marginTop: 20 }}>
                  <Text style={st.sectionLabelText}>RECENT CUSTOMERS</Text>
                  <View style={{ marginTop: 10, gap: 6 }}>
                    {recentCustomers.map((c: any) => (
                      <TouchableOpacity key={c._id} onPress={() => selectCustomer(c)} activeOpacity={0.7}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.divider }}>
                        <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: C.purpleLite, alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ fontFamily: F.display, fontSize: 14, color: C.purple }}>{(c.fullName || '?').charAt(0)}</Text>
                        </View>
                        <View>
                          <Text style={{ fontFamily: F.semi, fontSize: 14, color: C.ink }}>{c.fullName}</Text>
                          <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.ink3 }}>{c.phone || c.email || '—'}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}
            </>
          )}

          {step === 2 && (
            <>
              {/* Job type 2×2 grid */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {JOB_TYPES_GRID.map(t => {
                  const on = jobType === t.value;
                  return (
                    <TouchableOpacity key={t.value} onPress={() => setJobType(t.value)} activeOpacity={0.85}
                      style={[st.typeCard, on && { backgroundColor: C.purple, borderColor: C.purple }]}>
                      <Text style={{ fontFamily: F.bold, fontSize: 15, color: on ? C.white : C.ink }}>{t.label}</Text>
                      <Text style={{ fontFamily: F.reg, fontSize: 12, color: on ? 'rgba(255,255,255,0.72)' : C.ink3, marginTop: 4 }}>{t.meta}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Date strip */}
              <Text style={[st.sectionLabelText, { marginTop: 22, marginBottom: 10 }]}>DATE</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {dateDays.map(d => {
                  const iso = isoDate(d);
                  const on = iso === selectedDate;
                  const dow = d.toLocaleDateString('en-GB', { weekday: 'short' }).substring(0, 3).toUpperCase();
                  return (
                    <TouchableOpacity key={iso} onPress={() => setSelectedDate(iso)} activeOpacity={0.85}
                      style={[st.dateTile, on && st.dateTileOn]}>
                      <Text style={[st.dateTileDow, on && { color: C.white }]}>{dow}</Text>
                      <Text style={[st.dateTileNum, on && { color: C.white }]}>{d.getDate()}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Time slots */}
              <Text style={[st.sectionLabelText, { marginTop: 22, marginBottom: 10 }]}>TIME</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {TIME_SLOTS.map(t => {
                  const on = selectedTime === t;
                  return (
                    <TouchableOpacity key={t} onPress={() => setSelectedTime(t)} activeOpacity={0.85}
                      style={[st.timeChip, on && st.timeChipOn]}>
                      <Text style={[st.timeChipTxt, on && st.timeChipTxtOn]}>{t}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          {step === 3 && (
            <>
              {/* Review card */}
              <View style={st.detailCard}>
                {[
                  { k: 'Customer', v: customerName || '—' },
                  { k: 'Phone', v: customerPhone || '—' },
                  { k: 'Address', v: customerAddress || '—' },
                  { k: 'Job type', v: JOB_TYPES_GRID.find(t => t.value === jobType)?.label || '—' },
                  { k: 'Date', v: selectedDate ? shortDate(selectedDate) : '—' },
                  { k: 'Start', v: selectedTime || '—' },
                ].map((row, i) => (
                  <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8,
                    borderBottomWidth: i < 5 ? 1 : 0, borderBottomColor: C.divider }}>
                    <Text style={{ fontFamily: F.reg, fontSize: 13, color: C.ink3 }}>{row.k}</Text>
                    <Text style={{ fontFamily: F.bold, fontSize: 14, color: C.ink }}>{row.v}</Text>
                  </View>
                ))}
              </View>

              {/* Estimate panel */}
              <View style={st.estimatePanel}>
                <Text style={{ fontFamily: F.reg, fontSize: 12, color: '#4A1FA0' }}>Estimated total</Text>
                <Text style={{ fontFamily: F.display, fontSize: 26, color: '#4A1FA0', letterSpacing: -0.5, marginTop: 4 }}>On request</Text>
              </View>
            </>
          )}
        </ScrollView>

        {/* CTA */}
        <View style={{ paddingHorizontal: 22, paddingBottom: Math.max(insets.bottom, 16) + 6 }}>
          <PrimaryButton
            label={step < 3 ? 'Continue' : saving ? 'Creating…' : 'Create job'}
            onPress={() => { if (step < 3) setStep(step + 1); else onCreate(); }}
            disabled={saving || (step === 1 && !customerName.trim())}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function FieldCard({ label, value, onChange, placeholder, icon, keyboard }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; icon?: string; keyboard?: any;
}) {
  return (
    <View style={st.fieldCard}>
      <Text style={st.fieldLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {icon && <Icon name={icon} size={17} color={C.muted} />}
        <TextInput value={value} onChangeText={onChange} placeholder={placeholder}
          placeholderTextColor={C.faint} style={{ flex: 1, fontFamily: F.semi, fontSize: 16, color: C.ink, padding: 0 }}
          keyboardType={keyboard} autoCorrect={false} />
      </View>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════
   QUOTES LIST
   ═══════════════════════════════════════════════════════════════ */
const QUOTE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'sent', label: 'Sent' },
  { key: 'viewed', label: 'Viewed' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'declined', label: 'Declined' },
];

function QuotesScreen() {
  const { go } = useApp();
  const { toast } = useToast();
  const [quotes, setQuotes] = useState<any[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { const data = await api.getQuotes(); setQuotes(Array.isArray(data) ? data : []); } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const counts: Record<string, number> = { all: quotes.length };
  quotes.forEach(q => { counts[q.status || 'draft'] = (counts[q.status || 'draft'] || 0) + 1; });
  const filtered = filter === 'all' ? quotes : quotes.filter(q => (q.status || 'draft') === filter);

  const sent = counts.sent || 0;
  const accepted = counts.accepted || 0;
  const totalValue = quotes.reduce((s, q) => s + (q.total || 0), 0);

  return (
    <View style={{ flex: 1 }}>
      <PageHeader title="Quotes" subtitle="Pipeline · last 30 days" onBack={() => go('dashboard')} onAdd={() => go('newQuote')} />
      <View style={{ paddingHorizontal: 22 }}>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
          <StatCard value={String(sent)} label="Awaiting reply" color={C.orange} />
          <StatCard value={String(accepted)} label="Accepted" color={C.green} />
          <StatCard value={totalValue ? fmtAED(totalValue) : '—'} label="Value out" />
        </View>
        <FilterChips filters={QUOTE_FILTERS} active={filter} counts={counts} onSelect={setFilter} />
      </View>
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.purple} size="large" /></View>
      ) : (
        <FlatList data={filtered} keyExtractor={item => item._id}
          contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 30 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.purple} />}
          ListEmptyComponent={<EmptyState icon="file-text" text="No quotes found" />}
          ItemSeparatorComponent={() => <View style={{ height: 9 }} />}
          renderItem={({ item: q }) => (
            <RecordRow item={q} type="quote" onPress={() => go('quoteDetail', undefined, q._id)}
              onPrimary={() => {
                if (q.status === 'draft') { api.sendQuoteWhatsApp(q._id).then(() => { toast('Quote sent'); load(); }).catch(e => Alert.alert('Error', e.message)); }
                else toast('Action coming soon');
              }}
              onSecondary={() => go('quoteDetail', undefined, q._id)} />
          )} />
      )}
    </View>
  );
}

/* ═══ QUOTE DETAIL ═══ */
function QuoteDetailScreen() {
  const { s, go } = useApp();
  const { toast } = useToast();
  const [quote, setQuote] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadQuote = useCallback(async () => {
    if (!s.selectedItemId) return;
    try { setQuote(await api.getQuote(s.selectedItemId)); } catch {}
    setLoading(false);
  }, [s.selectedItemId]);

  useEffect(() => { loadQuote(); }, [loadQuote]);
  const onRefresh = async () => { setRefreshing(true); await loadQuote(); setRefreshing(false); };

  if (loading || !quote) return (
    <View style={{ flex: 1 }}>
      <TopBar title="Quote" onBack={() => go('quotes')} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {loading ? <ActivityIndicator color={C.purple} size="large" /> : <Text style={{ fontFamily: F.semi, color: C.ink3 }}>Quote not found</Text>}
      </View>
    </View>
  );

  const name = quote.customer?.fullName || '—';
  const items = quote.items || [];

  return (
    <View style={{ flex: 1 }}>
      <TopBar title={quote.quoteNo || 'Quote'} subtitle={name} onBack={() => go('quotes')} right={<StatusBadge status={quote.status || 'draft'} />} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 8, paddingBottom: 30 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.purple} />}>
        <View style={st.detailCard}>
          <Text style={{ fontFamily: F.bold, fontSize: 15, color: C.ink }}>{name}</Text>
          {quote.customer?.phone && <Text style={{ fontFamily: F.reg, fontSize: 13, color: C.ink3, marginTop: 4 }}>{quote.customer.phone}</Text>}
          {quote.customer?.email && <Text style={{ fontFamily: F.reg, fontSize: 13, color: C.ink3, marginTop: 2 }}>{quote.customer.email}</Text>}
        </View>
        {items.length > 0 && (
          <View style={[st.detailCard, { marginTop: 10 }]}>
            {items.map((item: any, i: number) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: i < items.length - 1 ? 1 : 0, borderBottomColor: C.divider }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: F.med, fontSize: 13, color: C.ink }}>{item.description || item.name}</Text>
                  {item.qty > 1 && <Text style={{ fontFamily: F.reg, fontSize: 11, color: C.ink3 }}>Qty: {item.qty}</Text>}
                </View>
                <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.ink }}>{fmtAED(item.amount || 0)}</Text>
              </View>
            ))}
          </View>
        )}
        <View style={st.estimatePanel}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: F.bold, fontSize: 15, color: '#4A1FA0' }}>Total</Text>
            <Text style={{ fontFamily: F.display, fontSize: 24, color: '#4A1FA0', letterSpacing: -0.5 }}>{fmtAED(quote.total || 0)}</Text>
          </View>
        </View>
        {/* Share actions */}
        <View style={[st.detailCard, { marginTop: 10 }]}>
          <ShareAction icon="message-circle" label="Send via WhatsApp" sub={quote.customer?.phone || 'No phone'} onPress={async () => {
            try { await api.sendQuoteWhatsApp(quote._id); toast('Quote sent'); } catch (e: any) { Alert.alert('Error', e.message); }
          }} />
          <View style={{ height: 1, backgroundColor: C.divider }} />
          <ShareAction icon="download" label="Download PDF" sub="Open as PDF" onPress={async () => {
            try {
              const { token } = await api.getQuoteShareToken(quote._id);
              const base = Platform.OS === 'android' ? 'http://10.0.2.2:5010' : 'http://localhost:5010';
              await Linking.openURL(`${base}/api/moving-quotes/${quote._id}/pdf?token=${token}`);
            } catch (e: any) { Alert.alert('Error', e.message); }
          }} />
        </View>
      </ScrollView>
    </View>
  );
}

function ShareAction({ icon, label, sub, onPress }: { icon: string; label: string; sub: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
      <View style={st.iconWell}><Icon name={icon} size={16} color={C.purple} /></View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: F.semi, fontSize: 14, color: C.ink }}>{label}</Text>
        <Text style={{ fontFamily: F.reg, fontSize: 11, color: C.ink3 }}>{sub}</Text>
      </View>
      <Icon name="chevron-right" size={15} color="#C9C2B3" />
    </TouchableOpacity>
  );
}

/* ═══════════════════════════════════════════════════════════════
   NEW QUOTE
   ═══════════════════════════════════════════════════════════════ */
function NewQuoteScreen() {
  const { go } = useApp();
  const { toast } = useToast();
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customers, setCustomers] = useState<any[]>([]);
  const [items, setItems] = useState([{ id: 1, name: '', desc: '', qty: 1, rate: 0 }]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  let nextId = useRef(2);

  useEffect(() => {
    if (customerSearch.length < 2) { setCustomers([]); return; }
    const t = setTimeout(async () => { try { const r = await api.searchCustomers(customerSearch); setCustomers(r.data || []); } catch {} }, 300);
    return () => clearTimeout(t);
  }, [customerSearch]);

  const updateItem = (id: number, field: string, val: string) => {
    setItems(prev => prev.map(it => it.id !== id ? it : {
      ...it,
      [field]: field === 'qty' || field === 'rate' ? (Number(val) || 0) : val,
    }));
  };
  const removeItem = (id: number) => { if (items.length > 1) setItems(prev => prev.filter(it => it.id !== id)); };
  const addItem = () => { setItems(prev => [...prev, { id: nextId.current++, name: '', desc: '', qty: 1, rate: 0 }]); };

  const subTotal = items.reduce((s, it) => s + it.qty * it.rate, 0);
  const vat = Math.round(subTotal * 0.05);
  const total = subTotal + vat;

  const onCreate = async () => {
    if (!customerId) { setErr('Select a customer'); return; }
    if (!items[0].name) { setErr('Add at least one item'); return; }
    setSaving(true); setErr('');
    try {
      const mapped = items.filter(it => it.name).map(it => ({ description: it.name, subDescription: it.desc, qty: it.qty, rate: it.rate, amount: it.qty * it.rate }));
      await api.createQuote({ customer: customerId, items: mapped, subTotal, total, notes });
      toast('Quote created as draft');
      go('quotes');
    } catch (e: any) { setErr(e.message); }
    setSaving(false);
  };

  return (
    <View style={{ flex: 1 }}>
      <BuilderHeader title="New quote" onBack={() => go('quotes')} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
          <Text style={[st.sectionLabelText, { marginBottom: 8 }]}>CUSTOMER</Text>
          {customerId ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: C.purpleLite }}>
              <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: F.display, fontSize: 14, color: C.white }}>{customerName.charAt(0)}</Text>
              </View>
              <Text style={{ flex: 1, fontFamily: F.semi, fontSize: 15, color: C.ink }}>{customerName}</Text>
              <TouchableOpacity onPress={() => { setCustomerId(''); setCustomerName(''); }} activeOpacity={0.7}>
                <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.purple }}>Change</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={st.searchBar}>
                <Icon name="search" size={17} color={C.muted} />
                <TextInput value={customerSearch} onChangeText={setCustomerSearch} placeholder="Search by name or phone"
                  placeholderTextColor={C.faint} style={st.searchInput} autoCorrect={false} />
              </View>
              {customers.length > 0 && (
                <View style={{ borderWidth: 1, borderColor: C.border, borderRadius: 18, backgroundColor: C.white, marginTop: 6, overflow: 'hidden' }}>
                  {customers.map(c => (
                    <TouchableOpacity key={c._id} onPress={() => { setCustomerId(c._id); setCustomerName(c.fullName); setCustomerSearch(''); setCustomers([]); }}
                      style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border }} activeOpacity={0.7}>
                      <Text style={{ fontFamily: F.semi, fontSize: 14, color: C.ink }}>{c.fullName}</Text>
                      <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.ink3 }}>{c.phone || c.email || '—'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <TouchableOpacity onPress={() => {}} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
                <Icon name="user-plus" size={14} color={C.purple} />
                <Text style={{ fontFamily: F.bold, fontSize: 13, color: C.purple }}>Add new customer</Text>
              </TouchableOpacity>
            </>
          )}

          <Text style={[st.sectionLabelText, { marginTop: 22, marginBottom: 8 }]}>LINE ITEMS</Text>
          {items.map((item, idx) => (
            <View key={item.id} style={st.lineItemCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text style={{ fontFamily: F.bold, fontSize: 10, color: C.muted, letterSpacing: 0.8, textTransform: 'uppercase' }}>ITEM {idx + 1}</Text>
                {items.length > 1 && (
                  <TouchableOpacity onPress={() => removeItem(item.id)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: C.warm, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="x" size={12} color={C.ink3} />
                  </TouchableOpacity>
                )}
              </View>
              <TextInput value={item.name} onChangeText={v => updateItem(item.id, 'name', v)} placeholder="Item name"
                placeholderTextColor={C.faint} style={{ fontFamily: F.bold, fontSize: 15, color: C.ink, padding: 0, marginBottom: 6 }} />
              <TextInput value={item.desc} onChangeText={v => updateItem(item.id, 'desc', v)} placeholder="Description (optional)"
                placeholderTextColor={C.faint} style={{ fontFamily: F.reg, fontSize: 13, color: C.ink, padding: 0, marginBottom: 10 }} />
              <View style={{ height: 1, backgroundColor: C.divider, marginBottom: 10 }} />
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
                <View style={{ width: 68 }}>
                  <Text style={{ fontFamily: F.bold, fontSize: 10, color: C.muted, letterSpacing: 0.8, marginBottom: 4 }}>QTY</Text>
                  <TextInput value={item.qty ? String(item.qty) : ''} onChangeText={v => updateItem(item.id, 'qty', v)}
                    style={{ fontFamily: F.display, fontSize: 17, color: C.ink, padding: 0 }} keyboardType="numeric" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: F.bold, fontSize: 10, color: C.muted, letterSpacing: 0.8, marginBottom: 4 }}>RATE (AED)</Text>
                  <TextInput value={item.rate ? String(item.rate) : ''} onChangeText={v => updateItem(item.id, 'rate', v)}
                    style={{ fontFamily: F.display, fontSize: 17, color: C.ink, padding: 0 }} keyboardType="numeric" />
                </View>
                <View>
                  <Text style={{ fontFamily: F.bold, fontSize: 10, color: C.muted, letterSpacing: 0.8, marginBottom: 4 }}>AMOUNT</Text>
                  <Text style={{ fontFamily: F.display, fontSize: 17, color: C.purple }}>{(item.qty * item.rate).toLocaleString()}</Text>
                </View>
              </View>
            </View>
          ))}
          <TouchableOpacity onPress={addItem} activeOpacity={0.7}
            style={{ height: 46, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(91,43,201,0.4)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <Text style={{ fontFamily: F.bold, fontSize: 13, color: C.purple }}>+ Add item</Text>
          </TouchableOpacity>

          {/* Totals */}
          <View style={st.totalsPanel}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
              <Text style={{ fontFamily: F.reg, fontSize: 13, color: '#4A1FA0' }}>Subtotal</Text>
              <Text style={{ fontFamily: F.semi, fontSize: 13, color: '#4A1FA0' }}>{fmtAED(subTotal)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
              <Text style={{ fontFamily: F.reg, fontSize: 13, color: '#4A1FA0' }}>VAT 5%</Text>
              <Text style={{ fontFamily: F.semi, fontSize: 13, color: '#4A1FA0' }}>{fmtAED(vat)}</Text>
            </View>
            <View style={{ height: 1, backgroundColor: '#DDD0FF', marginVertical: 6 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontFamily: F.bold, fontSize: 15, color: '#4A1FA0' }}>Total</Text>
              <Text style={{ fontFamily: F.display, fontSize: 24, color: '#4A1FA0', letterSpacing: -0.5 }}>{fmtAED(total)}</Text>
            </View>
          </View>

          <Text style={[st.sectionLabelText, { marginTop: 18, marginBottom: 8 }]}>NOTES</Text>
          <TextInput value={notes} onChangeText={setNotes} placeholder="Access, parking, lift booking, fragile items…"
            placeholderTextColor={C.faint} style={st.notesInput} multiline />

          {!!err && <Text style={st.errText}>{err}</Text>}
          <View style={{ height: 16 }} />
          <PrimaryButton label={saving ? 'Creating…' : 'Create quote'} onPress={onCreate} disabled={saving} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function BuilderHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 22, paddingTop: insets.top + 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.divider }}>
      <TouchableOpacity onPress={onBack} style={st.darkBackBtn} activeOpacity={0.7}>
        <Icon name="chevron-left" size={16} color={C.white} />
      </TouchableOpacity>
      <Text style={{ fontFamily: F.display, fontSize: 22, color: C.ink, letterSpacing: -0.5 }}>{title}</Text>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════
   INVOICES LIST
   ═══════════════════════════════════════════════════════════════ */
const INV_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'unpaid', label: 'Unpaid' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'paid', label: 'Paid' },
];

function InvoicesScreen() {
  const { go } = useApp();
  const { toast } = useToast();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { const data = await api.getInvoices(); setInvoices(Array.isArray(data) ? data : []); } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const counts: Record<string, number> = { all: invoices.length };
  invoices.forEach(inv => { counts[inv.status || 'draft'] = (counts[inv.status || 'draft'] || 0) + 1; });
  const filtered = filter === 'all' ? invoices : invoices.filter(inv => (inv.status || 'draft') === filter);

  const outstanding = invoices.filter(i => i.status === 'unpaid' || i.status === 'draft').reduce((s, i) => s + (i.total || 0), 0);
  const overdueCount = counts.overdue || 0;
  const paidTotal = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total || 0), 0);
  const monthName = new Date().toLocaleDateString('en-GB', { month: 'short' });

  return (
    <View style={{ flex: 1 }}>
      <PageHeader title="Invoices" subtitle={`Receivables · ${monthName}`} onBack={() => go('dashboard')} onAdd={() => go('newInvoice')} />
      <View style={{ paddingHorizontal: 22 }}>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
          <StatCard value={outstanding ? fmtAED(outstanding) : '—'} label="Outstanding" color={C.orange} />
          <StatCard value={String(overdueCount)} label="Overdue" color={C.red} />
          <StatCard value={paidTotal ? fmtAED(paidTotal) : '—'} label={`Paid, ${monthName}`} color={C.green} />
        </View>
        <FilterChips filters={INV_FILTERS} active={filter} counts={counts} onSelect={setFilter} />
      </View>
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.purple} size="large" /></View>
      ) : (
        <FlatList data={filtered} keyExtractor={item => item._id}
          contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 30 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.purple} />}
          ListEmptyComponent={<EmptyState icon="credit-card" text="No invoices found" />}
          ItemSeparatorComponent={() => <View style={{ height: 9 }} />}
          renderItem={({ item: inv }) => (
            <RecordRow item={inv} type="invoice" onPress={() => go('invoiceDetail', undefined, inv._id)}
              onPrimary={() => {
                if (inv.status === 'draft') { api.sendInvoiceWhatsApp(inv._id).then(() => { toast('Invoice sent'); load(); }).catch(e => Alert.alert('Error', e.message)); }
                else toast('Action coming soon');
              }}
              onSecondary={() => go('invoiceDetail', undefined, inv._id)} />
          )} />
      )}
    </View>
  );
}

/* ═══ INVOICE DETAIL ═══ */
function InvoiceDetailScreen() {
  const { s, go } = useApp();
  const { toast } = useToast();
  const [invoice, setInvoice] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadInvoice = useCallback(async () => {
    if (!s.selectedItemId) return;
    try { setInvoice(await api.getInvoice(s.selectedItemId)); } catch {}
    setLoading(false);
  }, [s.selectedItemId]);

  useEffect(() => { loadInvoice(); }, [loadInvoice]);
  const onRefresh = async () => { setRefreshing(true); await loadInvoice(); setRefreshing(false); };

  if (loading || !invoice) return (
    <View style={{ flex: 1 }}>
      <TopBar title="Invoice" onBack={() => go('invoices')} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {loading ? <ActivityIndicator color={C.purple} size="large" /> : <Text style={{ fontFamily: F.semi, color: C.ink3 }}>Invoice not found</Text>}
      </View>
    </View>
  );

  const name = invoice.customer?.fullName || '—';
  const items = invoice.items || [];
  const balance = (invoice.total || 0) - (invoice.paidAmount || 0);

  return (
    <View style={{ flex: 1 }}>
      <TopBar title={invoice.invoiceNo || 'Invoice'} subtitle={name} onBack={() => go('invoices')} right={<StatusBadge status={invoice.status || 'draft'} />} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 8, paddingBottom: 30 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.purple} />}>
        <View style={st.detailCard}>
          <Text style={{ fontFamily: F.bold, fontSize: 15, color: C.ink }}>{name}</Text>
          {invoice.customer?.phone && <Text style={{ fontFamily: F.reg, fontSize: 13, color: C.ink3, marginTop: 4 }}>{invoice.customer.phone}</Text>}
        </View>
        {items.length > 0 && (
          <View style={[st.detailCard, { marginTop: 10 }]}>
            {items.map((item: any, i: number) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: i < items.length - 1 ? 1 : 0, borderBottomColor: C.divider }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: F.med, fontSize: 13, color: C.ink }}>{item.description || item.name}</Text>
                  {item.qty > 1 && <Text style={{ fontFamily: F.reg, fontSize: 11, color: C.ink3 }}>Qty: {item.qty}</Text>}
                </View>
                <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.ink }}>{fmtAED(item.amount || 0)}</Text>
              </View>
            ))}
          </View>
        )}
        <View style={st.estimatePanel}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
            <Text style={{ fontFamily: F.reg, fontSize: 13, color: '#4A1FA0' }}>Total</Text>
            <Text style={{ fontFamily: F.semi, fontSize: 14, color: '#4A1FA0' }}>{fmtAED(invoice.total || 0)}</Text>
          </View>
          {balance > 0 && invoice.status !== 'paid' && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, marginTop: 4 }}>
              <Text style={{ fontFamily: F.bold, fontSize: 15, color: C.orange }}>Balance Due</Text>
              <Text style={{ fontFamily: F.display, fontSize: 20, color: C.orange }}>{fmtAED(balance)}</Text>
            </View>
          )}
        </View>
        <View style={[st.detailCard, { marginTop: 10 }]}>
          <ShareAction icon="message-circle" label="Send via WhatsApp" sub={invoice.customer?.phone || 'No phone'} onPress={async () => {
            try { await api.sendInvoiceWhatsApp(invoice._id); toast('Invoice sent'); } catch (e: any) { Alert.alert('Error', e.message); }
          }} />
          <View style={{ height: 1, backgroundColor: C.divider }} />
          <ShareAction icon="download" label="Download PDF" sub="Open as PDF" onPress={async () => {
            try {
              const { token } = await api.getInvoiceShareToken(invoice._id);
              const base = Platform.OS === 'android' ? 'http://10.0.2.2:5010' : 'http://localhost:5010';
              await Linking.openURL(`${base}/api/moving-invoices/${invoice._id}/pdf?token=${token}`);
            } catch (e: any) { Alert.alert('Error', e.message); }
          }} />
        </View>

        {/* Edit & Delete actions */}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
          <TouchableOpacity onPress={() => go('newInvoice', undefined, invoice._id)} activeOpacity={0.85}
            style={{ flex: 1, height: 46, borderRadius: 16, backgroundColor: C.white, borderWidth: 1, borderColor: C.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
            <Icon name="edit-2" size={15} color={C.purple} />
            <Text style={{ fontFamily: F.bold, fontSize: 14, color: C.purple }}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => {
            Alert.alert('Delete Invoice', `Are you sure you want to delete ${invoice.invoiceNo || 'this invoice'}? This cannot be undone.`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: async () => {
                try { await api.deleteInvoice(invoice._id); toast('Invoice deleted'); go('invoices'); } catch (e: any) { Alert.alert('Error', e.message); }
              }},
            ]);
          }} activeOpacity={0.85}
            style={{ flex: 1, height: 46, borderRadius: 16, backgroundColor: C.redBg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
            <Icon name="trash-2" size={15} color={C.red} />
            <Text style={{ fontFamily: F.bold, fontSize: 14, color: C.red }}>Delete</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

/* ═══ NEW INVOICE ═══ */
function NewInvoiceScreen() {
  const { s, go } = useApp();
  const { toast } = useToast();
  const editId = s.selectedItemId;
  const isEdit = !!editId;
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customers, setCustomers] = useState<any[]>([]);
  const [items, setItems] = useState([{ id: 1, name: '', desc: '', qty: 1, rate: 0 }]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(isEdit);
  const [err, setErr] = useState('');
  let nextId = useRef(2);

  useEffect(() => {
    if (!editId) return;
    (async () => {
      try {
        const inv = await api.getInvoice(editId);
        if (inv.customer) {
          setCustomerId(inv.customer._id || inv.customer);
          setCustomerName(inv.customer.fullName || '');
        }
        if (inv.items?.length) {
          setItems(inv.items.map((it: any, i: number) => ({
            id: i + 1, name: it.description || it.name || '', desc: it.subDescription || '',
            qty: it.qty || 1, rate: it.rate || it.amount || 0,
          })));
          nextId.current = inv.items.length + 1;
        }
        setNotes(inv.notes || '');
      } catch {}
      setLoadingEdit(false);
    })();
  }, [editId]);

  useEffect(() => {
    if (customerSearch.length < 2) { setCustomers([]); return; }
    const t = setTimeout(async () => { try { const r = await api.searchCustomers(customerSearch); setCustomers(r.data || []); } catch {} }, 300);
    return () => clearTimeout(t);
  }, [customerSearch]);

  const updateItem = (id: number, field: string, val: string) => {
    setItems(prev => prev.map(it => it.id !== id ? it : { ...it, [field]: field === 'qty' || field === 'rate' ? (Number(val) || 0) : val }));
  };
  const removeItem = (id: number) => { if (items.length > 1) setItems(prev => prev.filter(it => it.id !== id)); };
  const addItem = () => { setItems(prev => [...prev, { id: nextId.current++, name: '', desc: '', qty: 1, rate: 0 }]); };

  const subTotal = items.reduce((s, it) => s + it.qty * it.rate, 0);
  const vat = Math.round(subTotal * 0.05);
  const total = subTotal + vat;

  const onSave = async () => {
    if (!customerId) { setErr('Select a customer'); return; }
    if (!items[0].name) { setErr('Add at least one item'); return; }
    setSaving(true); setErr('');
    try {
      const mapped = items.filter(it => it.name).map(it => ({ description: it.name, subDescription: it.desc, qty: it.qty, rate: it.rate, amount: it.qty * it.rate }));
      if (isEdit) {
        await api.updateInvoice(editId, { customer: customerId, items: mapped, subTotal, total, notes });
        toast('Invoice updated');
      } else {
        await api.createInvoice({ customer: customerId, items: mapped, subTotal, total, notes });
        toast('Invoice created');
      }
      go('invoices');
    } catch (e: any) { setErr(e.message); }
    setSaving(false);
  };

  if (loadingEdit) return (
    <View style={{ flex: 1 }}>
      <BuilderHeader title="Edit invoice" onBack={() => go('invoices')} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.purple} size="large" /></View>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <BuilderHeader title={isEdit ? 'Edit invoice' : 'New invoice'} onBack={() => go('invoices')} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
          <Text style={[st.sectionLabelText, { marginTop: 16, marginBottom: 8 }]}>CUSTOMER</Text>
          {customerId ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: C.purpleLite }}>
              <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: F.display, fontSize: 14, color: C.white }}>{customerName.charAt(0)}</Text>
              </View>
              <Text style={{ flex: 1, fontFamily: F.semi, fontSize: 15, color: C.ink }}>{customerName}</Text>
              <TouchableOpacity onPress={() => { setCustomerId(''); setCustomerName(''); }} activeOpacity={0.7}>
                <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.purple }}>Change</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={st.searchBar}>
                <Icon name="search" size={17} color={C.muted} />
                <TextInput value={customerSearch} onChangeText={setCustomerSearch} placeholder="Search by name or phone"
                  placeholderTextColor={C.faint} style={st.searchInput} autoCorrect={false} />
              </View>
              {customers.length > 0 && (
                <View style={{ borderWidth: 1, borderColor: C.border, borderRadius: 18, backgroundColor: C.white, marginTop: 6, overflow: 'hidden' }}>
                  {customers.map(c => (
                    <TouchableOpacity key={c._id} onPress={() => { setCustomerId(c._id); setCustomerName(c.fullName); setCustomerSearch(''); setCustomers([]); }}
                      style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border }} activeOpacity={0.7}>
                      <Text style={{ fontFamily: F.semi, fontSize: 14, color: C.ink }}>{c.fullName}</Text>
                      <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.ink3 }}>{c.phone || '—'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </>
          )}

          <Text style={[st.sectionLabelText, { marginTop: 22, marginBottom: 8 }]}>LINE ITEMS</Text>
          {items.map((item, idx) => (
            <View key={item.id} style={st.lineItemCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text style={{ fontFamily: F.bold, fontSize: 10, color: C.muted, letterSpacing: 0.8, textTransform: 'uppercase' }}>ITEM {idx + 1}</Text>
                {items.length > 1 && (
                  <TouchableOpacity onPress={() => removeItem(item.id)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: C.warm, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="x" size={12} color={C.ink3} />
                  </TouchableOpacity>
                )}
              </View>
              <TextInput value={item.name} onChangeText={v => updateItem(item.id, 'name', v)} placeholder="Item name"
                placeholderTextColor={C.faint} style={{ fontFamily: F.bold, fontSize: 15, color: C.ink, padding: 0, marginBottom: 6 }} />
              <TextInput value={item.desc} onChangeText={v => updateItem(item.id, 'desc', v)} placeholder="Description (optional)"
                placeholderTextColor={C.faint} style={{ fontFamily: F.reg, fontSize: 13, color: C.ink, padding: 0, marginBottom: 10 }} />
              <View style={{ height: 1, backgroundColor: C.divider, marginBottom: 10 }} />
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
                <View style={{ width: 68 }}>
                  <Text style={{ fontFamily: F.bold, fontSize: 10, color: C.muted, letterSpacing: 0.8, marginBottom: 4 }}>QTY</Text>
                  <TextInput value={item.qty ? String(item.qty) : ''} onChangeText={v => updateItem(item.id, 'qty', v)}
                    style={{ fontFamily: F.display, fontSize: 17, color: C.ink, padding: 0 }} keyboardType="numeric" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: F.bold, fontSize: 10, color: C.muted, letterSpacing: 0.8, marginBottom: 4 }}>RATE (AED)</Text>
                  <TextInput value={item.rate ? String(item.rate) : ''} onChangeText={v => updateItem(item.id, 'rate', v)}
                    style={{ fontFamily: F.display, fontSize: 17, color: C.ink, padding: 0 }} keyboardType="numeric" />
                </View>
                <View>
                  <Text style={{ fontFamily: F.bold, fontSize: 10, color: C.muted, letterSpacing: 0.8, marginBottom: 4 }}>AMOUNT</Text>
                  <Text style={{ fontFamily: F.display, fontSize: 17, color: C.purple }}>{(item.qty * item.rate).toLocaleString()}</Text>
                </View>
              </View>
            </View>
          ))}
          <TouchableOpacity onPress={addItem} activeOpacity={0.7}
            style={{ height: 46, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(91,43,201,0.4)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <Text style={{ fontFamily: F.bold, fontSize: 13, color: C.purple }}>+ Add item</Text>
          </TouchableOpacity>

          <View style={st.totalsPanel}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
              <Text style={{ fontFamily: F.reg, fontSize: 13, color: '#4A1FA0' }}>Subtotal</Text>
              <Text style={{ fontFamily: F.semi, fontSize: 13, color: '#4A1FA0' }}>{fmtAED(subTotal)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
              <Text style={{ fontFamily: F.reg, fontSize: 13, color: '#4A1FA0' }}>VAT 5%</Text>
              <Text style={{ fontFamily: F.semi, fontSize: 13, color: '#4A1FA0' }}>{fmtAED(vat)}</Text>
            </View>
            <View style={{ height: 1, backgroundColor: '#DDD0FF', marginVertical: 6 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontFamily: F.bold, fontSize: 15, color: '#4A1FA0' }}>Total</Text>
              <Text style={{ fontFamily: F.display, fontSize: 24, color: '#4A1FA0', letterSpacing: -0.5 }}>{fmtAED(total)}</Text>
            </View>
          </View>

          <Text style={[st.sectionLabelText, { marginTop: 18, marginBottom: 8 }]}>NOTES</Text>
          <TextInput value={notes} onChangeText={setNotes} placeholder="Access, parking, lift booking, fragile items…"
            placeholderTextColor={C.faint} style={st.notesInput} multiline />

          {!!err && <Text style={st.errText}>{err}</Text>}
          <View style={{ height: 16 }} />
          <PrimaryButton label={saving ? 'Saving…' : isEdit ? 'Update invoice' : 'Create invoice'} onPress={onSave} disabled={saving} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SITE VISITS
   ═══════════════════════════════════════════════════════════════ */
const VISIT_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'to_book', label: 'To book' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'surveyed', label: 'Surveyed' },
];

function SiteVisitsScreen() {
  const { go } = useApp();
  const { toast } = useToast();
  const [visits, setVisits] = useState<any[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { const data = await api.getSiteVisits(); setVisits(Array.isArray(data) ? data : []); } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const counts: Record<string, number> = { all: visits.length };
  visits.forEach(v => { const s = v.status || 'to_book'; counts[s] = (counts[s] || 0) + 1; });
  const filtered = filter === 'all' ? visits : visits.filter(v => (v.status || 'to_book') === filter);

  return (
    <View style={{ flex: 1 }}>
      <PageHeader title="Site visits" subtitle="Surveys before quoting" onBack={() => go('dashboard')} onAdd={() => go('newSiteVisit')} />
      <View style={{ paddingHorizontal: 22 }}>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
          <StatCard value={String(counts.to_book || 0)} label="To book" color={C.orange} />
          <StatCard value={String(counts.scheduled || 0)} label="Scheduled" color={C.purple} />
          <StatCard value={String(counts.surveyed || counts.survey_done || 0)} label="Surveyed" color={C.green} />
        </View>
        <FilterChips filters={VISIT_FILTERS} active={filter} counts={counts} onSelect={setFilter} />
      </View>
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.purple} size="large" /></View>
      ) : (
        <FlatList data={filtered} keyExtractor={item => item._id}
          contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 30 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.purple} />}
          ListEmptyComponent={<EmptyState icon="map-pin" text="No site visits" />}
          ItemSeparatorComponent={() => <View style={{ height: 9 }} />}
          renderItem={({ item: v }) => (
            <RecordRow item={v} type="visit" onPress={() => toast('Details coming soon')}
              onPrimary={() => toast('Action coming soon')}
              onSecondary={() => toast('Details coming soon')} />
          )} />
      )}
    </View>
  );
}

/* ═══ NEW SITE VISIT ═══ */
function NewSiteVisitScreen() {
  const { go } = useApp();
  const { toast } = useToast();
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [address, setAddress] = useState('');
  const [visitDate, setVisitDate] = useState(isoDate(new Date()));
  const [selectedTime, setSelectedTime] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<{ uri: string; name: string; type: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const dateDays: Date[] = [];
  for (let i = 0; i < 14; i++) { const d = new Date(); d.setDate(d.getDate() + i); dateDays.push(d); }

  const onPickPhotos = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow media access.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.All, quality: 0.7, allowsMultipleSelection: true });
    if (res.canceled || res.assets.length === 0) return;
    setPhotos(prev => [...prev, ...res.assets.map((a, i) => ({ uri: a.uri, name: a.fileName || `file_${i}.jpg`, type: a.mimeType || 'image/jpeg' }))]);
  };

  const onCreate = async () => {
    if (!customerName.trim()) { setErr('Enter customer name'); return; }
    setSaving(true); setErr('');
    try {
      await api.createSiteVisit({
        visitDate, customerName: customerName.trim(), customerPhone: customerPhone.trim(),
        address: address.trim(), notes: notes.trim(),
        files: photos.length > 0 ? photos : undefined,
      });
      toast('Site visit booked');
      go('siteVisits');
    } catch (e: any) { setErr(e.message); }
    setSaving(false);
  };

  return (
    <View style={{ flex: 1 }}>
      <BuilderHeader title="New site visit" onBack={() => go('siteVisits')} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
          <FieldCard label="CUSTOMER NAME" value={customerName} onChange={setCustomerName} placeholder="Full name" icon="user" />
          <FieldCard label="PHONE" value={customerPhone} onChange={setCustomerPhone} placeholder="+971 XX XXX XXXX" icon="phone" keyboard="phone-pad" />
          <FieldCard label="ADDRESS" value={address} onChange={setAddress} placeholder="Site address" icon="map-pin" />

          <Text style={[st.sectionLabelText, { marginTop: 22, marginBottom: 10 }]}>VISIT DATE</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {dateDays.map(d => {
              const iso = isoDate(d);
              const on = iso === visitDate;
              const dow = d.toLocaleDateString('en-GB', { weekday: 'short' }).substring(0, 3).toUpperCase();
              return (
                <TouchableOpacity key={iso} onPress={() => setVisitDate(iso)} activeOpacity={0.85}
                  style={[st.dateTile, on && st.dateTileOn]}>
                  <Text style={[st.dateTileDow, on && { color: C.white }]}>{dow}</Text>
                  <Text style={[st.dateTileNum, on && { color: C.white }]}>{d.getDate()}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={[st.sectionLabelText, { marginTop: 22, marginBottom: 10 }]}>TIME</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {TIME_SLOTS.map(t => {
              const on = selectedTime === t;
              return (
                <TouchableOpacity key={t} onPress={() => setSelectedTime(t)} activeOpacity={0.85}
                  style={[st.timeChip, on && st.timeChipOn]}>
                  <Text style={[st.timeChipTxt, on && st.timeChipTxtOn]}>{t}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[st.sectionLabelText, { marginTop: 22, marginBottom: 8 }]}>PHOTOS / VIDEOS</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <TouchableOpacity onPress={onPickPhotos} activeOpacity={0.7}
              style={{ width: 80, height: 80, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: C.border, backgroundColor: C.purpleLite, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="camera" size={20} color={C.purple} />
              <Text style={{ fontFamily: F.semi, fontSize: 10, color: C.purple, marginTop: 4 }}>Add</Text>
            </TouchableOpacity>
            {photos.map((p, i) => (
              <View key={i} style={st.photoThumb}>
                <Image source={{ uri: p.uri }} style={{ width: '100%', height: '100%' }} />
              </View>
            ))}
          </View>

          <Text style={[st.sectionLabelText, { marginTop: 22, marginBottom: 8 }]}>NOTES</Text>
          <TextInput value={notes} onChangeText={setNotes} placeholder="Visit observations, items to move…"
            placeholderTextColor={C.faint} style={st.notesInput} multiline />

          {!!err && <Text style={st.errText}>{err}</Text>}
          <View style={{ height: 16 }} />
          <PrimaryButton label={saving ? 'Creating…' : 'Book site visit'} onPress={onCreate} disabled={saving} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════
   LEADS / WORKERS / FLEET (kept as-is, accessible from profile)
   ═══════════════════════════════════════════════════════════════ */
function LeadsScreen() {
  const { go } = useApp();
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => { try { const data = await api.getLeads(); setLeads(Array.isArray(data) ? data : []); } catch {} setLoading(false); }, []);
  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  return (
    <View style={{ flex: 1 }}>
      <TopBar title="Leads" onBack={() => go('profile')} />
      {loading ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.purple} size="large" /></View> : (
        <FlatList data={leads} keyExtractor={item => item._id} contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 20 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.purple} />}
          ListEmptyComponent={<EmptyState icon="user-plus" text="No leads found" />}
          ItemSeparatorComponent={() => <View style={{ height: 9 }} />}
          renderItem={({ item: l }) => {
            const sc = getStatusStyle(l.status || 'new');
            return (
              <View style={st.card}>
                <View style={[st.cardBar, { backgroundColor: sc.bar }]} />
                <View style={{ flex: 1, padding: 14 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: F.bold, fontSize: 15, color: C.ink }}>{l.customerName}</Text>
                      <Text style={{ fontFamily: MONO, fontSize: 10, color: C.muted, marginTop: 3 }}>{l.leadNo}</Text>
                    </View>
                    <StatusBadge status={l.status || 'new'} />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 }}>
                    {l.phone && <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.ink3 }}>{l.phone}</Text>}
                    <Text style={{ fontFamily: F.reg, fontSize: 11, color: C.muted }}>{fmtDate(l.createdAt)}</Text>
                  </View>
                </View>
              </View>
            );
          }} />
      )}
    </View>
  );
}

function WorkersScreen() {
  const { go } = useApp();
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => { try { const data = await api.getWorkers(); setWorkers(Array.isArray(data) ? data : []); } catch {} setLoading(false); }, []);
  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  return (
    <View style={{ flex: 1 }}>
      <TopBar title="Crew" onBack={() => go('profile')} />
      {loading ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.purple} size="large" /></View> : (
        <FlatList data={workers} keyExtractor={item => item._id} contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 20 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.purple} />}
          ListEmptyComponent={<EmptyState icon="users" text="No crew members" />}
          ItemSeparatorComponent={() => <View style={{ height: 9 }} />}
          renderItem={({ item: w }) => {
            const sc = getStatusStyle(w.status || 'active');
            return (
              <View style={st.card}>
                <View style={[st.cardBar, { backgroundColor: sc.bar }]} />
                <View style={{ flex: 1, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ width: 38, height: 38, borderRadius: 14, backgroundColor: C.purpleLite, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontFamily: F.display, fontSize: 14, color: C.purple }}>{(w.name || 'W').charAt(0)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: F.bold, fontSize: 14, color: C.ink }}>{w.name}</Text>
                    <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.ink3 }}>{w.role || '—'}{w.phone ? ` · ${w.phone}` : ''}</Text>
                  </View>
                  <StatusBadge status={w.status || 'active'} />
                </View>
              </View>
            );
          }} />
      )}
    </View>
  );
}

function FleetScreen() {
  const { go } = useApp();
  const [trucks, setTrucks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => { try { const data = await api.getTrucks(); setTrucks(Array.isArray(data) ? data : []); } catch {} setLoading(false); }, []);
  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  return (
    <View style={{ flex: 1 }}>
      <TopBar title="Fleet" onBack={() => go('profile')} />
      {loading ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.purple} size="large" /></View> : (
        <FlatList data={trucks} keyExtractor={item => item._id} contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 20 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.purple} />}
          ListEmptyComponent={<EmptyState icon="truck" text="No trucks" />}
          ItemSeparatorComponent={() => <View style={{ height: 9 }} />}
          renderItem={({ item: t }) => {
            const sc = getStatusStyle(t.status || 'available');
            return (
              <View style={st.card}>
                <View style={[st.cardBar, { backgroundColor: sc.bar }]} />
                <View style={{ flex: 1, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ width: 38, height: 38, borderRadius: 14, backgroundColor: '#FFF0DB', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="truck" size={16} color={C.orange} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: F.bold, fontSize: 14, color: C.ink }}>{t.name}</Text>
                    <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.ink3 }}>{t.plateNumber || '—'}</Text>
                  </View>
                  <StatusBadge status={t.status || 'available'} />
                </View>
              </View>
            );
          }} />
      )}
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════════════ */
const st = StyleSheet.create({
  /* Toast */
  toast: {
    position: 'absolute', bottom: 104, left: 22, right: 22,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.ink, borderRadius: 18, paddingVertical: 13, paddingHorizontal: 16,
  },
  toastText: { fontFamily: F.semi, fontSize: 13, color: C.white },

  /* Login */
  logoMark: { width: 40, height: 40, borderRadius: 11, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center' },
  logoInner: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)' },
  logoText: { fontFamily: F.display, fontSize: 23, color: C.ink },
  eyebrow: { fontFamily: F.semi, fontSize: 12, letterSpacing: 1.4, color: C.purple, marginTop: 40 },
  h1: { fontFamily: F.displayXB, fontSize: 30, color: C.ink, marginTop: 10, lineHeight: 36 },
  upperLabel: { fontFamily: F.bold, fontSize: 11, color: C.muted, textTransform: 'uppercase' as const, letterSpacing: 0.8, marginBottom: 8 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, height: 52, borderRadius: 18,
    backgroundColor: C.white, paddingHorizontal: 15, borderWidth: 1, borderColor: C.border,
  },
  inputField: { flex: 1, fontFamily: F.semi, fontSize: 16, color: C.ink },
  errText: { fontFamily: F.med, fontSize: 13, color: C.red, marginTop: 12 },

  /* Cards */
  card: {
    flexDirection: 'row', backgroundColor: C.white, borderRadius: 22, overflow: 'hidden' as const,
    borderWidth: 1, borderColor: C.border,
    shadowColor: C.ink, shadowOpacity: 0.03, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  cardBar: { width: 4, flex: 0 },

  /* Filter chips */
  fChip: {
    height: 34, borderRadius: 12, paddingHorizontal: 14,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.white, borderWidth: 1, borderColor: C.border,
  },
  fChipOn: { backgroundColor: C.ink, borderColor: C.ink },
  fChipTxt: { fontFamily: F.bold, fontSize: 13, color: C.ink },
  fChipTxtOn: { color: C.white },
  fChipCount: { fontFamily: F.bold, fontSize: 11, color: C.ink, opacity: 0.65 },

  /* Search bar */
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10, height: 46, borderRadius: 16,
    backgroundColor: C.white, paddingHorizontal: 14, borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, fontFamily: F.reg, fontSize: 14, color: C.ink },

  /* Section label */
  sectionLabelText: { fontFamily: F.bold, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase' as const, color: C.muted },

  /* Dashboard */
  bellBtn: {
    width: 40, height: 40, borderRadius: 14, backgroundColor: C.white,
    borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center',
  },
  bellDot: {
    position: 'absolute', top: 8, right: 9, width: 7, height: 7, borderRadius: 4,
    backgroundColor: '#E8930C', borderWidth: 2, borderColor: C.white,
  },
  headerAvatar: { width: 40, height: 40, borderRadius: 14, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center' },
  heroCard: {
    backgroundColor: '#4D22B0', borderRadius: 28, padding: 20,
    shadowColor: C.purple, shadowOpacity: 0.32, shadowRadius: 17, shadowOffset: { width: 0, height: 16 }, elevation: 10,
  },
  heroPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.18)',
  },
  draftCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.white, borderRadius: 22,
    padding: 14, paddingHorizontal: 15, borderWidth: 1, borderColor: C.border,
  },
  draftTimeWell: {
    width: 42, height: 42, borderRadius: 14, backgroundColor: C.warm,
    alignItems: 'center', justifyContent: 'center',
  },
  shortcutBtn: {
    flex: 1, backgroundColor: C.white, borderRadius: 20, paddingTop: 14, paddingBottom: 11, alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: C.border,
  },

  /* Schedule */
  dayPill: {
    width: 52, height: 66, borderRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 2,
    backgroundColor: C.white, borderWidth: 1, borderColor: C.border,
  },
  dayPillOn: { backgroundColor: C.ink, borderColor: C.ink },
  dayDow: { fontFamily: F.semi, fontSize: 10, color: C.ink, opacity: 0.7, textTransform: 'uppercase' as const },
  dayNum: { fontFamily: F.display, fontSize: 19, color: C.ink },
  dayDot: { width: 5, height: 5, borderRadius: 3 },

  /* Profile */
  profileAvatar: { width: 62, height: 62, borderRadius: 22, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center' },
  statCardSm: { flex: 1, backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 18, padding: 12 },
  statValSm: { fontFamily: F.display, fontSize: 22, color: C.ink, letterSpacing: -0.5, lineHeight: 24 },
  statLabelSm: { fontFamily: F.semi, fontSize: 11, color: C.ink3, marginTop: 5 },
  menuCard: { backgroundColor: C.white, borderRadius: 24, overflow: 'hidden' as const, borderWidth: 1, borderColor: C.border },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 15 },
  menuEmojiWell: { width: 34, height: 34, borderRadius: 12, backgroundColor: C.purpleLite, alignItems: 'center', justifyContent: 'center' },
  signOutBtn: {
    marginTop: 20, height: 50, borderRadius: 18, backgroundColor: 'transparent',
    borderWidth: 1, borderColor: 'rgba(20,8,31,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },

  /* Job detail sheet */
  infoTile: { flex: 1, backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 18, padding: 12 },
  infoLabel: { fontFamily: F.bold, fontSize: 10, color: C.muted, letterSpacing: 0.8, textTransform: 'uppercase' as const, marginBottom: 4 },
  detailCard: { backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 22, padding: 16 },
  iconWell: { width: 34, height: 34, borderRadius: 12, backgroundColor: C.purpleLite, alignItems: 'center', justifyContent: 'center' },
  outlineSmBtn: { height: 30, paddingHorizontal: 12, borderRadius: 11, borderWidth: 1, borderColor: 'rgba(20,8,31,0.12)', alignItems: 'center', justifyContent: 'center' },
  photoThumb: { width: 80, height: 80, borderRadius: 14, overflow: 'hidden' as const, backgroundColor: C.warm },

  /* New Job wizard */
  fieldCard: { backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 18, padding: 15, marginBottom: 10 },
  fieldLabel: { fontFamily: F.bold, fontSize: 11, color: C.muted, letterSpacing: 0.8, textTransform: 'uppercase' as const, marginBottom: 8 },
  typeCard: {
    width: '48%' as any, borderRadius: 20, padding: 14, backgroundColor: C.white,
    borderWidth: 1, borderColor: C.border,
  },
  dateTile: {
    width: 54, height: 62, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.white, borderWidth: 1, borderColor: C.border,
  },
  dateTileOn: { backgroundColor: C.ink, borderColor: C.ink },
  dateTileDow: { fontFamily: F.semi, fontSize: 10, color: C.ink, opacity: 0.7, textTransform: 'uppercase' as const },
  dateTileNum: { fontFamily: F.display, fontSize: 19, color: C.ink, marginTop: 2 },
  timeChip: {
    height: 40, paddingHorizontal: 16, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.white, borderWidth: 1, borderColor: C.border,
  },
  timeChipOn: { backgroundColor: '#EDE5FF', borderColor: C.purple },
  timeChipTxt: { fontFamily: F.semi, fontSize: 14, color: C.ink },
  timeChipTxtOn: { color: '#4A1FA0' },
  estimatePanel: {
    backgroundColor: '#F7F3FF', borderWidth: 1, borderColor: '#DDD0FF', borderRadius: 22, padding: 16, marginTop: 16,
  },

  /* Builder / forms */
  darkBackBtn: { width: 36, height: 36, borderRadius: 13, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  lineItemCard: { backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 22, padding: 15, marginBottom: 10 },
  totalsPanel: { backgroundColor: '#F7F3FF', borderWidth: 1, borderColor: '#DDD0FF', borderRadius: 20, padding: 16, marginBottom: 16 },
  notesInput: {
    borderRadius: 18, backgroundColor: C.white, padding: 14, minHeight: 84,
    fontFamily: F.reg, fontSize: 14, color: C.ink, textAlignVertical: 'top' as const,
    borderWidth: 1, borderColor: C.border,
  },

  /* Legacy compat */
  faint: { color: '#CFC9D6' },
});
