import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  FlatList, ActivityIndicator, Alert, RefreshControl, Image,
  Dimensions, Modal, Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, Icon, TabBar, BackButton, useApp } from './core';
import { api, setToken } from './api';

const W = Dimensions.get('window').width;

export function Router() {
  const { s } = useApp();
  switch (s.screen) {
    case 'login': return <LoginScreen />;
    case 'jobs': return <DashboardScreen />;
    case 'jobDetail': return <JobDetailScreen />;
    case 'profile': return <ProfileScreen />;
    default: return <DashboardScreen />;
  }
}

/* ═══════════════════ LOGIN ═══════════════════ */

function LoginScreen() {
  const { login } = useApp();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const insets = useSafeAreaInsets();

  const handleLogin = async () => {
    if (phone.length < 8) { setError('Enter a valid phone number'); return; }
    setLoading(true); setError('');
    try {
      const otpRes = await api.requestOtp(phone);
      const res = await api.verifyOtp(phone, otpRes.code);
      setToken(res.token);
      login({ id: res.worker.id, name: res.worker.name, phone: res.worker.phone, role: res.worker.role }, res.token);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <View style={[ss.fill, { paddingTop: insets.top + 40, backgroundColor: C.ink }]}>
      <View style={{ flex: 1, backgroundColor: C.paper, borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingTop: 48 }}>
        <View style={ss.loginWrap}>
          <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center', marginBottom: 20, shadowColor: C.purple, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8 }}>
            <Icon name="truck" size={34} color={C.white} />
          </View>
          <Text style={{ fontFamily: F.displayXB, fontSize: 30, color: C.ink, letterSpacing: -0.5 }}>PurpleBox Crew</Text>
          <Text style={{ fontFamily: F.reg, fontSize: 15, color: C.ink3, marginTop: 6 }}>Sign in to view your jobs</Text>

          <View style={{ marginTop: 40, width: '100%' }}>
            <Text style={ss.label}>Phone Number</Text>
            <TextInput style={ss.input} value={phone} onChangeText={setPhone}
              placeholder="+971 50 123 4567" placeholderTextColor={C.faint}
              keyboardType="phone-pad" autoFocus />
            {!!error && <Text style={ss.errorTxt}>{error}</Text>}
            <TouchableOpacity activeOpacity={0.85} onPress={handleLogin}
              disabled={loading || phone.length < 8}
              style={[ss.btnPrimary, (loading || phone.length < 8) && { opacity: 0.5 }, { marginTop: 18 }]}>
              <Text style={ss.btnPrimaryTxt}>{loading ? 'Signing in...' : 'Continue'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

/* ═══════════════════ DASHBOARD ═══════════════════ */

const STATUS_META: Record<string, { bg: string; fg: string; label: string; icon: string }> = {
  draft: { bg: '#F1F0F3', fg: C.ink3, label: 'Draft', icon: 'edit-3' },
  confirmed: { bg: '#EFF6FF', fg: '#2563EB', label: 'Confirmed', icon: 'check' },
  survey_done: { bg: C.purpleLite, fg: C.purple, label: 'Survey Done', icon: 'clipboard' },
  in_progress: { bg: '#FFF7ED', fg: '#D97706', label: 'In Progress', icon: 'loader' },
  completed: { bg: '#ECFDF5', fg: '#059669', label: 'Completed', icon: 'check-circle' },
  invoiced: { bg: '#ECFDF5', fg: '#059669', label: 'Invoiced', icon: 'file-text' },
  cancelled: { bg: '#FEF2F2', fg: '#EF4444', label: 'Cancelled', icon: 'x-circle' },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] || STATUS_META.draft;
  return (
    <View style={{ backgroundColor: m.bg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Icon name={m.icon as any} size={11} color={m.fg} />
      <Text style={{ fontFamily: F.semi, fontSize: 11, color: m.fg }}>{m.label}</Text>
    </View>
  );
}

function fmtJobDate(d: string) {
  if (!d) return '';
  const dt = new Date(d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const jobDay = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const diff = Math.round((jobDay.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function getCountdown(scheduledDate: string, timeSlot?: string) {
  if (!scheduledDate) return null;
  const dt = new Date(scheduledDate);
  if (timeSlot) {
    const match = timeSlot.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (match) {
      let h = parseInt(match[1]);
      const m = parseInt(match[2]);
      if (match[3]?.toUpperCase() === 'PM' && h < 12) h += 12;
      if (match[3]?.toUpperCase() === 'AM' && h === 12) h = 0;
      dt.setHours(h, m, 0, 0);
    }
  }
  const now = new Date();
  const diffMs = dt.getTime() - now.getTime();
  if (diffMs <= 0) return null;
  const days = Math.floor(diffMs / 86400000);
  const hours = Math.floor((diffMs % 86400000) / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function JobCard({ job, onPress }: { job: any; onPress: () => void }) {
  const isActive = job.status === 'in_progress';
  const isUpcoming = job.status === 'confirmed';
  const countdown = getCountdown(job.scheduledDate, job.scheduledTimeSlot);
  return (
    <TouchableOpacity activeOpacity={0.8} onPress={onPress}
      style={[ss.jobCard, isActive && { borderColor: '#D97706', borderWidth: 1.5, backgroundColor: '#FFFBF5' }]}>
      {/* Top row */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: isActive ? '#FFF7ED' : C.purpleLite, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="package" size={18} color={isActive ? '#D97706' : C.purple} />
          </View>
          <View>
            <Text style={{ fontFamily: F.bold, fontSize: 14, color: C.ink }}>{job.jobNo}</Text>
            <Text style={{ fontFamily: F.reg, fontSize: 11, color: C.ink3 }}>{job.jobType?.replace(/_/g, ' ')}</Text>
          </View>
        </View>
        <StatusBadge status={job.status} />
      </View>

      {/* Customer & date */}
      <View style={{ marginTop: 12, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="user" size={13} color={C.ink3} />
          <Text style={{ fontFamily: F.med, fontSize: 13, color: C.ink }} numberOfLines={1}>
            {job.customer?.fullName || job.customerName || '—'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="calendar" size={13} color={C.ink3} />
          <Text style={{ fontFamily: F.med, fontSize: 12, color: C.purple }}>{fmtJobDate(job.scheduledDate)}</Text>
          {job.scheduledTimeSlot && (
            <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.ink3 }}>• {job.scheduledTimeSlot}</Text>
          )}
        </View>
        {countdown && isUpcoming && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <Icon name="clock" size={13} color="#D97706" />
            <Text style={{ fontFamily: F.semi, fontSize: 12, color: '#D97706' }}>Starts in {countdown}</Text>
          </View>
        )}
      </View>

      {/* Addresses */}
      <View style={{ marginTop: 10, backgroundColor: '#F8F7FA', borderRadius: 10, padding: 10, gap: 6 }}>
        {job.pickupAddress && (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#DCFCE7', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
              <Text style={{ fontSize: 8, fontFamily: F.bold, color: '#16A34A' }}>A</Text>
            </View>
            <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.ink2, flex: 1 }} numberOfLines={2}>{job.pickupAddress}</Text>
          </View>
        )}
        {job.deliveryAddress && (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
              <Text style={{ fontSize: 8, fontFamily: F.bold, color: '#DC2626' }}>B</Text>
            </View>
            <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.ink2, flex: 1 }} numberOfLines={2}>{job.deliveryAddress}</Text>
          </View>
        )}
      </View>

      {/* Footer chips */}
      <View style={{ flexDirection: 'row', marginTop: 10, gap: 10, flexWrap: 'wrap' }}>
        {job.crew?.length > 0 && (
          <View style={ss.chip}>
            <Icon name="users" size={12} color={C.ink3} />
            <Text style={ss.chipTxt}>{job.crew.length} crew</Text>
          </View>
        )}
        {job.trucks?.length > 0 && (
          <View style={ss.chip}>
            <Icon name="truck" size={12} color={C.ink3} />
            <Text style={ss.chipTxt}>{job.trucks.length} truck{job.trucks.length > 1 ? 's' : ''}</Text>
          </View>
        )}
        {job.images?.length > 0 && (
          <View style={ss.chip}>
            <Icon name="image" size={12} color={C.ink3} />
            <Text style={ss.chipTxt}>{job.images.length}</Text>
          </View>
        )}
        {job.moveOutPermitRequired && (
          <View style={[ss.chip, { backgroundColor: '#FEF3C7' }]}>
            <Icon name="alert-triangle" size={12} color="#D97706" />
            <Text style={[ss.chipTxt, { color: '#D97706' }]}>Permit</Text>
          </View>
        )}
      </View>

      {/* Action hint */}
      {isActive && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 8 }}>
          <Text style={{ fontFamily: F.semi, fontSize: 12, color: '#D97706' }}>Continue →</Text>
        </View>
      )}
      {isUpcoming && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 8 }}>
          <Text style={{ fontFamily: F.semi, fontSize: 12, color: C.purple }}>View Details →</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function DashboardScreen() {
  const { s, go } = useApp();
  const insets = useSafeAreaInsets();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const VISIBLE = ['confirmed', 'in_progress', 'completed'];

  const load = useCallback(async () => {
    try {
      const res = await api.getJobs();
      setJobs((res.jobs || []).filter(j => VISIBLE.includes(j.status)));
    } catch { setJobs([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  const active = jobs.filter(j => j.status === 'in_progress');
  const upcoming = jobs.filter(j => j.status === 'confirmed');
  const past = jobs.filter(j => j.status === 'completed');

  const firstName = s.worker?.name?.split(' ')[0] || '';

  return (
    <View style={[ss.fill, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={{ backgroundColor: C.ink, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Text style={{ fontFamily: F.display, fontSize: 24, color: C.white }}>
              Hi, {firstName} 👋
            </Text>
            <Text style={{ fontFamily: F.reg, fontSize: 13, color: 'rgba(255,255,255,0.55)', marginTop: 2, textTransform: 'capitalize' }}>
              {s.worker?.role} • {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}
            </Text>
          </View>
          <TouchableOpacity onPress={() => go('profile')}
            style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: F.bold, fontSize: 16, color: C.white }}>
              {s.worker?.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Stats row */}
        {!loading && (
          <View style={{ flexDirection: 'row', marginTop: 16, gap: 10 }}>
            <View style={ss.statBox}>
              <Text style={ss.statNum}>{active.length}</Text>
              <Text style={ss.statLabel}>Active</Text>
            </View>
            <View style={ss.statBox}>
              <Text style={ss.statNum}>{upcoming.length}</Text>
              <Text style={ss.statLabel}>Upcoming</Text>
            </View>
            <View style={ss.statBox}>
              <Text style={ss.statNum}>{past.length}</Text>
              <Text style={ss.statLabel}>Done</Text>
            </View>
            <View style={ss.statBox}>
              <Text style={ss.statNum}>{jobs.length}</Text>
              <Text style={ss.statLabel}>Total</Text>
            </View>
          </View>
        )}
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={C.purple} size="large" />
        </View>
      ) : jobs.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
          <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: C.purpleLite, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <Icon name="calendar" size={36} color={C.purple} />
          </View>
          <Text style={{ fontFamily: F.semi, fontSize: 17, color: C.ink }}>No jobs assigned</Text>
          <Text style={{ fontFamily: F.reg, fontSize: 14, color: C.ink3, marginTop: 6, textAlign: 'center' }}>
            Pull down to refresh when new jobs are assigned to you
          </Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.purple} />}>

          {/* Active jobs */}
          {active.length > 0 && (
            <View style={{ marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#D97706' }} />
                <Text style={ss.sectionTitle}>Active Jobs</Text>
              </View>
              {active.map(j => <JobCard key={j._id} job={j} onPress={() => go('jobDetail', j._id)} />)}
            </View>
          )}

          {/* Upcoming jobs */}
          {upcoming.length > 0 && (
            <View style={{ marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.purple }} />
                <Text style={ss.sectionTitle}>Upcoming</Text>
                <View style={{ backgroundColor: C.purpleLite, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 }}>
                  <Text style={{ fontFamily: F.semi, fontSize: 11, color: C.purple }}>{upcoming.length}</Text>
                </View>
              </View>
              {upcoming.map(j => <JobCard key={j._id} job={j} onPress={() => go('jobDetail', j._id)} />)}
            </View>
          )}

          {/* Past jobs */}
          {past.length > 0 && (
            <View style={{ marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.green }} />
                <Text style={ss.sectionTitle}>Completed</Text>
              </View>
              {past.map(j => <JobCard key={j._id} job={j} onPress={() => go('jobDetail', j._id)} />)}
            </View>
          )}
        </ScrollView>
      )}

      <TabBar active="jobs" />
    </View>
  );
}

/* ═══════════════════ JOB DETAIL ═══════════════════ */

function JobDetailScreen() {
  const { s, go } = useApp();
  const insets = useSafeAreaInsets();
  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [statusLoading, setStatusLoading] = useState(false);
  const [imageModal, setImageModal] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<'details' | 'images' | 'checklist' | 'photos'>('details');
  const [initialTabSet, setInitialTabSet] = useState(false);

  const load = useCallback(async () => {
    if (!s.selectedJobId) return;
    try {
      const res = await api.getJob(s.selectedJobId);
      setJob(res.job);
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setLoading(false); }
  }, [s.selectedJobId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (job && !initialTabSet) {
      if (job.status === 'in_progress') setActiveTab('photos');
      setInitialTabSet(true);
    }
  }, [job, initialTabSet]);

  const doStatusChange = async (newStatus: string) => {
    setStatusLoading(true);
    try {
      const res = await api.updateJobStatus(job._id, newStatus);
      setJob(res.job);
    } catch (e: any) {
      if (Platform.OS === 'web') window.alert(e.message);
      else Alert.alert('Error', e.message);
    }
    finally { setStatusLoading(false); }
  };

  const handleStatusChange = (newStatus: string) => {
    const msg = newStatus === 'in_progress' ? 'Start this job?' : 'Mark this job as completed?';
    if (Platform.OS === 'web') {
      doStatusChange(newStatus);
    } else {
      Alert.alert('Confirm', msg, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Yes', onPress: () => doStatusChange(newStatus) },
      ]);
    }
  };

  const handleUploadPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return;
    setUploading(true);
    try {
      const imgs = result.assets.map((a, i) => ({
        uri: a.uri, name: `crew-${Date.now()}-${i}.jpg`, type: a.mimeType || 'image/jpeg',
      }));
      await api.uploadPhotos(job._id, imgs);
      await load();
      Alert.alert('Uploaded', `${imgs.length} photo(s) uploaded`);
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setUploading(false); }
  };

  const handleTakePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Camera access is required'); return; }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (result.canceled || !result.assets?.length) return;
    setUploading(true);
    try {
      const a = result.assets[0];
      await api.uploadPhotos(job._id, [{ uri: a.uri, name: `crew-cam-${Date.now()}.jpg`, type: 'image/jpeg' }]);
      await load();
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setUploading(false); }
  };

  const handleChecklistToggle = async (idx: number) => {
    const items = [...(job.checklist || [])];
    items[idx] = { ...items[idx], done: !items[idx].done };
    setJob({ ...job, checklist: items });
    try { await api.updateChecklist(job._id, items); } catch {}
  };

  if (loading) {
    return <View style={[ss.fill, { justifyContent: 'center', alignItems: 'center' }]}><ActivityIndicator color={C.purple} size="large" /></View>;
  }
  if (!job) {
    return <View style={[ss.fill, { justifyContent: 'center', alignItems: 'center' }]}><Text style={{ fontFamily: F.semi, color: C.ink3 }}>Job not found</Text></View>;
  }

  const permitImages = (job.images || []).filter((img: any) => img.category?.toLowerCase().includes('permit'));
  const completionPhotos = job.completionPhotos || [];
  const canStart = job.status === 'confirmed' || job.status === 'survey_done';
  const canComplete = job.status === 'in_progress';
  const jobDate = job.scheduledDate ? fmtJobDate(job.scheduledDate) : '';

  const imgUrl = (img: any) => {
    if (!img?.url) return '';
    if (img.url.startsWith('http')) return img.url;
    return `https://purplebox.mypaperlessoffice.org${img.url}`;
  };

  const TABS = [
    { key: 'details' as const, label: 'Details', icon: 'info' },
    { key: 'images' as const, label: `Images (${(job.images || []).length})`, icon: 'image' },
    { key: 'checklist' as const, label: 'Checklist', icon: 'check-square' },
    { key: 'photos' as const, label: `Uploads (${completionPhotos.length})`, icon: 'camera' },
  ];

  return (
    <View style={[ss.fill, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 }}>
        <BackButton onPress={() => go('jobs')} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: F.bold, fontSize: 18, color: C.ink }}>{job.jobNo}</Text>
          <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.ink3 }}>{jobDate}{job.scheduledTimeSlot ? ` • ${job.scheduledTimeSlot}` : ''}</Text>
        </View>
        <StatusBadge status={job.status} />
      </View>

      {/* Action buttons */}
      {(canStart || canComplete) && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
          {canStart && (
            <TouchableOpacity activeOpacity={0.85} disabled={statusLoading}
              onPress={() => handleStatusChange('in_progress')}
              style={[ss.btnPrimary, { backgroundColor: '#059669' }, statusLoading && { opacity: 0.5 }]}>
              <Icon name="play" size={16} color={C.white} />
              <Text style={ss.btnPrimaryTxt}>{statusLoading ? 'Starting...' : 'Start Job'}</Text>
            </TouchableOpacity>
          )}
          {canComplete && (
            <TouchableOpacity activeOpacity={0.85} disabled={statusLoading}
              onPress={() => handleStatusChange('completed')}
              style={[ss.btnPrimary, statusLoading && { opacity: 0.5 }]}>
              <Icon name="check-circle" size={16} color={C.white} />
              <Text style={ss.btnPrimaryTxt}>{statusLoading ? 'Completing...' : 'Complete Job'}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Permit banner */}
      {job.moveOutPermitRequired && (
        <View style={{ marginHorizontal: 16, marginBottom: 8, backgroundColor: '#FEF3C7', borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon name="alert-triangle" size={18} color="#D97706" />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: F.semi, fontSize: 13, color: '#D97706' }}>Moving Permit Required</Text>
            <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.ink3, marginTop: 2 }}>
              {permitImages.length > 0 ? `${permitImages.length} permit image(s) — check Images tab` : 'No permit uploaded yet'}
            </Text>
          </View>
        </View>
      )}

      {/* Tabs */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, gap: 6, paddingBottom: 8, flexWrap: 'nowrap', overflow: 'hidden' }}>
        {TABS.map(t => (
          <TouchableOpacity key={t.key} activeOpacity={0.7} onPress={() => setActiveTab(t.key)}
            style={[ss.tabPill, activeTab === t.key && ss.tabPillOn]}>
            <Icon name={t.icon as any} size={13} color={activeTab === t.key ? C.white : C.ink3} />
            <Text style={[ss.tabPillTxt, activeTab === t.key && ss.tabPillTxtOn]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
        {activeTab === 'details' && <DetailsTab job={job} imgUrl={imgUrl} onImagePress={setImageModal} />}
        {activeTab === 'images' && <ImagesTab job={job} imgUrl={imgUrl} onImagePress={setImageModal} />}
        {activeTab === 'checklist' && <ChecklistTab job={job} onToggle={handleChecklistToggle} />}
        {activeTab === 'photos' && <PhotosTab completionPhotos={completionPhotos} imgUrl={imgUrl}
          onImagePress={setImageModal} onUpload={handleUploadPhoto} onCamera={handleTakePhoto} uploading={uploading} />}
      </ScrollView>

      {/* Floating upload button for in-progress jobs */}
      {job.status === 'in_progress' && activeTab !== 'photos' && (
        <TouchableOpacity activeOpacity={0.85} onPress={() => setActiveTab('photos')}
          style={{ position: 'absolute', bottom: 90, right: 20, flexDirection: 'row', alignItems: 'center', gap: 8,
            backgroundColor: C.purple, paddingHorizontal: 18, paddingVertical: 14, borderRadius: 16,
            shadowColor: C.purple, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 }}>
          <Icon name="camera" size={18} color={C.white} />
          <Text style={{ fontFamily: F.semi, fontSize: 14, color: C.white }}>Upload Photos</Text>
        </TouchableOpacity>
      )}

      {/* Image viewer */}
      <Modal visible={!!imageModal} transparent animationType="fade" onRequestClose={() => setImageModal(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => setImageModal(null)}
            style={{ position: 'absolute', top: insets.top + 16, right: 16, zIndex: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="x" size={24} color={C.white} />
          </TouchableOpacity>
          {imageModal && <Image source={{ uri: imageModal }} style={{ width: W - 32, height: W - 32, borderRadius: 12 }} resizeMode="contain" />}
        </View>
      </Modal>

      <TabBar active="jobs" />
    </View>
  );
}

/* ── Sub-tabs ── */

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  if (!value) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
      <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#F5F3F7', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon as any} size={14} color={C.ink3} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: F.reg, fontSize: 11, color: C.faint }}>{label}</Text>
        <Text style={{ fontFamily: F.med, fontSize: 13, color: C.ink, marginTop: 1 }}>{value}</Text>
      </View>
    </View>
  );
}

function DetailsTab({ job, imgUrl, onImagePress }: { job: any; imgUrl: (i: any) => string; onImagePress: (url: string) => void }) {
  const permitImages = (job.images || []).filter((img: any) => img.category?.toLowerCase().includes('permit'));

  return (
    <View style={{ gap: 12 }}>
      <View style={ss.card}>
        <Text style={ss.cardTitle}>Customer</Text>
        <InfoRow icon="user" label="Name" value={job.customer?.fullName || job.customerName || '—'} />
        <InfoRow icon="phone" label="Phone" value={job.customer?.phone || job.customerPhone || ''} />
        <InfoRow icon="briefcase" label="Job Type" value={job.jobType?.replace(/_/g, ' ')} />
      </View>

      <View style={ss.card}>
        <Text style={ss.cardTitle}>Addresses</Text>
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#DCFCE7', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 9, fontFamily: F.bold, color: '#16A34A' }}>A</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.reg, fontSize: 11, color: C.faint }}>Pickup</Text>
              <Text style={{ fontFamily: F.med, fontSize: 13, color: C.ink }}>{job.pickupAddress || '—'}</Text>
              {job.pickupFloor != null && <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.ink3 }}>Floor {job.pickupFloor} {job.pickupHasElevator ? '• Elevator' : '• No elevator'}</Text>}
            </View>
          </View>
          <View style={{ borderLeftWidth: 1.5, borderColor: C.line, marginLeft: 11, height: 10, borderStyle: 'dashed' }} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 9, fontFamily: F.bold, color: '#DC2626' }}>B</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.reg, fontSize: 11, color: C.faint }}>Delivery</Text>
              <Text style={{ fontFamily: F.med, fontSize: 13, color: C.ink }}>{job.deliveryAddress || '—'}</Text>
              {job.deliveryFloor != null && <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.ink3 }}>Floor {job.deliveryFloor} {job.deliveryHasElevator ? '• Elevator' : '• No elevator'}</Text>}
            </View>
          </View>
        </View>
      </View>

      {job.moveOutPermitRequired && (
        <View style={[ss.card, { borderColor: '#FCD34D', borderWidth: 1.5 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Icon name="file-text" size={16} color="#D97706" />
            <Text style={[ss.cardTitle, { marginBottom: 0, color: '#D97706' }]}>Moving Permit</Text>
          </View>
          {permitImages.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {permitImages.map((img: any, i: number) => (
                <TouchableOpacity key={i} onPress={() => onImagePress(imgUrl(img))}>
                  <Image source={{ uri: imgUrl(img) }} style={{ width: 120, height: 120, borderRadius: 10 }} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : (
            <Text style={{ fontFamily: F.reg, fontSize: 13, color: C.red }}>No permit images uploaded yet</Text>
          )}
        </View>
      )}

      {(job.dispatchNotes || job.routeNotes || job.notes) && (
        <View style={ss.card}>
          <Text style={ss.cardTitle}>Notes & Instructions</Text>
          {job.dispatchNotes && <InfoRow icon="clipboard" label="Dispatch" value={job.dispatchNotes} />}
          {job.routeNotes && <InfoRow icon="navigation" label="Route" value={job.routeNotes} />}
          {job.notes && <InfoRow icon="file-text" label="Notes" value={job.notes} />}
        </View>
      )}

      {job.crew?.length > 0 && (
        <View style={ss.card}>
          <Text style={ss.cardTitle}>Crew ({job.crew.length})</Text>
          {job.crew.map((c: any, i: number) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: C.purpleLite, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="user" size={14} color={C.purple} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: F.med, fontSize: 13, color: C.ink }}>{c.worker?.name || `Worker ${i + 1}`}</Text>
                <Text style={{ fontFamily: F.reg, fontSize: 11, color: C.ink3 }}>{c.role || 'Crew'}{c.isSupervisor ? ' • Supervisor' : ''}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {job.trucks?.length > 0 && (
        <View style={ss.card}>
          <Text style={ss.cardTitle}>Trucks ({job.trucks.length})</Text>
          {job.trucks.map((t: any, i: number) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: C.purpleLite, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="truck" size={14} color={C.purple} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: F.med, fontSize: 13, color: C.ink }}>{t.truck?.name || `Truck ${i + 1}`}</Text>
                <Text style={{ fontFamily: F.reg, fontSize: 11, color: C.ink3 }}>{t.truck?.plateNumber || ''}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function ImagesTab({ job, imgUrl, onImagePress }: { job: any; imgUrl: (i: any) => string; onImagePress: (url: string) => void }) {
  const allImages = job.images || [];
  if (allImages.length === 0) {
    return (
      <View style={{ alignItems: 'center', paddingTop: 60 }}>
        <Icon name="image" size={48} color={C.faint} />
        <Text style={{ fontFamily: F.semi, fontSize: 15, color: C.ink3, marginTop: 12 }}>No images yet</Text>
      </View>
    );
  }
  const grouped: Record<string, any[]> = {};
  allImages.forEach((img: any) => {
    const cat = img.category || 'General';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(img);
  });
  return (
    <View>
      {Object.entries(grouped).map(([cat, imgs]) => (
        <View key={cat} style={{ marginBottom: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Icon name={cat.toLowerCase().includes('permit') ? 'alert-triangle' : 'folder'} size={14}
              color={cat.toLowerCase().includes('permit') ? '#D97706' : C.ink3} />
            <Text style={{ fontFamily: F.semi, fontSize: 14, color: C.ink }}>{cat}</Text>
            <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.ink3 }}>({imgs.length})</Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {imgs.map((img: any, i: number) => (
              <TouchableOpacity key={i} onPress={() => onImagePress(imgUrl(img))}>
                <Image source={{ uri: imgUrl(img) }} style={{ width: (W - 56) / 3, height: (W - 56) / 3, borderRadius: 10, backgroundColor: C.line }} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function ChecklistTab({ job, onToggle }: { job: any; onToggle: (idx: number) => void }) {
  const items = job.checklist || [];
  const done = items.filter((i: any) => i.done).length;
  if (items.length === 0) {
    return (
      <View style={{ alignItems: 'center', paddingTop: 60 }}>
        <Icon name="check-square" size={48} color={C.faint} />
        <Text style={{ fontFamily: F.semi, fontSize: 15, color: C.ink3, marginTop: 12 }}>No checklist items</Text>
      </View>
    );
  }
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: C.line }}>
          <View style={{ width: `${(done / items.length) * 100}%` as any, height: 6, borderRadius: 3, backgroundColor: C.green }} />
        </View>
        <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.green }}>{done}/{items.length}</Text>
      </View>
      {items.map((item: any, idx: number) => (
        <TouchableOpacity key={idx} activeOpacity={0.7} onPress={() => onToggle(idx)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line }}>
          <View style={{
            width: 24, height: 24, borderRadius: 8, borderWidth: 2,
            borderColor: item.done ? C.green : C.faint,
            backgroundColor: item.done ? C.green : 'transparent',
            alignItems: 'center', justifyContent: 'center',
          }}>
            {item.done && <Icon name="check" size={14} color={C.white} />}
          </View>
          <Text style={{
            fontFamily: item.done ? F.reg : F.med, fontSize: 14,
            color: item.done ? C.ink3 : C.ink,
            textDecorationLine: item.done ? 'line-through' : 'none', flex: 1,
          }}>{item.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function PhotosTab({ completionPhotos, imgUrl, onImagePress, onUpload, onCamera, uploading }: {
  completionPhotos: any[]; imgUrl: (i: any) => string; onImagePress: (url: string) => void;
  onUpload: () => void; onCamera: () => void; uploading: boolean;
}) {
  return (
    <View>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
        <TouchableOpacity activeOpacity={0.85} onPress={onCamera} disabled={uploading}
          style={[ss.btnPrimary, { flex: 1 }, uploading && { opacity: 0.5 }]}>
          <Icon name="camera" size={16} color={C.white} />
          <Text style={ss.btnPrimaryTxt}>Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.85} onPress={onUpload} disabled={uploading}
          style={[ss.btnOutline, { flex: 1 }]}>
          <Icon name="upload" size={16} color={C.purple} />
          <Text style={ss.btnOutlineTxt}>Gallery</Text>
        </TouchableOpacity>
      </View>
      {uploading && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <ActivityIndicator size="small" color={C.purple} />
          <Text style={{ fontFamily: F.med, fontSize: 13, color: C.purple }}>Uploading...</Text>
        </View>
      )}
      {completionPhotos.length === 0 ? (
        <View style={{ alignItems: 'center', paddingTop: 40 }}>
          <Icon name="camera" size={48} color={C.faint} />
          <Text style={{ fontFamily: F.semi, fontSize: 15, color: C.ink3, marginTop: 12 }}>No photos uploaded yet</Text>
          <Text style={{ fontFamily: F.reg, fontSize: 13, color: C.faint, marginTop: 4 }}>Take or upload photos of the completed job</Text>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {completionPhotos.map((p: any, i: number) => (
            <TouchableOpacity key={i} onPress={() => onImagePress(imgUrl(p))}>
              <Image source={{ uri: imgUrl(p) }} style={{ width: (W - 56) / 3, height: (W - 56) / 3, borderRadius: 10, backgroundColor: C.line }} />
              {p.area && p.area !== 'General' && (
                <View style={{ position: 'absolute', bottom: 4, left: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 6, padding: 3 }}>
                  <Text style={{ fontFamily: F.med, fontSize: 9, color: C.white, textAlign: 'center' }}>{p.area}</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

/* ═══════════════════ PROFILE ═══════════════════ */

function ProfileScreen() {
  const { s, logout, go } = useApp();
  const insets = useSafeAreaInsets();
  const w = s.worker;
  const initials = w?.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';

  return (
    <View style={[ss.fill, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        <View style={{ backgroundColor: C.ink, padding: 24, paddingTop: 20, paddingBottom: 32, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }}>
          <Text style={{ fontFamily: F.display, fontSize: 22, color: C.white, marginBottom: 20 }}>Profile</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <View style={{ width: 60, height: 60, borderRadius: 20, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: F.bold, fontSize: 22, color: C.white }}>{initials}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.bold, fontSize: 18, color: C.white }}>{w?.name}</Text>
              <Text style={{ fontFamily: F.med, fontSize: 13, color: C.lavender, textTransform: 'capitalize' }}>{w?.role}</Text>
              <Text style={{ fontFamily: F.reg, fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>{w?.phone}</Text>
            </View>
          </View>
        </View>

        <View style={{ padding: 16, gap: 8, marginTop: 16 }}>
          <TouchableOpacity activeOpacity={0.7} onPress={() => go('jobs')} style={ss.menuRow}>
            <View style={[ss.menuIcon, { backgroundColor: C.purpleLite }]}><Icon name="calendar" size={18} color={C.purple} /></View>
            <Text style={ss.menuTxt}>My Jobs</Text>
            <Icon name="chevron-right" size={18} color={C.faint} />
          </TouchableOpacity>

          <View style={{ height: 24 }} />

          <TouchableOpacity activeOpacity={0.85} onPress={() => { setToken(null); logout(); }}
            style={{ height: 52, borderRadius: 14, backgroundColor: '#FEF2F2', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}>
            <Icon name="log-out" size={18} color={C.red} />
            <Text style={{ fontFamily: F.bold, fontSize: 15, color: C.red }}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <TabBar active="profile" />
    </View>
  );
}

/* ═══════════════════ STYLES ═══════════════════ */

const ss = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.paper },
  loginWrap: { paddingHorizontal: 28, alignItems: 'center' },
  label: { fontFamily: F.semi, fontSize: 13, color: C.ink2, marginBottom: 6 },
  input: { height: 54, borderRadius: 14, borderWidth: 1.5, borderColor: C.line, backgroundColor: C.white, paddingHorizontal: 16, fontFamily: F.reg, fontSize: 15, color: C.ink },
  errorTxt: { fontFamily: F.med, fontSize: 13, color: C.red, marginTop: 6 },
  btnPrimary: { height: 50, borderRadius: 14, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  btnPrimaryTxt: { color: C.white, fontFamily: F.bold, fontSize: 15 },
  btnOutline: { height: 50, borderRadius: 14, borderWidth: 1.5, borderColor: C.purple, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  btnOutlineTxt: { color: C.purple, fontFamily: F.bold, fontSize: 15 },

  sectionTitle: { fontFamily: F.semi, fontSize: 15, color: C.ink },

  jobCard: { backgroundColor: C.white, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.line, marginBottom: 10 },

  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F5F3F7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  chipTxt: { fontFamily: F.med, fontSize: 11, color: C.ink3 },

  statBox: { flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  statNum: { fontFamily: F.bold, fontSize: 20, color: C.white },
  statLabel: { fontFamily: F.reg, fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 2 },

  card: { backgroundColor: C.white, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.line },
  cardTitle: { fontFamily: F.semi, fontSize: 14, color: C.ink, marginBottom: 12 },

  tabPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: C.white, borderWidth: 1, borderColor: C.line },
  tabPillOn: { backgroundColor: C.purple, borderColor: C.purple },
  tabPillTxt: { fontFamily: F.med, fontSize: 12, color: C.ink3 },
  tabPillTxtOn: { color: C.white },

  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, backgroundColor: C.white, borderWidth: 1, borderColor: C.line },
  menuIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  menuTxt: { fontFamily: F.med, fontSize: 15, color: C.ink, flex: 1 },
});
