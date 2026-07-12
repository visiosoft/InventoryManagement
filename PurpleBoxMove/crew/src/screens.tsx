import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  FlatList, ActivityIndicator, Alert, RefreshControl, Image, Dimensions,
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
    case 'schedule': return <ScheduleScreen />;
    case 'jobDetail': return <JobDetailScreen />;
    case 'navigation': return <NavigationScreen />;
    case 'clockInOut': return <ClockScreen />;
    case 'photoProof': return <PhotoProofScreen />;
    case 'earnings': return <EarningsScreen />;
    case 'profile': return <ProfileScreen />;
    default: return <ScheduleScreen />;
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
    <View style={[ss.fill, { paddingTop: insets.top + 60 }]}>
      <View style={ss.loginWrap}>
        <View style={ss.logoCircle}>
          <Icon name="users" size={28} color={C.lavender} />
        </View>
        <Text style={ss.loginTitle}>Safa Crew</Text>
        <Text style={ss.loginSub}>For cleaning & moving staff</Text>
        <View style={{ marginTop: 40, width: '100%' }}>
          <Text style={ss.label}>Phone Number</Text>
          <TextInput style={ss.input} value={phone} onChangeText={setPhone}
            placeholder="+971 50 123 4567" placeholderTextColor={C.faint}
            keyboardType="phone-pad" autoFocus />
          {!!error && <Text style={ss.errorTxt}>{error}</Text>}
          <TouchableOpacity activeOpacity={0.85} onPress={handleLogin}
            disabled={loading || phone.length < 8}
            style={[ss.btnPrimary, (loading || phone.length < 8) && { opacity: 0.5 }, { marginTop: 16 }]}>
            <Text style={ss.btnPrimaryTxt}>{loading ? 'Signing in...' : 'Continue'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

/* ═══════════════════ TODAY'S SCHEDULE ═══════════════════ */
function ScheduleScreen() {
  const { s, go } = useApp();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [clockedIn, setClockedIn] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    api.getTodayJobs()
      .then(r => setJobs(r.jobs))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const completedJobs = jobs.filter(j => j.status === 'completed');
  const activeJob = jobs.find(j => j.status === 'in_progress');
  const upcomingJobs = jobs.filter(j => !['completed', 'in_progress'].includes(j.status));

  const name = s.worker?.name?.split(' ')[0] || 'Crew';
  const initial = s.worker?.name ? s.worker.name.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase() : 'CR';
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <View style={ss.fill}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 100 }}>
        {/* Header */}
        <View style={[ss.px, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
          <View>
            <Text style={{ fontFamily: F.med, fontSize: 13, color: C.ink3 }}>{dateStr}</Text>
            <Text style={{ fontFamily: F.display, fontSize: 24, color: C.ink, letterSpacing: -0.4 }}>Hi, {name}</Text>
          </View>
          <View style={ss.avatarCircle}>
            <Text style={{ fontSize: 18, fontFamily: F.display, color: C.purple }}>{initial}</Text>
          </View>
        </View>

        {/* Status bar */}
        <View style={ss.statusBar}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text style={ss.statusLabel}>Today's status</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <View style={[ss.statusDot, clockedIn && { backgroundColor: C.greenLight }]} />
                <Text style={{ fontSize: 15, fontFamily: F.bold, color: C.white }}>{clockedIn ? 'Clocked In' : 'Not Clocked In'}</Text>
              </View>
              {clockedIn && <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>Since 8:00 AM</Text>}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[ss.statusLabel, { textAlign: 'right' }]}>Jobs today</Text>
              <Text style={{ fontFamily: F.display, fontSize: 28, color: C.white, marginTop: 2 }}>{jobs.length}</Text>
            </View>
          </View>
          {/* Progress bars */}
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 14 }}>
            {jobs.map((j, i) => (
              <View key={i} style={[ss.progressSeg,
                j.status === 'completed' && { backgroundColor: C.green },
                j.status === 'in_progress' && { backgroundColor: C.lavender },
              ]} />
            ))}
            {jobs.length === 0 && <View style={[ss.progressSeg, { flex: 4 }]} />}
          </View>
          <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 6 }}>
            {completedJobs.length} completed · {activeJob ? 1 : 0} active · {upcomingJobs.length} upcoming
          </Text>
        </View>

        {/* Clock In/Out shortcut */}
        {!clockedIn && (
          <TouchableOpacity activeOpacity={0.85}
            onPress={async () => { try { await api.clockIn(); setClockedIn(true); } catch {} }}
            style={[ss.px, { marginBottom: 8 }]}>
            <View style={ss.clockInBtn}>
              <Icon name="clock" size={18} color={C.white} />
              <Text style={{ fontFamily: F.bold, fontSize: 14, color: C.white }}>Clock In</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Current Job */}
        {activeJob && (
          <View style={ss.px}>
            <Text style={ss.sectionLabel}>Current Job</Text>
            <TouchableOpacity activeOpacity={0.8} onPress={() => go('jobDetail', activeJob._id)} style={ss.currentJobCard}>
              <View style={ss.activeChip}><Text style={{ fontSize: 11, fontFamily: F.bold, color: C.green }}>In Progress</Text></View>
              <Text style={{ fontSize: 17, fontFamily: F.bold, color: C.ink }}>{activeJob.jobType?.replace(/_/g, ' ') || 'Moving Job'}</Text>
              <Text style={{ fontSize: 13, color: C.ink3, marginTop: 4 }}>{activeJob.clientName || 'Customer'}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 }}>
                <Icon name="clock" size={14} color={C.ink3} />
                <Text style={{ fontSize: 13, color: C.ink2 }}>
                  {activeJob.scheduledDate ? new Date(activeJob.scheduledDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'TBD'}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
                <Icon name="map-pin" size={14} color={C.ink3} />
                <Text style={{ fontSize: 13, color: C.ink2 }} numberOfLines={1}>{activeJob.pickupAddress || 'Address TBD'}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                <TouchableOpacity activeOpacity={0.85} onPress={() => go('jobDetail', activeJob._id)} style={[ss.btnPrimary, { flex: 1, borderRadius: 12, height: 48 }]}>
                  <Text style={ss.btnPrimaryTxt}>View Details</Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.7} onPress={() => go('navigation', activeJob._id)} style={ss.iconBtn}>
                  <Icon name="map-pin" size={20} color={C.purple} />
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.7} style={ss.iconBtn}>
                  <Icon name="phone" size={20} color={C.purple} />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* Upcoming */}
        {upcomingJobs.length > 0 && (
          <View style={ss.px}>
            <Text style={ss.sectionLabel}>Upcoming</Text>
            {upcomingJobs.map(j => (
              <TouchableOpacity key={j._id} activeOpacity={0.7} onPress={() => go('jobDetail', j._id)} style={ss.upcomingCard}>
                <View style={ss.upcomingBar} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontFamily: F.bold, color: C.ink }}>{j.jobType?.replace(/_/g, ' ') || 'Moving Job'}</Text>
                  <Text style={{ fontSize: 12, color: C.ink3, marginTop: 2 }}>
                    {j.clientName || 'Customer'} · {j.scheduledDate ? new Date(j.scheduledDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'TBD'} · {j.pickupAddress?.substring(0, 15) || ''}
                  </Text>
                </View>
                <Icon name="chevron-right" size={16} color={C.ink3} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Completed */}
        {completedJobs.length > 0 && (
          <View style={ss.px}>
            <Text style={ss.sectionLabel}>Completed</Text>
            {completedJobs.map(j => (
              <View key={j._id} style={[ss.upcomingCard, { opacity: 0.6 }]}>
                <View style={[ss.upcomingBar, { backgroundColor: C.green }]} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontFamily: F.bold, color: C.ink }}>{j.jobType?.replace(/_/g, ' ') || 'Job'}</Text>
                  <Text style={{ fontSize: 12, color: C.ink3, marginTop: 2 }}>{j.clientName || 'Customer'}</Text>
                </View>
                <View style={ss.completedChip}><Text style={{ fontSize: 10, fontFamily: F.bold, color: C.green }}>Done</Text></View>
              </View>
            ))}
          </View>
        )}

        {loading && <ActivityIndicator color={C.purple} style={{ marginTop: 40 }} />}

        {!loading && jobs.length === 0 && (
          <View style={{ alignItems: 'center', marginTop: 40 }}>
            <Icon name="calendar" size={48} color={C.faint} />
            <Text style={{ fontFamily: F.med, fontSize: 16, color: C.ink3, marginTop: 12 }}>No jobs scheduled today</Text>
          </View>
        )}
      </ScrollView>
      <TabBar active="schedule" />
    </View>
  );
}

/* ═══════════════════ JOB DETAIL / CHECKLIST ═══════════════════ */
function JobDetailScreen() {
  const { s, go } = useApp();
  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [checklist, setChecklist] = useState<{ label: string; done: boolean }[]>([]);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!s.selectedJobId) return;
    api.getJob(s.selectedJobId)
      .then(r => {
        setJob(r.job);
        if (r.job.checklist?.length) {
          setChecklist(r.job.checklist);
        } else {
          setChecklist([
            { label: 'Kitchen — counters, stovetop, sink', done: false },
            { label: 'Living room — vacuum, dust, mop', done: false },
            { label: 'Bedrooms — dust, vacuum, change linens', done: false },
            { label: 'Bathrooms — scrub, disinfect, mirrors', done: false },
            { label: 'Balcony — sweep, wipe railings', done: false },
            { label: 'Final walkthrough & photos', done: false },
          ]);
        }
      })
      .catch(() => Alert.alert('Error', 'Could not load job'))
      .finally(() => setLoading(false));
  }, [s.selectedJobId]);

  const toggleItem = (idx: number) => {
    const updated = checklist.map((c, i) => i === idx ? { ...c, done: !c.done } : c);
    setChecklist(updated);
    if (s.selectedJobId) api.updateChecklist(s.selectedJobId, updated).catch(() => {});
  };

  const doneCount = checklist.filter(c => c.done).length;
  const progress = checklist.length > 0 ? (doneCount / checklist.length) * 100 : 0;

  if (loading || !job) return (
    <View style={ss.fill}>
      <View style={[ss.topBar, { paddingTop: insets.top + 8 }]}>
        <BackButton onPress={() => go('schedule')} />
        <Text style={ss.topBarTitle}>Job Details</Text>
      </View>
      <ActivityIndicator color={C.purple} style={{ marginTop: 40 }} />
    </View>
  );

  return (
    <View style={ss.fill}>
      <View style={[ss.topBar, { paddingTop: insets.top + 8 }]}>
        <BackButton onPress={() => go(s.prevScreen as any || 'schedule')} />
        <Text style={ss.topBarTitle}>Job Details</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Job info card */}
        <View style={ss.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.display, fontSize: 18, color: C.ink }}>{job.jobType?.replace(/_/g, ' ') || 'Moving Job'}</Text>
              <Text style={{ fontSize: 13, color: C.ink3, marginTop: 4 }}>{job.propertyType || ''}</Text>
            </View>
            <View style={ss.activeChip}><Text style={{ fontSize: 11, fontFamily: F.bold, color: C.green }}>Active</Text></View>
          </View>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <View style={ss.infoBox}>
              <Text style={ss.infoLabel}>Customer</Text>
              <Text style={ss.infoValue}>{job.clientName || 'Customer'}</Text>
            </View>
            <View style={ss.infoBox}>
              <Text style={ss.infoLabel}>Time</Text>
              <Text style={ss.infoValue}>{job.scheduledDate ? new Date(job.scheduledDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'TBD'}</Text>
            </View>
          </View>
          <View style={[ss.infoBox, { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
            <Icon name="map-pin" size={14} color={C.purple} />
            <Text style={{ fontSize: 13, color: C.ink2 }}>{job.pickupAddress || 'Address TBD'}</Text>
          </View>
          {job.instructions && (
            <View style={ss.noteBox}>
              <Text style={{ fontSize: 13, color: C.ink3, fontStyle: 'italic' }}>💬 "{job.instructions}"</Text>
            </View>
          )}
        </View>

        {/* Checklist */}
        <View style={ss.px}>
          <Text style={{ fontFamily: F.bold, fontSize: 15, color: C.ink, marginBottom: 12 }}>Checklist</Text>
          <View style={ss.checklistCard}>
            {checklist.map((item, i) => {
              const isNext = !item.done && checklist.slice(0, i).every(c => c.done);
              return (
                <TouchableOpacity key={i} activeOpacity={0.7} onPress={() => toggleItem(i)}
                  style={[ss.checkItem, isNext && { backgroundColor: C.purpleLite }, i < checklist.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.line2 }]}>
                  <View style={[ss.checkbox, item.done && ss.checkboxDone, !item.done && !isNext && { borderColor: 'rgba(20,8,31,0.15)' }]}>
                    {item.done && <Icon name="check" size={14} color={C.white} />}
                  </View>
                  <Text style={[ss.checkLabel, item.done && ss.checkLabelDone, isNext && { fontFamily: F.semi, color: C.ink }]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Progress */}
        <View style={[ss.px, { marginTop: 16 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.ink2 }}>Progress</Text>
            <Text style={{ fontFamily: F.bold, fontSize: 13, color: C.purple }}>{doneCount} of {checklist.length}</Text>
          </View>
          <View style={ss.progressTrack}>
            <View style={[ss.progressFill, { width: `${progress}%` }]} />
          </View>
        </View>

        {/* Action buttons */}
        <View style={[ss.px, { flexDirection: 'row', gap: 10, marginTop: 20 }]}>
          <TouchableOpacity activeOpacity={0.85} onPress={() => go('photoProof', job._id)}
            style={[ss.btnPrimary, { flex: 1, borderRadius: 14 }]}>
            <Icon name="camera" size={16} color={C.white} />
            <Text style={ss.btnPrimaryTxt}>Take Photos</Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.85} onPress={() => go('navigation', job._id)}
            style={[ss.btnOutline, { flex: 1, borderRadius: 14 }]}>
            <Icon name="navigation" size={16} color={C.purple} />
            <Text style={ss.btnOutlineTxt}>Navigate</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <TabBar active="jobDetail" />
    </View>
  );
}

/* ═══════════════════ NAVIGATION ═══════════════════ */
function NavigationScreen() {
  const { s, go } = useApp();
  const [job, setJob] = useState<any>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!s.selectedJobId) return;
    api.getJob(s.selectedJobId)
      .then(r => setJob(r.job))
      .catch(() => {});
  }, [s.selectedJobId]);

  return (
    <View style={ss.fill}>
      {/* Map placeholder */}
      <View style={ss.mapArea}>
        <View style={[ss.mapBack, { top: insets.top + 8 }]}>
          <BackButton onPress={() => go(s.prevScreen as any || 'schedule')} />
        </View>
        {/* Roads */}
        <View style={{ position: 'absolute', top: 80, left: 30, right: 30, height: 2, backgroundColor: 'rgba(20,8,31,0.1)' }} />
        <View style={{ position: 'absolute', top: 160, left: 50, right: 50, height: 2, backgroundColor: 'rgba(20,8,31,0.1)' }} />
        <View style={{ position: 'absolute', top: 240, left: 20, right: 80, height: 2, backgroundColor: 'rgba(20,8,31,0.1)' }} />
        <View style={{ position: 'absolute', top: 100, left: 100, width: 2, height: 180, backgroundColor: 'rgba(20,8,31,0.1)' }} />
        <View style={{ position: 'absolute', top: 80, left: 220, width: 2, height: 160, backgroundColor: 'rgba(20,8,31,0.1)' }} />
        {/* My location dot */}
        <View style={ss.myLocationDot} />
        {/* Destination dot */}
        <View style={ss.destDot}>
          <Icon name="map-pin" size={14} color={C.red} />
        </View>
        {/* ETA badge */}
        <View style={ss.etaBadge}>
          <Text style={{ fontSize: 11, color: C.ink3, fontFamily: F.med }}>ETA</Text>
          <Text style={{ fontFamily: F.display, fontSize: 20, color: C.ink }}>8 min</Text>
        </View>
      </View>

      {/* Destination card */}
      <View style={ss.destCard}>
        <Text style={{ fontSize: 11, fontFamily: F.semi, textTransform: 'uppercase', letterSpacing: 0.8, color: C.purple, marginBottom: 8 }}>Next destination</Text>
        <Text style={{ fontSize: 17, fontFamily: F.bold, color: C.ink }}>{job?.pickupAddress || 'Loading address...'}</Text>
        <Text style={{ fontSize: 13, color: C.ink3, marginTop: 4 }}>{job?.clientName || ''} · {job?.jobType?.replace(/_/g, ' ') || ''}</Text>
        <TouchableOpacity activeOpacity={0.85} style={[ss.btnPrimary, { borderRadius: 12, marginTop: 16 }]}>
          <Icon name="navigation" size={18} color={C.white} />
          <Text style={ss.btnPrimaryTxt}>Start Navigation</Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="map" size={14} color={C.ink3} />
            <Text style={{ fontSize: 13, color: C.ink2 }}>3.2 km</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="clock" size={14} color={C.ink3} />
            <Text style={{ fontSize: 13, color: C.ink2 }}>8 min drive</Text>
          </View>
        </View>
      </View>

      {/* Arrived button */}
      <View style={[ss.px, { marginTop: 16, marginBottom: insets.bottom + 16 }]}>
        <TouchableOpacity activeOpacity={0.85} onPress={() => go('jobDetail', s.selectedJobId || undefined)}
          style={ss.arrivedBtn}>
          <Text style={{ fontFamily: F.bold, fontSize: 15, color: C.white }}>I've Arrived</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ═══════════════════ CLOCK IN/OUT ═══════════════════ */
function ClockScreen() {
  const { go } = useApp();
  const [clockedIn, setClockedIn] = useState(true);
  const [hours, setHours] = useState('6:15');
  const insets = useSafeAreaInsets();
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const handleClockOut = async () => {
    try { await api.clockOut(); setClockedIn(false); setHours('8:00'); } catch {}
  };

  return (
    <View style={ss.fill}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 20, paddingBottom: 100, alignItems: 'center' }}>
        <Text style={{ fontFamily: F.display, fontSize: 24, color: C.ink }}>Time Tracker</Text>
        <Text style={{ fontSize: 14, color: C.ink3, marginTop: 4 }}>{dateStr}</Text>

        {/* Big clock circle */}
        <View style={ss.bigClock}>
          <Text style={{ fontFamily: F.display, fontSize: 42, color: C.white, letterSpacing: -0.4 }}>{hours}</Text>
          <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>hours today</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: clockedIn ? C.greenLight : C.red }} />
            <Text style={{ fontSize: 12, fontFamily: F.semi, color: clockedIn ? C.greenLight : C.red }}>{clockedIn ? 'Active' : 'Off'}</Text>
          </View>
        </View>

        {/* Times */}
        <View style={{ width: W - 40, flexDirection: 'row', gap: 12, marginTop: 32 }}>
          <View style={ss.timeBox}>
            <Text style={ss.timeLabel}>Clock in</Text>
            <Text style={[ss.timeValue, { color: C.green }]}>8:00</Text>
            <Text style={ss.timeSuffix}>AM</Text>
          </View>
          <View style={ss.timeBox}>
            <Text style={ss.timeLabel}>Break</Text>
            <Text style={[ss.timeValue, { color: C.orangeDark }]}>0:45</Text>
            <Text style={ss.timeSuffix}>taken</Text>
          </View>
        </View>

        {/* Today's summary */}
        <View style={[ss.card, { width: W - 40, marginTop: 16, marginHorizontal: 0 }]}>
          <Text style={{ fontFamily: F.bold, fontSize: 13, color: C.ink, marginBottom: 10 }}>Today's Summary</Text>
          {[
            { label: 'Jobs completed', value: '2' },
            { label: 'Jobs remaining', value: '2' },
            { label: 'Est. finish', value: '7:30 PM' },
          ].map((row, i) => (
            <View key={i} style={[ss.summaryRow, i < 2 && { borderBottomWidth: 1, borderBottomColor: C.line2 }]}>
              <Text style={{ fontSize: 13, color: C.ink3 }}>{row.label}</Text>
              <Text style={{ fontSize: 13, fontFamily: F.semi, color: C.ink }}>{row.value}</Text>
            </View>
          ))}
        </View>

        {/* Clock out button */}
        {clockedIn && (
          <TouchableOpacity activeOpacity={0.85} onPress={handleClockOut}
            style={[ss.clockOutBtn, { width: W - 40 }]}>
            <Text style={{ fontFamily: F.bold, fontSize: 15, color: C.white }}>Clock Out</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
      <TabBar active="schedule" />
    </View>
  );
}

/* ═══════════════════ PHOTO PROOF ═══════════════════ */
const PHOTO_AREAS = ['Kitchen', 'Living Room', 'Bedrooms', 'Bathrooms', 'Balcony', 'Overall'];

function PhotoProofScreen() {
  const { s, go } = useApp();
  const [photos, setPhotos] = useState<Record<string, string | null>>(
    Object.fromEntries(PHOTO_AREAS.map(a => [a, null]))
  );
  const insets = useSafeAreaInsets();

  const takePhoto = async (area: string) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7,
    });
    if (result.canceled) return;
    const uri = result.assets[0].uri;
    setPhotos(prev => ({ ...prev, [area]: uri }));
    if (s.selectedJobId) {
      api.uploadPhotos(s.selectedJobId, [{ uri, name: `${area}.jpg`, type: 'image/jpeg' }], area).catch(() => {});
    }
  };

  const doneCount = Object.values(photos).filter(Boolean).length;
  const allDone = doneCount === PHOTO_AREAS.length;

  return (
    <View style={ss.fill}>
      <View style={[ss.topBar, { paddingTop: insets.top + 8 }]}>
        <BackButton onPress={() => go(s.prevScreen as any || 'jobDetail')} />
        <Text style={ss.topBarTitle}>Completion Photos</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Text style={{ fontSize: 14, color: C.ink3, marginBottom: 16 }}>Take photos of each completed area to confirm the job is done.</Text>

        {/* Photo grid */}
        <View style={ss.photoGrid}>
          {PHOTO_AREAS.map((area, i) => {
            const photo = photos[area];
            const isDone = !!photo;
            const isNext = !isDone && Object.values(photos).filter(Boolean).length === i;
            return (
              <TouchableOpacity key={area} activeOpacity={0.8} onPress={() => takePhoto(area)}
                style={[ss.photoCell,
                  isDone && { backgroundColor: C.greenBg },
                  isNext && { backgroundColor: C.purpleLite, borderColor: '#DDD0FF', borderWidth: 2, borderStyle: 'dashed' },
                  !isDone && !isNext && { backgroundColor: C.warmGray, borderColor: 'rgba(20,8,31,0.12)', borderWidth: 2, borderStyle: 'dashed' },
                ]}>
                {isDone && (
                  <>
                    <View style={ss.photoDoneCheck}><Icon name="check" size={12} color={C.white} /></View>
                    {photo && <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} resizeMode="cover" />}
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(5,150,105,0.15)' }]} />
                  </>
                )}
                {!isDone && <Icon name="camera" size={isNext ? 32 : 28} color={isNext ? C.purple : C.ink3} />}
                <Text style={[ss.photoCellLabel,
                  isDone && { color: C.green },
                  isNext && { color: C.purple, fontFamily: F.semi },
                ]}>
                  {isDone ? `${area} ✓` : area}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16 }}>
          <Icon name="info" size={14} color={C.purple} />
          <Text style={{ fontSize: 13, color: C.ink2 }}>{doneCount} of {PHOTO_AREAS.length} areas photographed</Text>
        </View>

        <TouchableOpacity activeOpacity={0.85} disabled={!allDone}
          onPress={() => { Alert.alert('Job Complete', 'Photos submitted successfully!'); go('schedule'); }}
          style={[ss.completeBtn, !allDone && { opacity: 0.4 }]}>
          <Text style={{ fontFamily: F.bold, fontSize: 15, color: C.white }}>
            {allDone ? 'Complete Job' : `Complete Job (${PHOTO_AREAS.length - doneCount} photos remaining)`}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

/* ═══════════════════ EARNINGS ═══════════════════ */
function EarningsScreen() {
  const { go } = useApp();
  const [period, setPeriod] = useState<'Today' | 'This Week' | 'Month'>('This Week');
  const [earnings, setEarnings] = useState({ totalEarnings: 0, jobCount: 0 });
  const insets = useSafeAreaInsets();

  useEffect(() => {
    api.getEarnings().then(setEarnings).catch(() => {});
  }, []);

  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const HEIGHTS = [50, 70, 60, 85, 30, 30, 30];
  const todayIdx = 3;

  return (
    <View style={ss.fill}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 100 }}>
        <View style={ss.px}>
          <Text style={{ fontFamily: F.display, fontSize: 28, color: C.ink, letterSpacing: -0.4 }}>Earnings</Text>
        </View>

        {/* Period toggle */}
        <View style={ss.periodToggle}>
          {(['Today', 'This Week', 'Month'] as const).map(p => (
            <TouchableOpacity key={p} onPress={() => setPeriod(p)}
              style={[ss.periodBtn, period === p && ss.periodBtnOn]}>
              <Text style={[ss.periodTxt, period === p && ss.periodTxtOn]}>{p}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Big number */}
        <View style={{ alignItems: 'center', paddingVertical: 8 }}>
          <Text style={{ fontSize: 13, color: C.ink3, fontFamily: F.med }}>This week's earnings</Text>
          <Text style={{ fontFamily: F.display, fontSize: 48, color: C.ink, letterSpacing: -0.4, marginTop: 4 }}>
            AED {earnings.totalEarnings > 0 ? earnings.totalEarnings.toLocaleString() : '2,840'}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
            <Text style={{ fontSize: 13, fontFamily: F.semi, color: C.green }}>↑ 18%</Text>
            <Text style={{ fontSize: 13, color: C.ink3 }}>vs last week</Text>
          </View>
        </View>

        {/* Bar chart */}
        <View style={ss.barChart}>
          {DAYS.map((d, i) => (
            <View key={d} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
              <View style={[ss.bar, { height: HEIGHTS[i] }, i === todayIdx && { backgroundColor: C.purple }, i > todayIdx && { backgroundColor: C.warmGray }]} />
              <Text style={[ss.barLabel, i === todayIdx && { fontFamily: F.semi, color: C.purple }]}>{d}</Text>
            </View>
          ))}
        </View>

        {/* Breakdown */}
        <View style={ss.px}>
          <Text style={{ fontFamily: F.bold, fontSize: 15, color: C.ink, marginBottom: 12 }}>Breakdown</Text>
          <View style={ss.breakdownCard}>
            {[
              { dot: C.purple, label: `Base pay (${earnings.jobCount || 12} jobs)`, amount: 'AED 2,400' },
              { dot: C.green, label: 'Tips', amount: 'AED 340' },
              { dot: C.orange, label: 'Bonus', amount: 'AED 100' },
            ].map((item, i) => (
              <View key={i} style={[ss.breakdownRow, i < 2 && { borderBottomWidth: 1, borderBottomColor: C.line2 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: item.dot }} />
                  <Text style={{ fontSize: 14, color: C.ink2 }}>{item.label}</Text>
                </View>
                <Text style={{ fontSize: 14, fontFamily: F.semi, color: C.ink }}>{item.amount}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
      <TabBar active="earnings" />
    </View>
  );
}

/* ═══════════════════ PROFILE ═══════════════════ */
function ProfileScreen() {
  const { s, go, logout } = useApp();
  const [lang, setLang] = useState<'EN' | 'AR'>('EN');
  const insets = useSafeAreaInsets();

  const name = s.worker?.name || 'Crew Member';
  const initial = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  const role = s.worker?.role ? s.worker.role.charAt(0).toUpperCase() + s.worker.role.slice(1) : 'Staff';

  const MENU = [
    { icon: 'calendar', label: 'My Schedule', bg: C.purpleLite, color: C.purple },
    { icon: 'dollar-sign', label: 'Earnings History', bg: C.greenBg, color: C.green },
    { icon: 'star', label: 'My Reviews', bg: '#FFFBEB', color: C.orange },
    { icon: 'settings', label: 'Settings', bg: C.warmGray, color: C.ink3 },
  ];

  return (
    <View style={ss.fill}>
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Header gradient */}
        <View style={ss.profileHeader}>
          <View style={ss.profileAvatar}>
            <Text style={{ fontFamily: F.display, fontSize: 32, color: C.purple }}>{initial}</Text>
          </View>
          <Text style={{ fontFamily: F.display, fontSize: 22, color: C.white, marginTop: 12 }}>{name}</Text>
          <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>{role}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Icon key={i} name="star" size={16} color={C.orange} />
            ))}
            <Text style={{ fontSize: 14, fontFamily: F.semi, color: C.white, marginLeft: 4 }}>4.9</Text>
          </View>
        </View>

        {/* Stats card */}
        <View style={ss.statsCard}>
          {[
            { num: '234', label: 'Total Jobs' },
            { num: '98%', label: 'On Time' },
            { num: '14', label: 'Months' },
          ].map((stat, i) => (
            <View key={i} style={[ss.statCell, i === 1 && { borderLeftWidth: 1, borderRightWidth: 1, borderColor: C.line }]}>
              <Text style={{ fontFamily: F.display, fontSize: 24, color: C.ink }}>{stat.num}</Text>
              <Text style={{ fontSize: 11, color: C.ink3, marginTop: 2 }}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {/* Menu */}
        <View style={[ss.px, { marginTop: 20 }]}>
          <View style={ss.menuCard}>
            {MENU.map((item, i) => (
              <TouchableOpacity key={i} activeOpacity={0.7}
                onPress={() => {
                  if (item.label === 'My Schedule') go('schedule');
                  else if (item.label === 'Earnings History') go('earnings');
                }}
                style={[ss.menuRow, i > 0 && { borderTopWidth: 1, borderTopColor: C.line2 }]}>
                <View style={[ss.menuIcon, { backgroundColor: item.bg }]}>
                  <Icon name={item.icon as any} size={16} color={item.color} />
                </View>
                <Text style={{ flex: 1, fontSize: 14, fontFamily: F.med, color: C.ink }}>{item.label}</Text>
                <Icon name="chevron-right" size={14} color={C.ink3} />
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Language */}
        <View style={[ss.px, { marginTop: 16 }]}>
          <View style={ss.langCard}>
            <Text style={{ fontSize: 16 }}>🌐</Text>
            <Text style={{ flex: 1, fontSize: 14, fontFamily: F.med, color: C.ink }}>Language</Text>
            <View style={ss.langToggle}>
              <TouchableOpacity onPress={() => setLang('EN')} style={[ss.langBtn, lang === 'EN' && ss.langBtnOn]}>
                <Text style={[ss.langBtnTxt, lang === 'EN' && ss.langBtnTxtOn]}>EN</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setLang('AR')} style={[ss.langBtn, lang === 'AR' && ss.langBtnOn]}>
                <Text style={[ss.langBtnTxt, lang === 'AR' && ss.langBtnTxtOn]}>عربي</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Sign out */}
        <View style={[ss.px, { marginTop: 20 }]}>
          <TouchableOpacity activeOpacity={0.8} onPress={() => { setToken(null); logout(); }} style={ss.signOutBtn}>
            <Text style={{ fontFamily: F.semi, fontSize: 14, color: C.red }}>Sign Out</Text>
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
  px: { paddingHorizontal: 20 },

  // Login
  loginWrap: { paddingHorizontal: 28, alignItems: 'center' },
  logoCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  loginTitle: { fontFamily: F.displayXB, fontSize: 28, color: C.ink },
  loginSub: { fontFamily: F.reg, fontSize: 15, color: C.ink3, marginTop: 6 },
  label: { fontFamily: F.semi, fontSize: 13, color: C.ink2, marginBottom: 6 },
  input: { height: 52, borderRadius: 14, borderWidth: 1.5, borderColor: C.line, backgroundColor: C.white, paddingHorizontal: 16, fontFamily: F.reg, fontSize: 15, color: C.ink },
  errorTxt: { fontFamily: F.med, fontSize: 13, color: C.red, marginTop: 6 },

  // Buttons
  btnPrimary: { height: 52, borderRadius: 14, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  btnPrimaryTxt: { color: C.white, fontFamily: F.bold, fontSize: 15 },
  btnOutline: { height: 48, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(91,43,201,0.2)', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  btnOutlineTxt: { color: C.purple, fontFamily: F.semi, fontSize: 14 },
  iconBtn: { width: 48, height: 48, borderRadius: 12, backgroundColor: C.purpleLite, alignItems: 'center', justifyContent: 'center' },

  // Avatar
  avatarCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.purpleBg, alignItems: 'center', justifyContent: 'center' },

  // Schedule
  statusBar: { marginHorizontal: 20, marginTop: 16, borderRadius: 16, padding: 16, paddingHorizontal: 18, backgroundColor: C.ink, overflow: 'hidden' },
  statusLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8, color: 'rgba(255,255,255,0.6)', fontFamily: F.semi },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)' },
  progressSeg: { flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.15)' },
  sectionLabel: { fontFamily: F.bold, fontSize: 13, color: C.green, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10, marginTop: 20 },
  clockInBtn: { backgroundColor: C.green, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16 },

  currentJobCard: { backgroundColor: C.white, borderWidth: 2, borderColor: C.purple, borderRadius: 18, padding: 18 },
  activeChip: { position: 'absolute', top: 14, right: 14, backgroundColor: C.greenBg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  upcomingCard: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 14, flexDirection: 'row', gap: 14, alignItems: 'center', marginBottom: 10 },
  upcomingBar: { width: 4, height: 44, borderRadius: 2, backgroundColor: C.purpleBg },
  completedChip: { backgroundColor: C.greenBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },

  // Top bar
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 12 },
  topBarTitle: { fontFamily: F.bold, fontSize: 17, color: C.ink },

  // Job Detail
  card: { marginHorizontal: 20, marginBottom: 16, backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 18, padding: 18 },
  infoBox: { flex: 1, backgroundColor: C.paper, borderRadius: 10, padding: 10 },
  infoLabel: { fontSize: 11, color: C.ink3 },
  infoValue: { fontSize: 14, fontFamily: F.semi, color: C.ink, marginTop: 2 },
  noteBox: { marginTop: 10, padding: 10, backgroundColor: '#FFFBEB', borderRadius: 10 },

  // Checklist
  checklistCard: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 16, overflow: 'hidden' },
  checkItem: { padding: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkbox: { width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: C.purple, alignItems: 'center', justifyContent: 'center' },
  checkboxDone: { backgroundColor: C.purple, borderColor: C.purple },
  checkLabel: { fontSize: 14, fontFamily: F.med, color: C.ink2, flex: 1 },
  checkLabelDone: { color: C.ink3, textDecorationLine: 'line-through' },

  progressTrack: { height: 8, borderRadius: 4, backgroundColor: C.warmGray, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4, backgroundColor: C.purple },

  // Navigation
  mapArea: { height: 380, backgroundColor: '#E8E4DC' },
  mapBack: { position: 'absolute', left: 16, zIndex: 10 },
  myLocationDot: { position: 'absolute', top: 120, left: 90, width: 28, height: 28, borderRadius: 14, backgroundColor: C.purple, borderWidth: 3, borderColor: C.white },
  destDot: { position: 'absolute', top: 280, right: 60, width: 32, height: 32, borderRadius: 16, backgroundColor: C.white, borderWidth: 3, borderColor: C.red, alignItems: 'center', justifyContent: 'center' },
  etaBadge: { position: 'absolute', top: 12, right: 16, backgroundColor: C.white, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, elevation: 4, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10 },
  destCard: { marginHorizontal: 20, marginTop: -30, backgroundColor: C.white, borderRadius: 20, padding: 20, elevation: 8, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 20, zIndex: 2 },
  arrivedBtn: { backgroundColor: C.ink, borderRadius: 14, padding: 16, alignItems: 'center' },

  // Clock
  bigClock: { marginTop: 32, width: 200, height: 200, borderRadius: 100, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center', shadowColor: C.ink, shadowOpacity: 0.25, shadowRadius: 20, elevation: 8 },
  timeBox: { flex: 1, backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 16, alignItems: 'center' },
  timeLabel: { fontSize: 11, color: C.ink3, textTransform: 'uppercase', letterSpacing: 0.8, fontFamily: F.semi },
  timeValue: { fontFamily: F.display, fontSize: 24, marginTop: 4 },
  timeSuffix: { fontSize: 12, color: C.ink3 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  clockOutBtn: { marginTop: 20, backgroundColor: C.red, borderRadius: 14, padding: 16, alignItems: 'center' },

  // Photos
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoCell: { width: (W - 50) / 2, aspectRatio: 1, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 6, overflow: 'hidden' },
  photoDoneCheck: { position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 12, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  photoCellLabel: { fontSize: 11, fontFamily: F.med, color: C.ink3, zIndex: 2 },
  completeBtn: { marginTop: 20, backgroundColor: C.green, borderRadius: 14, padding: 16, alignItems: 'center' },

  // Earnings
  periodToggle: { flexDirection: 'row', marginHorizontal: 20, marginTop: 12, backgroundColor: C.warmGray, borderRadius: 12, padding: 3 },
  periodBtn: { flex: 1, padding: 8, borderRadius: 10, alignItems: 'center' },
  periodBtnOn: { backgroundColor: C.white, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 3, elevation: 1 },
  periodTxt: { fontSize: 13, fontFamily: F.med, color: C.ink3 },
  periodTxtOn: { fontFamily: F.semi, color: C.ink },
  barChart: { paddingHorizontal: 20, flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 120, marginTop: 24 },
  bar: { width: '100%', borderTopLeftRadius: 8, borderTopRightRadius: 8, backgroundColor: C.purpleBg },
  barLabel: { fontSize: 10, color: C.ink3 },
  breakdownCard: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 16, overflow: 'hidden' },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, paddingHorizontal: 16 },

  // Profile
  profileHeader: { backgroundColor: C.ink, paddingTop: 52, paddingBottom: 40, alignItems: 'center' },
  profileAvatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: C.purpleBg, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: 'rgba(255,255,255,0.2)' },
  statsCard: { marginHorizontal: 20, marginTop: -20, backgroundColor: C.white, borderRadius: 18, padding: 18, flexDirection: 'row', elevation: 4, shadowColor: C.ink, shadowOpacity: 0.08, shadowRadius: 12 },
  statCell: { flex: 1, alignItems: 'center' },
  menuCard: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 16, overflow: 'hidden' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, paddingHorizontal: 16 },
  menuIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  langCard: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  langToggle: { flexDirection: 'row', gap: 4, backgroundColor: C.warmGray, borderRadius: 8, padding: 2 },
  langBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  langBtnOn: { backgroundColor: C.white, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 3, elevation: 1 },
  langBtnTxt: { fontSize: 12, fontFamily: F.med, color: C.ink3 },
  langBtnTxtOn: { fontFamily: F.semi, color: C.ink },
  signOutBtn: { padding: 14, borderRadius: 14, backgroundColor: C.redBg, borderWidth: 1, borderColor: 'rgba(239,68,68,0.12)', alignItems: 'center' },
});
