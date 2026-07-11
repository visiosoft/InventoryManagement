import React, { useState, useEffect, useCallback } from 'react';
import {
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
  RefreshControl, FlatList, Alert, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  C, F, Icon, PrimaryButton, OutlineButton, TopBar, Footer, BottomNav,
  StatusBadge, useApp,
} from './core';
import { api, setToken } from './api';

const TAB_SCREENS = new Set(['dashboard', 'jobs', 'schedule', 'profile']);

export function Router() {
  const { s } = useApp();
  const map: Record<string, React.ReactNode> = {
    login: <LoginScreen />,
    dashboard: <DashboardScreen />,
    jobs: <JobsScreen />,
    jobDetail: <JobDetailScreen />,
    newJob: <NewJobScreen />,
    schedule: <ScheduleScreen />,
    profile: <ProfileScreen />,
  };
  const showNav = TAB_SCREENS.has(s.screen);
  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <View style={{ flex: 1 }}>{map[s.screen]}</View>
      {showNav && <BottomNav />}
    </View>
  );
}

/* ─── helpers ─── */
function fmtDate(d: string | undefined) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function shortAddr(a: string | undefined) {
  if (!a) return '—';
  return a.length > 35 ? a.substring(0, 35) + '…' : a;
}
function isoDate(d: Date) {
  return d.toISOString().split('T')[0];
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
    } catch (e: any) {
      setErr(e.message || 'Login failed');
    }
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
          <Icon name="mail" size={18} color={C.ink3} />
          <TextInput value={email} onChangeText={setEmail} placeholder="you@purplebox.ae"
            placeholderTextColor={C.faint} style={st.inputField}
            keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
        </View>

        <Text style={[st.upperLabel, { marginTop: 18 }]}>PASSWORD</Text>
        <View style={st.inputRow}>
          <Icon name="lock" size={18} color={C.ink3} />
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
  const [summary, setSummary] = useState<any>(null);
  const [recentJobs, setRecentJobs] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [sum, jobsRes] = await Promise.all([
        api.getSummary(),
        api.getJobs({ limit: '8' }),
      ]);
      setSummary(sum);
      setRecentJobs(jobsRes.jobs || []);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  const initial = s.user?.name ? s.user.name.charAt(0).toUpperCase() : 'P';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 20 }} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.purple} />}>

        {/* Header */}
        <View style={st.hubHeader}>
          <View>
            <Text style={st.hubGreetingSub}>{greeting}</Text>
            <Text style={st.hubGreeting}>{s.user?.name || 'Team'} 👋</Text>
          </View>
          <View style={st.hubAvatar}><Text style={st.hubAvatarLetter}>{initial}</Text></View>
        </View>

        {/* Stats */}
        <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <StatCard label="Active Jobs" value={summary?.activeJobs ?? '—'} color={C.purple} />
            <StatCard label="This Month" value={summary?.jobsThisMonth ?? '—'} color="#3b82f6" />
            <StatCard label="Revenue" value={summary?.revenueThisMonth ? `${(summary.revenueThisMonth / 1000).toFixed(1)}k` : '—'} color={C.green} />
          </View>
        </View>

        {/* Quick actions */}
        <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity onPress={() => go('newJob')} activeOpacity={0.85} style={st.quickAction}>
              <View style={[st.qaIcon, { backgroundColor: C.purpleLite }]}><Icon name="plus" size={20} color={C.purple} /></View>
              <Text style={st.qaLabel}>New Job</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => go('schedule')} activeOpacity={0.85} style={st.quickAction}>
              <View style={[st.qaIcon, { backgroundColor: C.orangeBg }]}><Icon name="calendar" size={20} color={C.orange} /></View>
              <Text style={st.qaLabel}>Schedule</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => go('jobs')} activeOpacity={0.85} style={st.quickAction}>
              <View style={[st.qaIcon, { backgroundColor: C.greenBg }]}><Icon name="list" size={20} color={C.green} /></View>
              <Text style={st.qaLabel}>All Jobs</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Upcoming jobs */}
        {summary?.upcomingJobs?.length > 0 && (
          <View style={{ paddingHorizontal: 20, marginTop: 24 }}>
            <Text style={st.sectionTitle}>Upcoming Jobs</Text>
            <View style={{ gap: 10 }}>
              {summary.upcomingJobs.slice(0, 5).map((job: any) => (
                <TouchableOpacity key={job._id} onPress={() => go('jobDetail', job._id)} activeOpacity={0.85} style={st.jobCard}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={st.jobNo}>{job.jobNo}</Text>
                      <Text style={st.jobCustomer}>{job.customer?.fullName || '—'}</Text>
                    </View>
                    <StatusBadge status={job.status} />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
                    <Icon name="calendar" size={13} color={C.ink3} />
                    <Text style={st.jobMeta}>{fmtDate(job.scheduledDate)}</Text>
                    {job.scheduledTimeSlot && <>
                      <Text style={st.jobMeta}>·</Text>
                      <Icon name="clock" size={13} color={C.ink3} />
                      <Text style={st.jobMeta}>{job.scheduledTimeSlot}</Text>
                    </>}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Recent jobs */}
        {recentJobs.length > 0 && (
          <View style={{ paddingHorizontal: 20, marginTop: 24 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <Text style={st.sectionTitle}>Recent Jobs</Text>
              <TouchableOpacity onPress={() => go('jobs')} activeOpacity={0.7}>
                <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.purple }}>View All</Text>
              </TouchableOpacity>
            </View>
            <View style={{ gap: 10 }}>
              {recentJobs.map((job: any) => (
                <TouchableOpacity key={job._id} onPress={() => go('jobDetail', job._id)} activeOpacity={0.85} style={st.jobCard}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={st.jobNo}>{job.jobNo}</Text>
                      <Text style={st.jobCustomer}>{job.customer?.fullName || '—'}</Text>
                    </View>
                    <StatusBadge status={job.status} />
                  </View>
                  <View style={st.jobRoute}>
                    <View style={st.routeDotFilled} />
                    <Text style={st.jobMeta} numberOfLines={1}>{shortAddr(job.pickupAddress)}</Text>
                  </View>
                  {job.deliveryAddress && (
                    <View style={st.jobRoute}>
                      <View style={st.routeDotOutline} />
                      <Text style={st.jobMeta} numberOfLines={1}>{shortAddr(job.deliveryAddress)}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <View style={st.statCard}>
      <Text style={[st.statValue, { color }]}>{value}</Text>
      <Text style={st.statLabel}>{label}</Text>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════
   JOBS LIST
   ═══════════════════════════════════════════════════════════════ */
const JOB_FILTERS = ['all', 'draft', 'confirmed', 'in_progress', 'completed'] as const;

function JobsScreen() {
  const { go } = useApp();
  const [jobs, setJobs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const p: Record<string, string> = { limit: '50' };
      if (filter !== 'all') p.status = filter;
      if (search.trim()) p.q = search.trim();
      const r = await api.getJobs(p);
      setJobs(r.jobs || []);
      setTotal(r.total || 0);
    } catch {}
    setLoading(false);
  }, [filter, search]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const filterLabel = (f: string) => {
    if (f === 'all') return 'All';
    return f.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  return (
    <View style={{ flex: 1 }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontFamily: F.displayXB, fontSize: 26, color: C.ink }}>Jobs</Text>
          <TouchableOpacity onPress={() => go('newJob')} style={st.headerAddBtn} activeOpacity={0.85}>
            <Icon name="plus" size={18} color={C.white} />
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View style={[st.inputRow, { marginTop: 14 }]}>
          <Icon name="search" size={16} color={C.ink3} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search by job no. or address"
            placeholderTextColor={C.faint} style={st.inputField} autoCorrect={false} />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} activeOpacity={0.7}>
              <Icon name="x" size={16} color={C.ink3} />
            </TouchableOpacity>
          )}
        </View>

        {/* Filter chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingVertical: 12 }}>
          {JOB_FILTERS.map(f => (
            <TouchableOpacity key={f} onPress={() => setFilter(f)}
              style={[st.filterChip, filter === f && st.filterChipOn]} activeOpacity={0.85}>
              <Text style={[st.filterChipTxt, filter === f && st.filterChipTxtOn]}>{filterLabel(f)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.purple} size="large" />
        </View>
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={item => item._id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.purple} />}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Icon name="inbox" size={40} color={C.faint} />
              <Text style={{ fontFamily: F.semi, fontSize: 15, color: C.ink3, marginTop: 14 }}>No jobs found</Text>
            </View>
          }
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item: job }) => (
            <TouchableOpacity onPress={() => go('jobDetail', job._id)} activeOpacity={0.85} style={st.jobCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Text style={st.jobNo}>{job.jobNo}</Text>
                  <Text style={st.jobCustomer}>{job.customer?.fullName || '—'}</Text>
                </View>
                <StatusBadge status={job.status} />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
                <Icon name="calendar" size={13} color={C.ink3} />
                <Text style={st.jobMeta}>{fmtDate(job.scheduledDate)}</Text>
              </View>
              {job.pickupAddress && (
                <View style={st.jobRoute}>
                  <View style={st.routeDotFilled} />
                  <Text style={st.jobMeta} numberOfLines={1}>{shortAddr(job.pickupAddress)}</Text>
                </View>
              )}
              {job.deliveryAddress && (
                <View style={st.jobRoute}>
                  <View style={st.routeDotOutline} />
                  <Text style={st.jobMeta} numberOfLines={1}>{shortAddr(job.deliveryAddress)}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════
   JOB DETAIL
   ═══════════════════════════════════════════════════════════════ */
const STATUS_FLOW = ['draft', 'confirmed', 'in_progress', 'completed'];

function JobDetailScreen() {
  const { s, go } = useApp();
  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [uploading, setUploading] = useState(false);

  const loadJob = useCallback(async () => {
    if (!s.selectedJobId) return;
    try {
      const j = await api.getJob(s.selectedJobId);
      setJob(j);
    } catch {}
    setLoading(false);
  }, [s.selectedJobId]);

  useEffect(() => { loadJob(); }, [loadJob]);
  const onRefresh = async () => { setRefreshing(true); await loadJob(); setRefreshing(false); };

  const nextStatus = job ? STATUS_FLOW[STATUS_FLOW.indexOf(job.status) + 1] : null;

  const onStatusChange = async () => {
    if (!nextStatus || !job) return;
    const label = nextStatus.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
    Alert.alert('Update Status', `Change status to "${label}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm', onPress: async () => {
          try {
            const updated = await api.updateJobStatus(job._id, nextStatus);
            setJob(updated);
          } catch (e: any) { Alert.alert('Error', e.message); }
        },
      },
    ]);
  };

  const onAddNote = async () => {
    if (!noteText.trim() || !job) return;
    setAddingNote(true);
    try {
      await api.addJobNote(job._id, noteText.trim(), s.user?.name || 'Staff');
      setNoteText('');
      setShowNoteInput(false);
      await loadJob();
    } catch (e: any) { Alert.alert('Error', e.message); }
    setAddingNote(false);
  };

  const onPickPhotos = async () => {
    if (!job) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access to upload images.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsMultipleSelection: true,
    });
    if (res.canceled || res.assets.length === 0) return;
    setUploading(true);
    try {
      const imgs = res.assets.map((a, i) => ({
        uri: a.uri,
        name: a.fileName || `photo_${i}.jpg`,
        type: a.mimeType || 'image/jpeg',
      }));
      await api.uploadJobImages(job._id, imgs);
      await loadJob();
    } catch (e: any) { Alert.alert('Upload Error', e.message); }
    setUploading(false);
  };

  if (loading) return (
    <View style={{ flex: 1 }}>
      <TopBar title="Job Details" onBack={() => go(s.prevScreen === 'dashboard' ? 'dashboard' : 'jobs')} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={C.purple} size="large" />
      </View>
    </View>
  );

  if (!job) return (
    <View style={{ flex: 1 }}>
      <TopBar title="Job Details" onBack={() => go('jobs')} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: F.semi, color: C.ink3 }}>Job not found</Text>
      </View>
    </View>
  );

  const cust = job.customer;

  return (
    <View style={{ flex: 1 }}>
      <TopBar title={job.jobNo} onBack={() => go(s.prevScreen === 'dashboard' ? 'dashboard' : 'jobs')} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 30 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.purple} />}>

        {/* Status + type */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <StatusBadge status={job.status} />
          <Text style={{ fontFamily: F.med, fontSize: 13, color: C.ink3 }}>
            {(job.jobType || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
          </Text>
        </View>

        {/* Customer */}
        <Section title="Customer" icon="user">
          <Text style={st.detailMain}>{cust?.fullName || '—'}</Text>
          {cust?.phone && <DetailRow icon="phone" text={cust.phone} />}
          {cust?.email && <DetailRow icon="mail" text={cust.email} />}
        </Section>

        {/* Addresses */}
        <Section title="Addresses" icon="map-pin">
          {job.pickupAddress && (
            <View style={{ marginBottom: 10 }}>
              <Text style={st.detailLabel}>PICKUP</Text>
              <Text style={st.detailText}>{job.pickupAddress}</Text>
              {(job.pickupFloor || job.pickupHasElevator) && (
                <Text style={st.detailSub}>
                  {job.pickupFloor ? `Floor ${job.pickupFloor}` : ''}
                  {job.pickupHasElevator ? ' · Elevator' : ''}
                </Text>
              )}
            </View>
          )}
          {job.deliveryAddress && (
            <View>
              <Text style={st.detailLabel}>DELIVERY</Text>
              <Text style={st.detailText}>{job.deliveryAddress}</Text>
              {(job.deliveryFloor || job.deliveryHasElevator) && (
                <Text style={st.detailSub}>
                  {job.deliveryFloor ? `Floor ${job.deliveryFloor}` : ''}
                  {job.deliveryHasElevator ? ' · Elevator' : ''}
                </Text>
              )}
            </View>
          )}
        </Section>

        {/* Schedule */}
        <Section title="Schedule" icon="calendar">
          <DetailRow icon="calendar" text={fmtDate(job.scheduledDate)} />
          {job.scheduledTimeSlot && <DetailRow icon="clock" text={job.scheduledTimeSlot} />}
          {job.estimatedDurationHours && <DetailRow icon="watch" text={`${job.estimatedDurationHours} hours`} />}
        </Section>

        {/* Package */}
        {job.clientPackage?.packageType && (
          <Section title="Package" icon="tag">
            <Text style={st.detailMain}>{job.clientPackage.label || job.clientPackage.packageType}</Text>
            {job.clientPackage.agreedPrice > 0 && (
              <Text style={[st.detailMain, { color: C.purple, marginTop: 4 }]}>
                AED {job.clientPackage.agreedPrice.toLocaleString()}
              </Text>
            )}
            {(job.clientPackage.additionalCharges || []).map((ac: any, i: number) => (
              <Text key={i} style={st.detailSub}>+ {ac.description}: AED {ac.amount}</Text>
            ))}
          </Section>
        )}

        {/* Crew */}
        {job.crew?.length > 0 && (
          <Section title={`Crew (${job.crew.length})`} icon="users">
            {job.crew.map((c: any, i: number) => (
              <View key={i} style={st.crewRow}>
                <View style={st.crewAvatar}>
                  <Text style={{ fontFamily: F.semi, fontSize: 12, color: C.purple }}>
                    {(c.worker?.name || 'W').charAt(0)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: F.semi, fontSize: 14, color: C.ink }}>{c.worker?.name || 'Worker'}</Text>
                  <Text style={{ fontFamily: F.med, fontSize: 12, color: C.ink3 }}>
                    {c.worker?.role || '—'}{c.isSupervisor ? ' · Supervisor' : ''}
                  </Text>
                </View>
              </View>
            ))}
          </Section>
        )}

        {/* Trucks */}
        {job.trucks?.length > 0 && (
          <Section title={`Trucks (${job.trucks.length})`} icon="truck">
            {job.trucks.map((t: any, i: number) => (
              <View key={i} style={st.crewRow}>
                <View style={[st.crewAvatar, { backgroundColor: C.orangeBg }]}>
                  <Icon name="truck" size={14} color={C.orange} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: F.semi, fontSize: 14, color: C.ink }}>{t.truck?.name || 'Truck'}</Text>
                  <Text style={{ fontFamily: F.med, fontSize: 12, color: C.ink3 }}>{t.truck?.plateNumber || '—'}</Text>
                </View>
              </View>
            ))}
          </Section>
        )}

        {/* Photos */}
        <Section title={`Photos (${job.images?.length || 0})`} icon="camera"
          right={
            <TouchableOpacity onPress={onPickPhotos} disabled={uploading} activeOpacity={0.7}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {uploading
                ? <ActivityIndicator size="small" color={C.purple} />
                : <Icon name="plus" size={14} color={C.purple} />}
              <Text style={{ fontFamily: F.semi, fontSize: 12, color: C.purple }}>
                {uploading ? 'Uploading…' : 'Add'}
              </Text>
            </TouchableOpacity>
          }>
          {job.images?.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}>
              {job.images.map((img: any, i: number) => (
                <View key={i} style={st.photoThumb}>
                  <Image source={{ uri: img.viewUrl || img.url }} style={{ width: '100%', height: '100%' }} />
                  {img.category && (
                    <View style={st.photoCatBadge}>
                      <Text style={{ fontFamily: F.semi, fontSize: 9, color: C.white }}>{img.category}</Text>
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>
          ) : (
            <Text style={{ fontFamily: F.med, fontSize: 13, color: C.ink3 }}>No photos yet</Text>
          )}
        </Section>

        {/* Notes / Timeline */}
        <Section title="Notes" icon="message-circle"
          right={
            <TouchableOpacity onPress={() => setShowNoteInput(!showNoteInput)} activeOpacity={0.7}>
              <Icon name={showNoteInput ? 'x' : 'plus'} size={14} color={C.purple} />
            </TouchableOpacity>
          }>
          {showNoteInput && (
            <View style={{ marginBottom: 12 }}>
              <TextInput value={noteText} onChangeText={setNoteText} placeholder="Add a note…"
                placeholderTextColor={C.faint} style={[st.textarea, { minHeight: 60 }]} multiline />
              <PrimaryButton label={addingNote ? 'Saving…' : 'Save Note'} onPress={onAddNote}
                disabled={addingNote || !noteText.trim()} style={{ marginTop: 8, height: 40 }} />
            </View>
          )}
          {(job.timeline || []).length === 0 && !showNoteInput && (
            <Text style={{ fontFamily: F.med, fontSize: 13, color: C.ink3 }}>No notes yet</Text>
          )}
          {(job.timeline || []).slice().reverse().map((n: any, i: number) => (
            <View key={i} style={[st.noteRow, i > 0 && { borderTopWidth: 1, borderTopColor: C.line2 }]}>
              <Text style={st.noteText}>{n.text}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <Text style={st.noteMeta}>{n.author || '—'}</Text>
                <Text style={st.noteMeta}>{fmtDate(n.at)}</Text>
              </View>
            </View>
          ))}
        </Section>
      </ScrollView>

      {/* Bottom action bar */}
      {nextStatus && job.status !== 'cancelled' && (
        <Footer>
          <PrimaryButton
            label={`Mark as ${nextStatus.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}`}
            icon="check-circle"
            onPress={onStatusChange}
          />
        </Footer>
      )}
    </View>
  );
}

function Section({ title, icon, children, right }: {
  title: string; icon: string; children: React.ReactNode; right?: React.ReactNode;
}) {
  return (
    <View style={st.section}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name={icon} size={16} color={C.purple} />
          <Text style={st.sectionLabel}>{title}</Text>
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

function DetailRow({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
      <Icon name={icon} size={14} color={C.ink3} />
      <Text style={st.detailText}>{text}</Text>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════
   NEW JOB
   ═══════════════════════════════════════════════════════════════ */
function NewJobScreen() {
  const { s, go } = useApp();
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customers, setCustomers] = useState<any[]>([]);
  const [jobType, setJobType] = useState('local');
  const [scheduledDate, setScheduledDate] = useState('');
  const [timeSlot, setTimeSlot] = useState('');
  const [pickupAddress, setPickupAddress] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (customerSearch.length < 2) { setCustomers([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await api.searchCustomers(customerSearch);
        setCustomers(r.data || []);
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [customerSearch]);

  const JOB_TYPES = [
    { value: 'local', label: 'Local' },
    { value: 'inter_emirate', label: 'Inter-Emirate' },
    { value: 'international', label: 'International' },
    { value: 'office', label: 'Office Move' },
    { value: 'storage_to_home', label: 'Storage to Home' },
    { value: 'other', label: 'Other' },
  ];

  const onCreate = async () => {
    if (!customerId) { setErr('Select a customer'); return; }
    if (!scheduledDate) { setErr('Enter a scheduled date'); return; }
    setSaving(true); setErr('');
    try {
      const job = await api.createJob({
        customer: customerId,
        jobType,
        scheduledDate: scheduledDate || undefined,
        scheduledTimeSlot: timeSlot || undefined,
        pickupAddress, deliveryAddress, notes,
      });
      go('jobDetail', job._id);
    } catch (e: any) { setErr(e.message); }
    setSaving(false);
  };

  return (
    <View style={{ flex: 1 }}>
      <TopBar title="New Moving Job" onBack={() => go(s.prevScreen === 'dashboard' ? 'dashboard' : 'jobs')} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">

          {/* Customer */}
          <Text style={st.upperLabel}>CUSTOMER</Text>
          {customerId ? (
            <View style={st.selectedCustomer}>
              <View style={st.crewAvatar}>
                <Text style={{ fontFamily: F.semi, fontSize: 14, color: C.purple }}>
                  {customerName.charAt(0)}
                </Text>
              </View>
              <Text style={{ flex: 1, fontFamily: F.semi, fontSize: 15, color: C.ink }}>{customerName}</Text>
              <TouchableOpacity onPress={() => { setCustomerId(''); setCustomerName(''); setCustomerSearch(''); }} activeOpacity={0.7}>
                <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.purple }}>Change</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={st.inputRow}>
                <Icon name="search" size={16} color={C.ink3} />
                <TextInput value={customerSearch} onChangeText={setCustomerSearch}
                  placeholder="Search by name or phone" placeholderTextColor={C.faint}
                  style={st.inputField} autoCorrect={false} />
              </View>
              {customers.length > 0 && (
                <View style={st.searchResults}>
                  {customers.map(c => (
                    <TouchableOpacity key={c._id} onPress={() => {
                      setCustomerId(c._id); setCustomerName(c.fullName);
                      setCustomerSearch(''); setCustomers([]);
                    }} style={st.searchResult} activeOpacity={0.7}>
                      <Text style={{ fontFamily: F.semi, fontSize: 14, color: C.ink }}>{c.fullName}</Text>
                      <Text style={{ fontFamily: F.med, fontSize: 12, color: C.ink3 }}>{c.phone || c.email || '—'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </>
          )}

          {/* Job type */}
          <Text style={[st.upperLabel, { marginTop: 20 }]}>JOB TYPE</Text>
          <View style={st.chipRow}>
            {JOB_TYPES.map(t => (
              <TouchableOpacity key={t.value} onPress={() => setJobType(t.value)}
                style={[st.chip, jobType === t.value && st.chipOn]} activeOpacity={0.85}>
                <Text style={[st.chipTxt, jobType === t.value && st.chipTxtOn]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Date */}
          <Text style={[st.upperLabel, { marginTop: 20 }]}>SCHEDULED DATE</Text>
          <View style={st.inputRow}>
            <Icon name="calendar" size={16} color={C.ink3} />
            <TextInput value={scheduledDate} onChangeText={setScheduledDate}
              placeholder="YYYY-MM-DD" placeholderTextColor={C.faint} style={st.inputField} />
          </View>

          {/* Time slot */}
          <Text style={[st.upperLabel, { marginTop: 18 }]}>TIME SLOT</Text>
          <View style={st.inputRow}>
            <Icon name="clock" size={16} color={C.ink3} />
            <TextInput value={timeSlot} onChangeText={setTimeSlot}
              placeholder="e.g. 08:00–12:00" placeholderTextColor={C.faint} style={st.inputField} />
          </View>

          {/* Addresses */}
          <Text style={[st.upperLabel, { marginTop: 20 }]}>PICKUP ADDRESS</Text>
          <TextInput value={pickupAddress} onChangeText={setPickupAddress}
            placeholder="Full pickup address" placeholderTextColor={C.faint}
            style={[st.textarea, { minHeight: 60 }]} multiline />

          <Text style={[st.upperLabel, { marginTop: 18 }]}>DELIVERY ADDRESS</Text>
          <TextInput value={deliveryAddress} onChangeText={setDeliveryAddress}
            placeholder="Full delivery address" placeholderTextColor={C.faint}
            style={[st.textarea, { minHeight: 60 }]} multiline />

          {/* Notes */}
          <Text style={[st.upperLabel, { marginTop: 18 }]}>NOTES</Text>
          <TextInput value={notes} onChangeText={setNotes}
            placeholder="Special instructions…" placeholderTextColor={C.faint}
            style={[st.textarea, { minHeight: 60 }]} multiline />

          {!!err && <Text style={st.errText}>{err}</Text>}
          <View style={{ height: 16 }} />
          <PrimaryButton label={saving ? 'Creating…' : 'Create Job'} onPress={onCreate} disabled={saving} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SCHEDULE
   ═══════════════════════════════════════════════════════════════ */
function ScheduleScreen() {
  const { go } = useApp();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const from = isoDate(new Date());
      const to = isoDate(new Date(Date.now() + 14 * 86400000));
      const data = await api.getSchedule(from, to);
      setJobs(data || []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const grouped = jobs.reduce((acc: Record<string, any[]>, j: any) => {
    const d = j.scheduledDate ? isoDate(new Date(j.scheduledDate)) : 'Unscheduled';
    (acc[d] = acc[d] || []).push(j);
    return acc;
  }, {});

  const dates = Object.keys(grouped).sort();
  const today = isoDate(new Date());

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 8 }}>
        <Text style={{ fontFamily: F.displayXB, fontSize: 26, color: C.ink }}>Schedule</Text>
        <Text style={{ fontFamily: F.med, fontSize: 13, color: C.ink3, marginTop: 4 }}>Next 14 days</Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.purple} size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.purple} />}>
          {dates.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Icon name="calendar" size={40} color={C.faint} />
              <Text style={{ fontFamily: F.semi, fontSize: 15, color: C.ink3, marginTop: 14 }}>No upcoming jobs</Text>
            </View>
          ) : dates.map(date => (
            <View key={date} style={{ marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Text style={[st.dateHeader, date === today && { color: C.purple }]}>
                  {date === today ? 'Today' : new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                </Text>
                <View style={st.dateBadge}>
                  <Text style={{ fontFamily: F.semi, fontSize: 11, color: C.purple }}>{grouped[date].length}</Text>
                </View>
              </View>
              <View style={{ gap: 8 }}>
                {grouped[date].map((job: any) => (
                  <TouchableOpacity key={job._id} onPress={() => go('jobDetail', job._id)} activeOpacity={0.85} style={st.scheduleCard}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      {job.scheduledTimeSlot ? (
                        <View style={st.timeChip}>
                          <Text style={{ fontFamily: F.semi, fontSize: 11, color: C.purple }}>{job.scheduledTimeSlot}</Text>
                        </View>
                      ) : (
                        <View style={[st.timeChip, { backgroundColor: C.line2 }]}>
                          <Text style={{ fontFamily: F.semi, fontSize: 11, color: C.ink3 }}>TBD</Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: F.semi, fontSize: 14, color: C.ink }}>{job.jobNo}</Text>
                        <Text style={{ fontFamily: F.med, fontSize: 12, color: C.ink3 }} numberOfLines={1}>
                          {job.customer?.fullName || '—'}
                        </Text>
                      </View>
                      <StatusBadge status={job.status} />
                    </View>
                    {job.pickupAddress && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
                        <Icon name="map-pin" size={12} color={C.ink3} />
                        <Text style={{ fontFamily: F.med, fontSize: 12, color: C.ink3 }} numberOfLines={1}>
                          {shortAddr(job.pickupAddress)}
                        </Text>
                      </View>
                    )}
                    {job.crew?.length > 0 && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        <Icon name="users" size={12} color={C.ink3} />
                        <Text style={{ fontFamily: F.med, fontSize: 12, color: C.ink3 }}>
                          {job.crew.length} crew{job.trucks?.length ? ` · ${job.trucks.length} truck${job.trucks.length > 1 ? 's' : ''}` : ''}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
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
   PROFILE
   ═══════════════════════════════════════════════════════════════ */
function ProfileScreen() {
  const { s, logout } = useApp();
  const [summary, setSummary] = useState<any>(null);
  const user = s.user;
  const initial = user?.name ? user.name.charAt(0).toUpperCase() : 'P';

  useEffect(() => {
    api.getSummary().then(setSummary).catch(() => {});
  }, []);

  const onLogout = () => {
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => { setToken(null); logout(); } },
    ]);
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20, paddingTop: 14 }}>
        {/* Avatar */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <View style={st.profileAvatar}><Text style={st.profileAvatarTxt}>{initial}</Text></View>
          <View>
            <Text style={{ fontFamily: F.displayXB, fontSize: 20, color: C.ink }}>{user?.name || '—'}</Text>
            <Text style={{ fontFamily: F.med, fontSize: 13, color: C.ink3, marginTop: 3 }}>{user?.email || '—'}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: C.purpleLite }}>
                <Text style={{ fontFamily: F.semi, fontSize: 11, color: C.purple }}>
                  {(user?.role || '').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Stats */}
        {summary && (
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 24 }}>
            <View style={st.profileStatCard}>
              <Text style={st.profileStatNum}>{summary.totalJobs ?? '—'}</Text>
              <Text style={st.profileStatLabel}>Total Jobs</Text>
            </View>
            <View style={st.profileStatCard}>
              <Text style={st.profileStatNum}>{summary.activeJobs ?? '—'}</Text>
              <Text style={st.profileStatLabel}>Active</Text>
            </View>
            <View style={st.profileStatCard}>
              <Text style={st.profileStatNum}>
                {summary.totalRevenue ? `${(summary.totalRevenue / 1000).toFixed(0)}k` : '—'}
              </Text>
              <Text style={st.profileStatLabel}>Revenue</Text>
            </View>
          </View>
        )}

        {/* Menu */}
        <View style={st.profileMenuCard}>
          <MenuItem icon="briefcase" title="All Jobs" sub="View and manage jobs"
            onPress={() => {}} />
          <MenuItem icon="calendar" title="Schedule" sub="Upcoming job calendar"
            onPress={() => {}} />
          <MenuItem icon="bar-chart-2" title="Reports" sub="Revenue and analytics"
            onPress={() => {}} />
        </View>

        {/* Sign out */}
        <TouchableOpacity onPress={onLogout} activeOpacity={0.7} style={st.signOutBtn}>
          <Icon name="log-out" size={16} color="#ef4444" />
          <Text style={{ fontFamily: F.semi, fontSize: 14, color: '#ef4444' }}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function MenuItem({ icon, title, sub, onPress }: { icon: string; title: string; sub: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={st.menuItem}>
      <View style={st.menuIcon}><Icon name={icon} size={18} color={C.purple} /></View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: F.semi, fontSize: 14, color: C.ink }}>{title}</Text>
        <Text style={{ fontFamily: F.med, fontSize: 12, color: C.ink3, marginTop: 1 }}>{sub}</Text>
      </View>
      <Icon name="chevron-right" size={16} color={C.ink3} />
    </TouchableOpacity>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════════════ */
const st = StyleSheet.create({
  // Login
  logoMark: { width: 40, height: 40, borderRadius: 11, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center' },
  logoInner: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)' },
  logoText: { fontFamily: F.display, fontSize: 23, color: C.ink },
  eyebrow: { fontFamily: F.semi, fontSize: 12, letterSpacing: 1.4, color: C.purple, marginTop: 40 },
  h1: { fontFamily: F.displayXB, fontSize: 30, color: C.ink, marginTop: 10, lineHeight: 36 },
  upperLabel: { fontFamily: F.semi, fontSize: 12, color: C.ink3, textTransform: 'uppercase' as const, letterSpacing: 0.8, marginBottom: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 52, borderWidth: 1, borderColor: C.line2, borderRadius: 14, backgroundColor: C.white, paddingHorizontal: 16 },
  inputField: { flex: 1, fontFamily: F.med, fontSize: 15, color: C.ink },
  textarea: { borderWidth: 1, borderColor: C.line2, borderRadius: 14, backgroundColor: C.white, padding: 14, fontFamily: F.reg, fontSize: 14, color: C.ink, textAlignVertical: 'top' as const },
  errText: { fontFamily: F.med, fontSize: 13, color: C.red, marginTop: 12 },

  // Dashboard
  hubHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16 },
  hubGreeting: { fontFamily: F.displayXB, fontSize: 22, color: C.ink, letterSpacing: -0.4 },
  hubGreetingSub: { fontFamily: F.med, fontSize: 13, color: C.ink3 },
  hubAvatar: { width: 44, height: 44, borderRadius: 14, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center' },
  hubAvatarLetter: { fontFamily: F.display, fontSize: 18, color: C.white },
  statCard: { flex: 1, backgroundColor: C.white, borderWidth: 1, borderColor: C.line2, borderRadius: 16, paddingVertical: 16, paddingHorizontal: 12, alignItems: 'center' },
  statValue: { fontFamily: F.displayXB, fontSize: 26, letterSpacing: -0.5 },
  statLabel: { fontFamily: F.med, fontSize: 11, color: C.ink3, marginTop: 4 },
  quickAction: { flex: 1, backgroundColor: C.white, borderWidth: 1, borderColor: C.line2, borderRadius: 16, paddingVertical: 16, alignItems: 'center', gap: 8 },
  qaIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  qaLabel: { fontFamily: F.semi, fontSize: 12, color: C.ink },
  sectionTitle: { fontFamily: F.display, fontSize: 18, color: C.ink, letterSpacing: -0.2, marginBottom: 14 },

  // Jobs
  headerAddBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center' },
  jobCard: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line2, borderRadius: 16, padding: 16 },
  jobNo: { fontFamily: F.bold, fontSize: 15, color: C.ink },
  jobCustomer: { fontFamily: F.med, fontSize: 13, color: C.ink3, marginTop: 2 },
  jobMeta: { fontFamily: F.med, fontSize: 12, color: C.ink3 },
  jobRoute: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  routeDotFilled: { width: 7, height: 7, borderRadius: 999, backgroundColor: C.purple },
  routeDotOutline: { width: 7, height: 7, borderRadius: 999, borderWidth: 2, borderColor: C.purple },
  filterChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(20,8,31,0.04)' },
  filterChipOn: { backgroundColor: C.ink },
  filterChipTxt: { fontFamily: F.semi, fontSize: 13, color: C.ink3 },
  filterChipTxtOn: { color: C.white },

  // Job detail
  section: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line2, borderRadius: 16, padding: 16, marginBottom: 12 },
  sectionLabel: { fontFamily: F.bold, fontSize: 14, color: C.ink },
  detailMain: { fontFamily: F.semi, fontSize: 16, color: C.ink },
  detailLabel: { fontFamily: F.semi, fontSize: 10, color: C.ink3, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginBottom: 4 },
  detailText: { fontFamily: F.med, fontSize: 14, color: C.ink },
  detailSub: { fontFamily: F.med, fontSize: 12, color: C.ink3, marginTop: 2 },
  crewRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  crewAvatar: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.purpleLite, alignItems: 'center', justifyContent: 'center' },
  photoThumb: { width: 80, height: 80, borderRadius: 12, overflow: 'hidden', backgroundColor: C.line2 },
  photoCatBadge: { position: 'absolute', bottom: 4, left: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.5)' },
  noteRow: { paddingVertical: 10 },
  noteText: { fontFamily: F.med, fontSize: 14, color: C.ink, lineHeight: 20 },
  noteMeta: { fontFamily: F.med, fontSize: 11, color: C.ink3 },

  // New job
  selectedCustomer: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, backgroundColor: C.purpleLite },
  searchResults: { borderWidth: 1, borderColor: C.line2, borderRadius: 14, backgroundColor: C.white, marginTop: 6, overflow: 'hidden' },
  searchResult: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: C.line, backgroundColor: C.white },
  chipOn: { borderColor: C.purple, backgroundColor: C.purple },
  chipTxt: { fontFamily: F.semi, fontSize: 12, color: C.ink },
  chipTxtOn: { color: C.white },

  // Schedule
  dateHeader: { fontFamily: F.display, fontSize: 16, color: C.ink },
  dateBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: C.purpleLite },
  scheduleCard: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line2, borderRadius: 14, padding: 14 },
  timeChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: C.purpleLite },

  // Profile
  profileAvatar: { width: 68, height: 68, borderRadius: 22, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center' },
  profileAvatarTxt: { fontFamily: F.display, fontSize: 26, color: C.white },
  profileStatCard: { flex: 1, backgroundColor: C.white, borderWidth: 1, borderColor: C.line2, borderRadius: 16, paddingVertical: 18, paddingHorizontal: 12, alignItems: 'center' },
  profileStatNum: { fontFamily: F.displayXB, fontSize: 24, color: C.purple },
  profileStatLabel: { fontFamily: F.med, fontSize: 11, color: C.ink3, marginTop: 4 },
  profileMenuCard: { backgroundColor: C.white, borderRadius: 18, borderWidth: 1, borderColor: C.line2, overflow: 'hidden' },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderBottomWidth: 1, borderBottomColor: C.line2 },
  menuIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.purpleLite, alignItems: 'center', justifyContent: 'center' },
  signOutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 20, paddingVertical: 14, borderRadius: 14, backgroundColor: 'rgba(239,68,68,0.06)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.12)' },
});
