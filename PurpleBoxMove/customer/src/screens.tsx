import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  FlatList, ActivityIndicator, Alert, RefreshControl, Image,
  KeyboardAvoidingView, Platform, Dimensions,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, Icon, TabBar, BackButton, useApp } from './core';
import { api, setToken } from './api';

WebBrowser.maybeCompleteAuthSession();

const W = Dimensions.get('window').width;

export function Router() {
  const { s } = useApp();
  switch (s.screen) {
    case 'login': return <LoginScreen />;
    case 'phoneSetup': return <PhoneSetupScreen />;
    case 'home': return <HomeScreen />;
    case 'booking': return <BookingScreen />;
    case 'quote': return <QuoteScreen />;
    case 'tracking': return <TrackingScreen />;
    case 'history': return <HistoryScreen />;
    case 'profile': return <ProfileScreen />;
    case 'moveDetail': return <MoveDetailScreen />;
    default: return <HomeScreen />;
  }
}

/* ═══════════════════ LOGIN ═══════════════════ */
const GOOGLE_CLIENT_ID = '249289984785-625vj3md7p6hdtvuh8u678boidul9bul.apps.googleusercontent.com';

function LoginScreen() {
  const { login, go } = useApp();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [gLoading, setGLoading] = useState(false);
  const [error, setError] = useState('');
  const insets = useSafeAreaInsets();

  const [request, response, promptAsync] = Google.useAuthRequest({
    clientId: GOOGLE_CLIENT_ID,
    webClientId: GOOGLE_CLIENT_ID,
  });

  useEffect(() => {
    if (response?.type === 'success') {
      const accessToken = response.authentication?.accessToken;
      if (accessToken) handleGoogleLogin(accessToken);
    }
  }, [response]);

  const handleGoogleLogin = async (accessToken: string) => {
    setGLoading(true); setError('');
    try {
      const res = await api.googleAuth(accessToken);
      setToken(res.token);
      if (res.needsPhone) {
        login({ id: res.customer.id, fullName: res.customer.fullName, phone: '', email: res.customer.email || '' }, res.token);
        go('phoneSetup');
      } else {
        login({ id: res.customer.id, fullName: res.customer.fullName, phone: res.customer.phone, email: res.customer.email || '' }, res.token);
      }
    } catch (e: any) { setError(e.message); }
    finally { setGLoading(false); }
  };

  const handleLogin = async () => {
    if (phone.length < 8) { setError('Enter a valid phone number'); return; }
    setLoading(true); setError('');
    try {
      const otpRes = await api.requestOtp(phone);
      const res = await api.verifyOtp(phone, otpRes.code);
      setToken(res.token);
      login({ id: res.customer.id, fullName: res.customer.fullName, phone: res.customer.phone, email: res.customer.email || '' }, res.token);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <View style={[ss.fill, { paddingTop: insets.top + 60 }]}>
      <View style={ss.loginWrap}>
        <View style={ss.logoCircle}><Icon name="truck" size={32} color={C.white} /></View>
        <Text style={ss.loginTitle}>PurpleBox</Text>
        <Text style={ss.loginSub}>Moving made simple</Text>

        {/* Google Sign-In */}
        <TouchableOpacity activeOpacity={0.85}
          disabled={!request || gLoading}
          onPress={() => promptAsync()}
          style={[ss.googleBtn, (!request || gLoading) && { opacity: 0.5 }, { marginTop: 36 }]}>
          <Text style={{ fontSize: 20 }}>G</Text>
          <Text style={ss.googleBtnTxt}>{gLoading ? 'Signing in...' : 'Continue with Google'}</Text>
        </TouchableOpacity>

        {/* Divider */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 24, marginBottom: 24, width: '100%' }}>
          <View style={{ flex: 1, height: 1, backgroundColor: C.line }} />
          <Text style={{ marginHorizontal: 14, fontFamily: F.reg, fontSize: 12, color: C.ink3 }}>or</Text>
          <View style={{ flex: 1, height: 1, backgroundColor: C.line }} />
        </View>

        {/* Phone login */}
        <View style={{ width: '100%' }}>
          <Text style={ss.label}>Phone Number</Text>
          <TextInput style={ss.input} value={phone} onChangeText={setPhone}
            placeholder="+971 50 123 4567" placeholderTextColor={C.faint}
            keyboardType="phone-pad" />
          {!!error && <Text style={ss.errorTxt}>{error}</Text>}
          <TouchableOpacity activeOpacity={0.85} onPress={handleLogin}
            disabled={loading || phone.length < 8}
            style={[ss.btnPrimary, (loading || phone.length < 8) && { opacity: 0.5 }, { marginTop: 16 }]}>
            <Text style={ss.btnPrimaryTxt}>{loading ? 'Signing in...' : 'Continue with Phone'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

/* ═══════════════════ PHONE SETUP (one-time after Google sign-in) ═══════════════════ */
function PhoneSetupScreen() {
  const { s, login } = useApp();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const insets = useSafeAreaInsets();

  const handleSave = async () => {
    if (phone.length < 8) { setError('Enter a valid phone number'); return; }
    setLoading(true); setError('');
    try {
      const res = await api.setPhone(phone);
      setToken(res.token);
      login({ id: res.customer.id, fullName: res.customer.fullName, phone: res.customer.phone, email: res.customer.email || '' }, res.token);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <View style={[ss.fill, { paddingTop: insets.top + 60 }]}>
      <View style={ss.loginWrap}>
        <View style={ss.logoCircle}><Icon name="phone" size={28} color={C.white} /></View>
        <Text style={ss.loginTitle}>Almost there!</Text>
        <Text style={[ss.loginSub, { textAlign: 'center' }]}>
          Welcome{s.customer?.fullName ? `, ${s.customer.fullName.split(' ')[0]}` : ''}! We need your phone number to keep you updated on your moves.
        </Text>
        <View style={{ marginTop: 32, width: '100%' }}>
          <Text style={ss.label}>Phone Number</Text>
          <TextInput style={ss.input} value={phone} onChangeText={setPhone}
            placeholder="+971 50 123 4567" placeholderTextColor={C.faint}
            keyboardType="phone-pad" autoFocus />
          {!!error && <Text style={ss.errorTxt}>{error}</Text>}
          <TouchableOpacity activeOpacity={0.85} onPress={handleSave}
            disabled={loading || phone.length < 8}
            style={[ss.btnPrimary, (loading || phone.length < 8) && { opacity: 0.5 }, { marginTop: 16 }]}>
            <Text style={ss.btnPrimaryTxt}>{loading ? 'Saving...' : 'Continue'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

/* ═══════════════════ HOME ═══════════════════ */
const SERVICES = [
  { icon: '🏠', label: 'Home\nShifting' },
  { icon: '🏢', label: 'Office\nMoving' },
  { icon: '📦', label: 'Packing\nOnly' },
  { icon: '🛋', label: 'Single\nItems' },
  { icon: '📦', label: 'Storage' },
  { icon: '🚚', label: 'Furniture\nDelivery' },
];

function HomeScreen() {
  const { s, go, selectService } = useApp();
  const [moves, setMoves] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const insets = useSafeAreaInsets();

  const loadMoves = useCallback(() => {
    return api.getMoves()
      .then(r => {
        const all = [
          ...r.jobs.map((j: any) => ({ ...j, _t: 'job' })),
          ...r.leads.map((l: any) => ({ ...l, _t: 'lead' })),
        ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setMoves(all);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadMoves().finally(() => setLoading(false));
    const interval = setInterval(loadMoves, 30000);
    return () => clearInterval(interval);
  }, [loadMoves]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadMoves().finally(() => setRefreshing(false));
  }, [loadMoves]);

  const name = s.customer?.fullName && s.customer.fullName !== s.customer.phone
    ? s.customer.fullName.split(' ')[0] : null;
  const activeMove = moves.find(m => m._t === 'job' && ['confirmed', 'in_progress'].includes(m.status));
  const quotedMoves = moves.filter(m => m.quotation?.total > 0 && !['confirmed', 'completed', 'cancelled', 'won'].includes(m.status));
  const recentMoves = moves.filter(m => m !== activeMove && !quotedMoves.includes(m)).slice(0, 2);

  return (
    <View style={ss.fill}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.purple} colors={[C.purple]} />}>

        {/* Header */}
        <View style={[ss.px, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
          <View>
            <Text style={{ fontFamily: F.med, fontSize: 13, color: C.ink3 }}>
              {name ? `Hi, ${name}` : 'Good morning'}
            </Text>
            <Text style={{ fontFamily: F.display, fontSize: 22, color: C.ink, letterSpacing: -0.4 }}>
              Welcome back 👋
            </Text>
          </View>
          <View style={ss.avatar}>
            <Text style={{ color: C.white, fontSize: 16, fontFamily: F.display }}>
              {name ? name[0].toUpperCase() : 'P'}
            </Text>
          </View>
        </View>

        {/* Hero CTA */}
        <TouchableOpacity activeOpacity={0.9} onPress={() => go('booking')} style={ss.heroCard}>
          <View style={ss.heroCircle1} />
          <View style={ss.heroCircle2} />
          <View style={{ zIndex: 1 }}>
            <View style={ss.heroBadge}>
              <Text style={{ color: C.lavender, fontSize: 11, fontFamily: F.semi, letterSpacing: 0.6, textTransform: 'uppercase' }}>🚚 Moving made easy</Text>
            </View>
            <Text style={ss.heroTitle}>Need to move?{'\n'}<Text style={{ color: C.lavender }}>We've got you.</Text></Text>
            <TouchableOpacity activeOpacity={0.85} onPress={() => go('booking')} style={ss.heroBtn}>
              <Text style={{ color: C.white, fontFamily: F.semi, fontSize: 14 }}>Get a free quote</Text>
              <Text style={{ color: C.white, fontSize: 16 }}>→</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>

        {/* Services Grid */}
        <View style={ss.px}>
          <Text style={ss.sectionTitle}>Our Services</Text>
          <View style={ss.servicesGrid}>
            {SERVICES.map((svc, i) => (
              <TouchableOpacity key={i} activeOpacity={0.8}
                onPress={() => selectService(svc.label.replace('\n', ' '))}
                style={ss.serviceCard}>
                <View style={[ss.serviceIcon, i === 0 && { backgroundColor: C.purple }]}>
                  <Text style={{ fontSize: 20 }}>{svc.icon}</Text>
                </View>
                <Text style={ss.serviceLabel}>{svc.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Quote Received Cards */}
        {quotedMoves.length > 0 && (
          <View style={ss.px}>
            <Text style={ss.sectionTitle}>Quotes Received</Text>
            {quotedMoves.map((ql: any) => (
              <TouchableOpacity key={ql._id} activeOpacity={0.85} onPress={() => go('moveDetail', ql._id)}
                style={{ marginBottom: 12, borderRadius: 20, overflow: 'hidden', backgroundColor: C.ink }}>
                <View style={{ padding: 20 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: F.reg, fontSize: 11, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Your Quote</Text>
                      <Text style={{ fontFamily: F.displayXB, fontSize: 28, color: C.white, letterSpacing: -1, marginTop: 2 }}>
                        AED {ql.quotation.total.toLocaleString()}
                      </Text>
                    </View>
                    <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(34,197,94,0.2)' }}>
                      <Text style={{ color: C.green, fontSize: 11, fontFamily: F.semi }}>Fixed Price</Text>
                    </View>
                  </View>
                  <View style={{ marginTop: 10, gap: 4 }}>
                    {ql.quotation.items.slice(0, 2).map((item: any, i: number) => (
                      <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>{item.description}</Text>
                        <Text style={{ fontSize: 13, fontFamily: F.semi, color: 'rgba(255,255,255,0.8)' }}>AED {item.amount.toLocaleString()}</Text>
                      </View>
                    ))}
                  </View>
                  <TouchableOpacity activeOpacity={0.85} onPress={() => go('moveDetail', ql._id)}
                    style={{ marginTop: 14, height: 42, borderRadius: 12, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}>
                    <Text style={{ color: C.white, fontFamily: F.bold, fontSize: 14 }}>View & Accept Quote</Text>
                    <Text style={{ color: C.white, fontSize: 16 }}>→</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Active Move */}
        {activeMove && (
          <View style={ss.px}>
            <Text style={ss.sectionTitle}>Active Move</Text>
            <TouchableOpacity activeOpacity={0.8} onPress={() => go('moveDetail', activeMove._id)} style={ss.activeCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View>
                  <View style={ss.statusChip}>
                    <Text style={{ color: C.purple, fontSize: 11, fontFamily: F.semi }}>● In Progress</Text>
                  </View>
                  <Text style={{ fontFamily: F.bold, fontSize: 15, color: C.ink, marginTop: 8 }}>
                    {activeMove.jobType?.replace(/_/g, ' ') || 'Moving Job'}
                  </Text>
                  <Text style={{ fontFamily: F.reg, fontSize: 13, color: C.ink3, marginTop: 4 }}>
                    {activeMove.pickupAddress ? `${activeMove.pickupAddress.substring(0, 20)}` : ''} → {activeMove.deliveryAddress ? activeMove.deliveryAddress.substring(0, 20) : ''}
                  </Text>
                </View>
                <Text style={{ fontSize: 24 }}>→</Text>
              </View>
              <View style={ss.activeCardFooter}>
                <View>
                  <Text style={ss.metaLabel}>Date</Text>
                  <Text style={ss.metaValue}>{activeMove.scheduledDate ? new Date(activeMove.scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'TBD'}</Text>
                </View>
                <View>
                  <Text style={ss.metaLabel}>Crew</Text>
                  <Text style={ss.metaValue}>{activeMove.crew?.length || 0} members</Text>
                </View>
                <View>
                  <Text style={ss.metaLabel}>Status</Text>
                  <Text style={[ss.metaValue, { color: C.purple }]}>{activeMove.status}</Text>
                </View>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* Recent Bookings */}
        {recentMoves.length > 0 && (
          <View style={ss.px}>
            <Text style={ss.sectionTitle}>Recent Bookings</Text>
            {recentMoves.map((m) => (
              <TouchableOpacity key={m._id} activeOpacity={0.7} onPress={() => go('moveDetail', m._id)}
                style={ss.recentCard}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: F.semi, fontSize: 14, color: C.ink }}>
                    {m.pickupAddress ? m.pickupAddress.substring(0, 20) : 'Move'} → {m.deliveryAddress ? m.deliveryAddress.substring(0, 20) : ''}
                  </Text>
                  <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.ink3, marginTop: 3 }}>
                    {new Date(m.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </Text>
                </View>
                <View style={[ss.statusPill, { backgroundColor: m.status === 'completed' ? C.greenBg : m.status === 'confirmed' ? C.greenBg : (m.quotation?.total > 0) ? '#dcfce7' : C.purpleBg }]}>
                  <Text style={{ fontSize: 11, fontFamily: F.semi, color: m.status === 'completed' ? C.green : m.status === 'confirmed' ? C.green : (m.quotation?.total > 0) ? C.green : C.purple }}>
                    {m.status === 'completed' ? 'Completed' : m.status === 'confirmed' ? 'Confirmed' : (m.quotation?.total > 0) ? 'Quote Ready' : m.status === 'new' ? 'Submitted' : m.status}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {loading && <ActivityIndicator color={C.purple} style={{ marginTop: 40 }} />}
      </ScrollView>
      <TabBar active="home" />
    </View>
  );
}

/* ═══════════════════ BOOKING WIZARD ═══════════════════ */
const BOOKING_SERVICES = [
  { icon: '🏠', label: 'Home / Apartment Shifting', desc: 'Full home move with packing' },
  { icon: '🏡', label: 'Villa Moving', desc: 'Large moves with furniture disassembly' },
  { icon: '🏢', label: 'Office Relocation', desc: 'Commercial moves, IT equipment' },
  { icon: '📦', label: 'Packing & Unpacking', desc: 'Professional packing service only' },
  { icon: '🛋', label: 'Single Item Move', desc: 'Individual furniture or appliance' },
  { icon: '🚚', label: 'Furniture Delivery', desc: 'New purchase pickup & delivery' },
];

const PROPERTY_CATEGORIES: Record<string, string[]> = {
  'Apartment': ['Studio', '1 BHK', '2 BHK', '3 BHK', '4 BHK', '5 BHK'],
  'Villa': ['Villa — 1 Room', 'Villa — 2 Rooms', 'Villa — 3 Rooms', 'Villa — 4 Rooms', 'Villa — 5 Rooms', 'Villa — Full'],
};
const TIME_SLOTS = ['8:00 AM', '10:00 AM', '12:00 PM', '2:00 PM'];
const STEPS = ['Service', 'Info', 'Details', 'Photos', 'Schedule'];

function BookingScreen() {
  const { s, go, setBookingStep, selectService } = useApp();
  const step = s.bookingStep;
  const insets = useSafeAreaInsets();

  const [customerName, setCustomerName] = useState(s.customer?.fullName && s.customer.fullName !== s.customer.phone ? s.customer.fullName : '');
  const [customerEmail, setCustomerEmail] = useState(s.customer?.email || '');
  const [pickupAddr, setPickupAddr] = useState('');
  const [deliveryAddr, setDeliveryAddr] = useState('');
  const [propertyType, setPropertyType] = useState('');
  const [floor, setFloor] = useState('');
  const [hasElevator, setHasElevator] = useState(false);
  const [photos, setPhotos] = useState<{ uri: string; name: string; category: string }[]>([]);
  const [notes, setNotes] = useState('');
  const [selectedDate, setSelectedDate] = useState<number | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const LAST_STEP = STEPS.length - 1;

  const stepValid = (() => {
    switch (step) {
      case 0: return !!s.selectedService;
      case 1: return customerName.trim().length >= 2 && customerEmail.trim().length >= 3;
      case 2: return pickupAddr.trim().length > 0 && deliveryAddr.trim().length > 0 && propertyType.length > 0;
      case 3: return photos.length > 0;
      case 4: return selectedDate !== null && selectedTime !== null;
      default: return true;
    }
  })();

  const [uploadMsg, setUploadMsg] = useState('');

  const submit = async () => {
    setSubmitting(true);
    if (photos.length > 0) {
      setUploadMsg('Uploading images, please don\'t close the app...');
    }
    try {
      await api.requestMove({
        serviceType: s.selectedService,
        propertyType,
        pickupAddress: pickupAddr,
        pickupFloor: floor,
        pickupElevator: hasElevator,
        deliveryAddress: deliveryAddr,
        moveDate: selectedDate ? `2026-07-${String(selectedDate).padStart(2, '0')}` : undefined,
        timeSlot: selectedTime || undefined,
        instructions: notes,
        customerName: customerName || undefined,
        customerEmail: customerEmail || undefined,
      }, photos.length > 0 ? photos : undefined);
      setUploadMsg('');
      go('quote');
    } catch (e: any) { setUploadMsg(''); Alert.alert('Error', e.message); }
    finally { setSubmitting(false); }
  };

  return (
    <View style={ss.fill}>
      {/* Top bar */}
      <View style={[ss.topBar, { paddingTop: insets.top + 8 }]}>
        <BackButton onPress={() => step > 0 ? setBookingStep(step - 1) : go('home')} />
        <Text style={ss.topBarTitle}>Book a Move</Text>
      </View>

      {/* Progress */}
      <View style={ss.progress}>
        {STEPS.map((label, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
            <View style={[ss.progressBar, i <= step && ss.progressBarOn]} />
            <Text style={[ss.progressLabel, i <= step && ss.progressLabelOn, i === step && { fontFamily: F.bold }]}>{label}</Text>
          </View>
        ))}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
          {step === 0 && <StepService selected={s.selectedService} onSelect={selectService} />}
          {step === 1 && <StepInfo customerName={customerName} setCustomerName={setCustomerName} customerEmail={customerEmail} setCustomerEmail={setCustomerEmail} phone={s.customer?.phone || ''} />}
          {step === 2 && <StepDetails pickupAddr={pickupAddr} setPickupAddr={setPickupAddr} deliveryAddr={deliveryAddr} setDeliveryAddr={setDeliveryAddr} propertyType={propertyType} setPropertyType={setPropertyType} floor={floor} setFloor={setFloor} hasElevator={hasElevator} setHasElevator={setHasElevator} />}
          {step === 3 && <StepPhotos photos={photos} setPhotos={setPhotos} notes={notes} setNotes={setNotes} />}
          {step === 4 && <StepSchedule selectedDate={selectedDate} setSelectedDate={setSelectedDate} selectedTime={selectedTime} setSelectedTime={setSelectedTime} />}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Bottom buttons */}
      <View style={[ss.bottomBar, { paddingBottom: insets.bottom + 20 }]}>
        {step > 0 && (
          <TouchableOpacity onPress={() => setBookingStep(step - 1)} style={ss.backSmall}>
            <Text style={{ fontSize: 18 }}>←</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity activeOpacity={0.85}
          onPress={() => step < LAST_STEP ? setBookingStep(step + 1) : submit()}
          style={[ss.btnPrimary, { flex: 1, borderRadius: 16 }, (!stepValid || submitting) && { opacity: 0.4 }]}
          disabled={!stepValid || submitting}>
          <Text style={ss.btnPrimaryTxt}>{step === LAST_STEP ? (submitting ? 'Submitting...' : 'Submit Request') : 'Continue'}</Text>
        </TouchableOpacity>
      </View>

      {/* Upload overlay */}
      {submitting && uploadMsg !== '' && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', zIndex: 100 }}>
          <View style={{ backgroundColor: C.white, borderRadius: 20, padding: 32, alignItems: 'center', marginHorizontal: 40, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 8 }}>
            <ActivityIndicator size="large" color={C.purple} style={{ marginBottom: 16 }} />
            <Text style={{ fontFamily: F.bold, fontSize: 16, color: C.ink, textAlign: 'center', marginBottom: 8 }}>Uploading Photos</Text>
            <Text style={{ fontFamily: F.reg, fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20 }}>{uploadMsg}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

function StepService({ selected, onSelect }: { selected: string | null; onSelect: (s: string) => void }) {
  return (
    <View>
      <Text style={ss.stepTitle}>What do you need?</Text>
      <Text style={ss.stepSub}>Select the type of service</Text>
      <View style={{ gap: 10, marginTop: 20 }}>
        {BOOKING_SERVICES.map((svc, i) => {
          const active = selected === svc.label;
          return (
            <TouchableOpacity key={i} activeOpacity={0.8} onPress={() => onSelect(svc.label)}
              style={[ss.serviceRow, active && ss.serviceRowActive]}>
              <View style={[ss.serviceRowIcon, active && { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
                <Text style={{ fontSize: 20 }}>{svc.icon}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[ss.serviceRowLabel, active && { color: C.white }]}>{svc.label}</Text>
                <Text style={[ss.serviceRowDesc, active && { color: 'rgba(255,255,255,0.7)' }]}>{svc.desc}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function StepInfo({ customerName, setCustomerName, customerEmail, setCustomerEmail, phone }: any) {
  return (
    <View>
      <Text style={ss.stepTitle}>Your Information</Text>
      <Text style={ss.stepSub}>Help us know you better</Text>

      <View style={{ marginTop: 24, gap: 18 }}>
        <View>
          <Text style={ss.fieldLabel}>FULL NAME</Text>
          <View style={ss.addressRow}>
            <View style={ss.addressIcon}><Text style={{ fontSize: 16 }}>👤</Text></View>
            <TextInput style={[ss.addressInput, { flex: 1 }]} value={customerName}
              onChangeText={setCustomerName} placeholder="Enter your full name" placeholderTextColor={C.faint} autoCapitalize="words" />
          </View>
        </View>

        <View>
          <Text style={ss.fieldLabel}>EMAIL ADDRESS</Text>
          <View style={ss.addressRow}>
            <View style={ss.addressIcon}><Text style={{ fontSize: 16 }}>✉️</Text></View>
            <TextInput style={[ss.addressInput, { flex: 1 }]} value={customerEmail}
              onChangeText={setCustomerEmail} placeholder="email@example.com" placeholderTextColor={C.faint}
              keyboardType="email-address" autoCapitalize="none" />
          </View>
        </View>

        <View>
          <Text style={ss.fieldLabel}>PHONE NUMBER</Text>
          <View style={[ss.addressRow, { backgroundColor: C.line3 }]}>
            <View style={ss.addressIcon}><Text style={{ fontSize: 16 }}>📱</Text></View>
            <Text style={{ fontFamily: F.med, fontSize: 15, color: C.ink3 }}>{phone}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function StepDetails({ pickupAddr, setPickupAddr, deliveryAddr, setDeliveryAddr, propertyType, setPropertyType, floor, setFloor, hasElevator, setHasElevator }: any) {
  const initCat = Object.entries(PROPERTY_CATEGORIES).find(([, vals]) => vals.includes(propertyType))?.[0] || '';
  const [_propCat, _setPropCat] = useState(initCat);
  return (
    <View>
      <Text style={ss.stepTitle}>Move details</Text>
      <Text style={ss.stepSub}>Where are we picking up and dropping off?</Text>

      <Text style={ss.fieldLabel}>MOVING FROM</Text>
      <View style={ss.addressRow}>
        <View style={ss.addressIcon}><Text style={{ fontSize: 16 }}>📍</Text></View>
        <TextInput style={[ss.addressInput, { flex: 1 }]} value={pickupAddr}
          onChangeText={setPickupAddr} placeholder="Enter pickup address" placeholderTextColor={C.faint} />
      </View>

      <View style={{ alignItems: 'center', marginVertical: -4 }}>
        <View style={{ width: 2, height: 24, backgroundColor: C.purpleBg }} />
      </View>

      <Text style={ss.fieldLabel}>MOVING TO</Text>
      <View style={ss.addressRow}>
        <View style={ss.addressIcon}><Text style={{ fontSize: 16 }}>🏠</Text></View>
        <TextInput style={[ss.addressInput, { flex: 1 }]} value={deliveryAddr}
          onChangeText={setDeliveryAddr} placeholder="Enter delivery address" placeholderTextColor={C.faint} />
      </View>

      <Text style={[ss.fieldLabel, { marginTop: 20 }]}>PROPERTY TYPE</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
        {Object.keys(PROPERTY_CATEGORIES).map(cat => {
          const isActive = PROPERTY_CATEGORIES[cat].includes(propertyType) || (!propertyType && cat === _propCat);
          return (
            <TouchableOpacity key={cat} onPress={() => { _setPropCat(cat); setPropertyType(''); }}
              style={[ss.chip, (cat === _propCat) && ss.chipOn]}>
              <Text style={[ss.chipTxt, (cat === _propCat) && ss.chipTxtOn]}>{cat === 'Apartment' ? '🏢 Apartment' : '🏡 Villa'}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {_propCat ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {PROPERTY_CATEGORIES[_propCat].map(t => (
            <TouchableOpacity key={t} onPress={() => setPropertyType(t)}
              style={[ss.chip, propertyType === t && ss.chipOn]}>
              <Text style={[ss.chipTxt, propertyType === t && ss.chipTxtOn]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
        <View style={{ flex: 1 }}>
          <Text style={ss.fieldLabel}>FLOOR</Text>
          <TextInput style={ss.fieldInput} value={floor} onChangeText={setFloor}
            placeholder="e.g. 22" placeholderTextColor={C.faint} keyboardType="number-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={ss.fieldLabel}>ELEVATOR</Text>
          <TouchableOpacity onPress={() => setHasElevator(!hasElevator)}
            style={[ss.fieldInput, { justifyContent: 'center' }]}>
            <Text style={{ fontFamily: F.semi, fontSize: 15, color: hasElevator ? C.green : C.ink3 }}>
              {hasElevator ? '✓ Available' : '✗ None'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const PHOTO_CATEGORIES = ['Living Room', 'Bedrooms', 'Kitchen', 'Bathrooms', 'Balcony', 'Storage / Boxes', 'Other'];
const TILE_W = (W - 60) / 3;

function StepPhotos({ photos, setPhotos, notes, setNotes }: any) {
  const pickForCategory = async (category: string) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true, quality: 0.7,
    });
    if (result.canceled) return;
    const newPhotos = result.assets.map((a, i) => ({
      uri: a.uri, name: `photo_${Date.now()}_${i}.jpg`, category,
    }));
    setPhotos([...photos, ...newPhotos]);
  };

  const countByCategory = (cat: string) => photos.filter((p: any) => p.category === cat).length;

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Text style={{ fontSize: 16 }}>📷</Text>
        <Text style={ss.stepTitle}>Estimation Photos</Text>
      </View>
      <Text style={ss.stepSub}>{photos.length} photo{photos.length !== 1 ? 's' : ''} — take photos of each area for an accurate estimate</Text>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
        {PHOTO_CATEGORIES.map(cat => {
          const count = countByCategory(cat);
          const hasPhotos = count > 0;
          return (
            <TouchableOpacity key={cat} activeOpacity={0.8} onPress={() => pickForCategory(cat)}
              style={{
                width: TILE_W, height: TILE_W * 0.85, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 4,
                backgroundColor: hasPhotos ? '#ECFDF5' : '#F9F7FC',
                borderWidth: 1.5, borderColor: hasPhotos ? '#6EE7B7' : '#E9E4F0', borderStyle: hasPhotos ? 'solid' : 'dashed',
              }}>
              {hasPhotos && (
                <View style={{ position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: 9, backgroundColor: '#10B981', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>✓</Text>
                </View>
              )}
              <Icon name={hasPhotos ? 'image' : 'camera'} size={18} color={hasPhotos ? '#10B981' : C.purple} />
              <Text style={{ fontFamily: F.semi, fontSize: 11, color: hasPhotos ? '#10B981' : C.purple, textAlign: 'center' }}>
                {hasPhotos ? `${cat} (${count})` : cat}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {photos.length > 0 && (
        <View style={{ marginTop: 16 }}>
          <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.ink, marginBottom: 10 }}>{photos.length} photos uploaded</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {photos.map((p: any, i: number) => (
              <View key={i} style={{ marginRight: 8, position: 'relative' }}>
                <Image source={{ uri: p.uri }} style={{ width: 56, height: 56, borderRadius: 10 }} />
                <TouchableOpacity onPress={() => setPhotos(photos.filter((_: any, idx: number) => idx !== i))}
                  style={ss.photoRemove}>
                  <Text style={{ color: C.white, fontSize: 10, fontWeight: '700' }}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      <View style={{ marginTop: 14, backgroundColor: '#FEF9C3', borderRadius: 12, padding: 12, flexDirection: 'row', gap: 8 }}>
        <Text style={{ fontSize: 16 }}>⚠️</Text>
        <Text style={{ flex: 1, fontFamily: F.reg, fontSize: 12, color: '#92400E', lineHeight: 17 }}>
          If any items are more than the images provided, the quote will be revised on the spot.
        </Text>
      </View>

      <Text style={[ss.fieldLabel, { marginTop: 20 }]}>ADDITIONAL NOTES</Text>
      <TextInput style={[ss.fieldInput, { minHeight: 80, textAlignVertical: 'top' }]}
        value={notes} onChangeText={setNotes} multiline
        placeholder="Large L-shaped sofa, needs disassembly. Glass dining table — handle with care..."
        placeholderTextColor={C.faint} />
    </View>
  );
}

function StepSchedule({ selectedDate, setSelectedDate, selectedTime, setSelectedTime }: any) {
  const DAYS_OF_WEEK = ['S','M','T','W','T','F','S'];
  const START_OFFSET = 3; // July 2026 starts on Wednesday (0-indexed: 3)
  const TODAY = 12; // July 12
  const TOTAL_DAYS = 31;

  return (
    <View>
      <Text style={ss.stepTitle}>Pick a date</Text>
      <Text style={ss.stepSub}>When would you like us to come?</Text>

      <View style={ss.calendarCard}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Text style={{ fontFamily: F.display, fontSize: 16, color: C.ink }}>July 2026</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={ss.calArrow}><Text style={{ fontSize: 12 }}>‹</Text></View>
            <View style={ss.calArrow}><Text style={{ fontSize: 12 }}>›</Text></View>
          </View>
        </View>

        <View style={ss.calGrid}>
          {DAYS_OF_WEEK.map((d, i) => (
            <Text key={'h'+i} style={ss.calHeader}>{d}</Text>
          ))}
          {Array.from({ length: START_OFFSET }).map((_, i) => <View key={'b'+i} />)}
          {Array.from({ length: TOTAL_DAYS }).map((_, i) => {
            const day = i + 1;
            const isPast = day < TODAY;
            const isSelected = day === selectedDate;
            return (
              <TouchableOpacity key={'d'+day} disabled={isPast}
                onPress={() => setSelectedDate(day)}
                style={[ss.calDay, isSelected && ss.calDayOn]}>
                <Text style={[ss.calDayTxt, isPast && { color: '#ccc' }, isSelected && { color: C.white, fontFamily: F.bold }]}>
                  {day}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <Text style={[ss.fieldLabel, { marginTop: 4 }]}>PREFERRED TIME</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
        {TIME_SLOTS.map(t => (
          <TouchableOpacity key={t} onPress={() => setSelectedTime(t)}
            style={[ss.timeSlot, selectedTime === t && ss.timeSlotOn]}>
            <Text style={[ss.timeSlotTxt, selectedTime === t && { color: C.white }]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

/* ═══════════════════ QUOTE RECEIVED ═══════════════════ */
function QuoteScreen() {
  const { go } = useApp();
  const insets = useSafeAreaInsets();

  return (
    <View style={ss.fill}>
      <View style={[ss.topBar, { paddingTop: insets.top + 8 }]}>
        <BackButton onPress={() => go('home')} />
        <Text style={ss.topBarTitle}>Request Submitted</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <View style={{ alignItems: 'center', paddingVertical: 32 }}>
          <View style={ss.successCircle}><Text style={{ fontSize: 28, color: C.white }}>✓</Text></View>
          <Text style={[ss.stepTitle, { marginTop: 16, textAlign: 'center' }]}>Request Submitted!</Text>
          <Text style={{ fontFamily: F.reg, fontSize: 14, color: C.ink3, marginTop: 6, textAlign: 'center', lineHeight: 20 }}>
            Our team will review your photos and details and send you a quote shortly.
          </Text>
        </View>

        <View style={[ss.quoteCard, { alignItems: 'center', paddingVertical: 32 }]}>
          <Text style={{ fontSize: 40 }}>📋</Text>
          <Text style={{ fontSize: 18, fontFamily: F.display, color: C.white, marginTop: 12 }}>What happens next?</Text>
          <View style={{ marginTop: 20, gap: 16, width: '100%' }}>
            {[
              { step: '1', text: 'We review your photos and move details' },
              { step: '2', text: 'Our team prepares a detailed quote for you' },
              { step: '3', text: 'You get notified when your quote is ready' },
            ].map((item, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: C.white, fontFamily: F.bold, fontSize: 13 }}>{item.step}</Text>
                </View>
                <Text style={{ flex: 1, fontSize: 14, color: 'rgba(255,255,255,0.8)', fontFamily: F.reg }}>{item.text}</Text>
              </View>
            ))}
          </View>
        </View>

        <TouchableOpacity activeOpacity={0.85} onPress={() => go('home')}
          style={[ss.btnPrimary, { borderRadius: 16, marginTop: 20 }]}>
          <Text style={ss.btnPrimaryTxt}>Back to Home</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

/* ═══════════════════ TRACKING ═══════════════════ */
function TrackingScreen() {
  const { go } = useApp();
  const insets = useSafeAreaInsets();

  const trackSteps = [
    { label: 'Booking Confirmed', time: '8:00 AM', done: true },
    { label: 'Crew Dispatched', time: '8:15 AM', done: true },
    { label: 'Packing Started', time: '8:45 AM', done: true },
    { label: 'Loading in Progress', time: '10:30 AM', done: true, active: true },
    { label: 'In Transit', time: '—', done: false },
    { label: 'Unloading & Setup', time: '—', done: false },
    { label: 'Complete', time: '—', done: false },
  ];

  const crew = ['Ahmed', 'Hassan', 'Omar', 'Ali'];

  return (
    <View style={ss.fill}>
      <View style={[ss.topBar, { paddingTop: insets.top + 8 }]}>
        <BackButton onPress={() => go('home')} />
        <Text style={ss.topBarTitle}>Track Your Move</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Status banner */}
        <View style={ss.trackBanner}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View>
              <Text style={{ fontSize: 12, fontFamily: F.semi, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: 0.8 }}>Current Status</Text>
              <Text style={{ fontSize: 20, fontFamily: F.display, color: C.white, marginTop: 4 }}>Loading in Progress</Text>
            </View>
            <View style={ss.trackIcon}><Text style={{ fontSize: 20 }}>📦</Text></View>
          </View>
          <View style={{ flexDirection: 'row', gap: 20, marginTop: 16 }}>
            <View>
              <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>ETA to finish</Text>
              <Text style={{ fontSize: 15, fontFamily: F.bold, color: C.white, marginTop: 2 }}>~2 hours</Text>
            </View>
            <View>
              <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Items packed</Text>
              <Text style={{ fontSize: 15, fontFamily: F.bold, color: C.white, marginTop: 2 }}>18 / 24</Text>
            </View>
          </View>
        </View>

        {/* Crew */}
        <View style={ss.trackCard}>
          <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.ink3, marginBottom: 12 }}>Your Crew</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {crew.map((n, i) => (
              <View key={i} style={{ alignItems: 'center', gap: 6 }}>
                <View style={ss.crewAvatar}>
                  <Text style={{ fontSize: 13, fontFamily: F.bold, color: C.purple }}>{n[0]}</Text>
                </View>
                <Text style={{ fontSize: 11, fontFamily: F.med, color: C.ink }}>{n}</Text>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
            <TouchableOpacity style={[ss.crewBtn, { backgroundColor: C.purple }]}>
              <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.white }}>📞 Call Crew Lead</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[ss.crewBtn, { backgroundColor: C.purpleLite }]}>
              <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.purple }}>💬 Chat</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Timeline */}
        <View style={ss.trackCard}>
          <Text style={{ fontFamily: F.bold, fontSize: 14, color: C.ink, marginBottom: 16 }}>Timeline</Text>
          {trackSteps.map((step, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 14, paddingBottom: i < trackSteps.length - 1 ? 20 : 0 }}>
              <View style={{ alignItems: 'center' }}>
                <View style={[ss.tlDot, step.active && ss.tlDotActive, step.done && { backgroundColor: C.purple }, !step.done && !step.active && { backgroundColor: C.line }]}>
                  {step.done && <Text style={{ color: C.white, fontSize: 12, fontWeight: '700' }}>✓</Text>}
                </View>
                {i < trackSteps.length - 1 && (
                  <View style={[ss.tlLine, step.done && { backgroundColor: C.purple }]} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: step.active ? F.bold : F.med, fontSize: 14, color: step.done ? C.ink : C.ink3 }}>{step.label}</Text>
                <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.ink3, marginTop: 2 }}>{step.time}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
      <TabBar active="tracking" />
    </View>
  );
}

/* ═══════════════════ HISTORY ═══════════════════ */
function HistoryScreen() {
  const { go } = useApp();
  const [moves, setMoves] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('All');
  const [refreshing, setRefreshing] = useState(false);
  const insets = useSafeAreaInsets();

  const load = useCallback(() => {
    api.getMoves()
      .then(r => {
        const all = [
          ...r.jobs.map((j: any) => ({ ...j, _t: 'job' })),
          ...r.leads.map((l: any) => ({ ...l, _t: 'lead' })),
        ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setMoves(all);
      })
      .catch(() => {})
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = moves.filter(m => {
    if (filter === 'Active') return ['new', 'contacted', 'quoted', 'draft', 'confirmed', 'in_progress'].includes(m.status);
    if (filter === 'Completed') return m.status === 'completed';
    return true;
  });

  return (
    <View style={ss.fill}>
      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: 16 }}>
        <Text style={{ fontFamily: F.display, fontSize: 28, color: C.ink, letterSpacing: -0.4 }}>My Bookings</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
          {['All', 'Active', 'Completed'].map((t, i) => (
            <TouchableOpacity key={t} onPress={() => setFilter(t)}
              style={[ss.filterChip, filter === t && ss.filterChipOn]}>
              <Text style={[ss.filterTxt, filter === t && ss.filterTxtOn]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {loading ? <ActivityIndicator color={C.purple} style={{ marginTop: 40 }} /> : (
        <FlatList
          data={filtered}
          keyExtractor={m => m._id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.purple} />}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', marginTop: 60 }}>
              <Icon name="inbox" size={48} color={C.faint} />
              <Text style={{ fontFamily: F.med, fontSize: 16, color: C.ink3, marginTop: 12 }}>No bookings yet</Text>
              <TouchableOpacity activeOpacity={0.85} onPress={() => go('booking')}
                style={[ss.btnPrimary, { marginTop: 16, paddingHorizontal: 32 }]}>
                <Text style={ss.btnPrimaryTxt}>Request a Move</Text>
              </TouchableOpacity>
            </View>
          }
          renderItem={({ item: m }) => (
            <TouchableOpacity activeOpacity={0.7} onPress={() => go('moveDetail', m._id)}
              style={ss.bookingCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                <View style={[ss.statusPill, {
                  backgroundColor: m.status === 'completed' ? C.greenBg
                    : (m.status === 'quoted' || (m.quotation?.total > 0 && m.status === 'draft')) ? '#dcfce7'
                    : m.status === 'confirmed' ? C.greenBg
                    : m.status === 'in_progress' ? `${C.purple}15`
                    : C.line3
                }]}>
                  <Text style={{ fontSize: 11, fontFamily: F.semi,
                    color: m.status === 'completed' ? C.green
                      : (m.status === 'quoted' || (m.quotation?.total > 0 && m.status === 'draft')) ? C.green
                      : m.status === 'confirmed' ? C.green
                      : m.status === 'in_progress' ? C.purple
                      : C.ink3
                  }}>
                    {m.status === 'completed' ? 'Completed' : (m.status === 'quoted' || (m.quotation?.total > 0 && m.status === 'draft')) ? 'Quote Ready' : m.status === 'confirmed' ? 'Confirmed' : m.status === 'in_progress' ? 'In Progress' : m.status === 'new' ? 'Submitted' : m.status}
                  </Text>
                </View>
                {m.quotation?.total > 0 && (
                  <Text style={{ fontFamily: F.display, fontSize: 16, color: C.green }}>AED {m.quotation.total.toLocaleString()}</Text>
                )}
                {!m.quotation?.total && m.clientPackage?.agreedPrice > 0 && (
                  <Text style={{ fontFamily: F.display, fontSize: 16, color: C.ink }}>AED {m.clientPackage.agreedPrice.toLocaleString()}</Text>
                )}
              </View>

              {/* From / To dots */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <View style={{ width: 8, height: 8, borderRadius: 99, backgroundColor: C.purple }} />
                <Text style={{ fontFamily: F.semi, fontSize: 14, color: C.ink, flex: 1 }} numberOfLines={1}>
                  {m.pickupAddress || 'Pickup'}
                </Text>
              </View>
              <View style={{ width: 2, height: 12, backgroundColor: C.purpleBg, marginLeft: 3 }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 }}>
                <View style={{ width: 8, height: 8, borderRadius: 99, borderWidth: 2, borderColor: C.purple }} />
                <Text style={{ fontFamily: F.semi, fontSize: 14, color: C.ink, flex: 1 }} numberOfLines={1}>
                  {m.deliveryAddress || 'Delivery'}
                </Text>
              </View>

              <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line3 }}>
                <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.ink3 }}>
                  {new Date(m.scheduledDate || m.moveDate || m.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </Text>
              </View>
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        />
      )}
      <TabBar active="history" />
    </View>
  );
}

/* ═══════════════════ MOVE DETAIL ═══════════════════ */
function MoveDetailScreen() {
  const { s, go } = useApp();
  const [data, setData] = useState<any>(null);
  const [type, setType] = useState<string>('lead');
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [uploadingPermit, setUploadingPermit] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!s.selectedMoveId) return;
    api.getMove(s.selectedMoveId)
      .then(r => { setType(r.type); setData(r.data); })
      .catch(() => Alert.alert('Error', 'Could not load details'))
      .finally(() => setLoading(false));
  }, [s.selectedMoveId]);

  if (loading || !data) return (
    <View style={ss.fill}>
      <View style={[ss.topBar, { paddingTop: insets.top + 8 }]}>
        <BackButton onPress={() => go(s.prevScreen as any || 'history')} />
        <Text style={ss.topBarTitle}>Details</Text>
      </View>
      <ActivityIndicator color={C.purple} style={{ marginTop: 40 }} />
    </View>
  );

  return (
    <View style={ss.fill}>
      <View style={[ss.topBar, { paddingTop: insets.top + 8 }]}>
        <BackButton onPress={() => go(s.prevScreen as any || 'history')} />
        <Text style={ss.topBarTitle}>{type === 'job' ? `Job #${data.jobNo}` : 'Move Request'}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <View style={ss.detailsCard}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
            <Text style={{ fontFamily: F.bold, fontSize: 14, color: C.ink }}>Status</Text>
            <View style={[ss.statusPill, {
              backgroundColor: data.status === 'completed' ? C.greenBg
                : (data.status === 'quoted' || data.quotation?.total > 0) ? '#dcfce7'
                : data.status === 'confirmed' ? C.greenBg
                : C.purpleBg
            }]}>
              <Text style={{ fontSize: 11, fontFamily: F.semi,
                color: data.status === 'completed' ? C.green
                  : (data.status === 'quoted' || data.quotation?.total > 0) ? C.green
                  : data.status === 'confirmed' ? C.green
                  : C.purple
              }}>{data.status === 'completed' ? 'Completed' : (data.status === 'quoted' || (data.quotation?.total > 0 && data.status === 'draft')) ? 'Quote Ready' : data.status === 'confirmed' ? 'Confirmed' : data.status === 'in_progress' ? 'In Progress' : data.status === 'new' ? 'Submitted' : data.status}</Text>
            </View>
          </View>
          {data.pickupAddress && <DetailRow label="From" value={data.pickupAddress} />}
          {data.deliveryAddress && <DetailRow label="To" value={data.deliveryAddress} />}
          {(data.scheduledDate || data.moveDate) && <DetailRow label="Date" value={new Date(data.scheduledDate || data.moveDate).toLocaleDateString()} />}
          {data.serviceType && <DetailRow label="Service" value={data.serviceType} />}
          {data.notes && <DetailRow label="Notes" value={data.notes} />}
        </View>

        {/* Customer photos */}
        {data.images?.length > 0 && (
          <View style={{ marginTop: 16 }}>
            <Text style={{ fontFamily: F.bold, fontSize: 14, color: C.ink, marginBottom: 10 }}>Your Photos</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {data.images.map((img: any, i: number) => (
                <Image key={i} source={{ uri: img.url }} style={{ width: 90, height: 90, borderRadius: 14, marginRight: 8 }} />
              ))}
            </ScrollView>
            <View style={{ marginTop: 10, backgroundColor: '#FEF9C3', borderRadius: 12, padding: 12, flexDirection: 'row', gap: 8 }}>
              <Text style={{ fontSize: 16 }}>⚠️</Text>
              <Text style={{ flex: 1, fontFamily: F.reg, fontSize: 12, color: '#92400E', lineHeight: 17 }}>
                If any items are more than the images provided, the quote will be revised on the spot.
              </Text>
            </View>
          </View>
        )}

        {/* Quote from admin */}
        {data.quotation?.total > 0 && (
          <>
            <View style={[ss.quoteCard, { marginTop: 16 }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View>
                  <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontFamily: F.semi, textTransform: 'uppercase', letterSpacing: 0.8 }}>Your Quote</Text>
                  <Text style={{ fontSize: 36, fontFamily: F.displayXB, color: C.white, letterSpacing: -1, marginTop: 4 }}>
                    AED {data.quotation.total.toLocaleString()}
                  </Text>
                </View>
                <View style={ss.fixedPriceBadge}>
                  <Text style={{ color: C.lavender, fontSize: 12, fontFamily: F.semi }}>Fixed Price</Text>
                </View>
              </View>
              <View style={{ marginTop: 20, gap: 10 }}>
                {data.quotation.items.map((item: any, i: number) => (
                  <View key={i} style={[ss.quoteRow, i > 0 && { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', paddingTop: 10 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>{item.description}</Text>
                      {item.qty > 1 && <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{item.qty} × AED {item.rate.toLocaleString()}</Text>}
                    </View>
                    <Text style={{ fontSize: 14, fontFamily: F.semi, color: C.white }}>AED {item.amount.toLocaleString()}</Text>
                  </View>
                ))}
              </View>
              {data.quotation.discount > 0 && (
                <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Discount</Text>
                  <Text style={{ fontSize: 13, fontFamily: F.semi, color: '#86efac' }}>- AED {data.quotation.discount.toLocaleString()}</Text>
                </View>
              )}
              {data.quotation.notes ? (
                <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' }}>
                  <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{data.quotation.notes}</Text>
                </View>
              ) : null}
            </View>

            <TouchableOpacity
              activeOpacity={0.85}
              disabled={accepting || data.status === 'confirmed'}
              style={[ss.btnPrimary, { borderRadius: 16, marginTop: 16, opacity: accepting || data.status === 'confirmed' ? 0.6 : 1 }]}
              onPress={async () => {
                setAccepting(true);
                try {
                  await api.acceptQuote(data._id);
                  setData({ ...data, status: 'confirmed' });
                  Alert.alert('Quote Accepted', 'Your move has been confirmed. We will be in touch shortly!');
                } catch (e: any) { Alert.alert('Error', e.message); }
                finally { setAccepting(false); }
              }}
            >
              <Text style={ss.btnPrimaryTxt}>{accepting ? 'Processing…' : data.status === 'confirmed' ? 'Quote Accepted ✓' : 'Accept & Proceed'}</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.85} style={[ss.btnOutline, { marginTop: 8 }]}>
              <Text style={ss.btnOutlineTxt}>Chat with us about this quote</Text>
            </TouchableOpacity>
          </>
        )}

        {/* Move Permit Upload */}
        <View style={{ marginTop: 24, backgroundColor: C.white, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: C.line3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: C.purpleBg, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 18 }}>📋</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.bold, fontSize: 15, color: C.ink }}>Move Permit</Text>
              <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.ink3, marginTop: 1 }}>Upload your building move permit</Text>
            </View>
          </View>

          {/* Show existing permits */}
          {data.images?.filter((img: any) => img.category === 'Move Permit').length > 0 && (
            <View style={{ marginTop: 14 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {data.images.filter((img: any) => img.category === 'Move Permit').map((img: any, i: number) => (
                  <Image key={i} source={{ uri: img.url }} style={{ width: 80, height: 80, borderRadius: 12, marginRight: 8, borderWidth: 1, borderColor: C.line3 }} />
                ))}
              </ScrollView>
              <Text style={{ fontFamily: F.reg, fontSize: 11, color: C.green, marginTop: 8 }}>✓ Permit uploaded</Text>
            </View>
          )}

          <TouchableOpacity
            activeOpacity={0.85}
            disabled={uploadingPermit}
            onPress={async () => {
              const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsMultipleSelection: true,
                quality: 0.8,
              });
              if (result.canceled || !result.assets?.length) return;
              setUploadingPermit(true);
              try {
                const imgs = result.assets.map(a => ({
                  uri: a.uri,
                  name: a.fileName || `permit-${Date.now()}.jpg`,
                  type: a.mimeType || 'image/jpeg',
                }));
                const res = await api.uploadPhotos(data._id, imgs, 'Move Permit');
                setData({ ...data, images: [...(data.images || []), ...res.images] });
                Alert.alert('Uploaded', 'Move permit uploaded successfully.');
              } catch (e: any) { Alert.alert('Error', e.message); }
              finally { setUploadingPermit(false); }
            }}
            style={{ marginTop: 14, height: 44, borderRadius: 12, borderWidth: 1.5, borderColor: C.purple, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, opacity: uploadingPermit ? 0.5 : 1 }}
          >
            <Text style={{ fontSize: 16 }}>📎</Text>
            <Text style={{ color: C.purple, fontFamily: F.semi, fontSize: 14 }}>{uploadingPermit ? 'Uploading…' : 'Upload Permit Photo'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Upload overlay */}
      {uploadingPermit && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', zIndex: 100 }}>
          <View style={{ backgroundColor: C.white, borderRadius: 20, padding: 32, alignItems: 'center', marginHorizontal: 40, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 8 }}>
            <ActivityIndicator size="large" color={C.purple} style={{ marginBottom: 16 }} />
            <Text style={{ fontFamily: F.bold, fontSize: 16, color: C.ink, textAlign: 'center', marginBottom: 8 }}>Uploading Photos</Text>
            <Text style={{ fontFamily: F.reg, fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20 }}>Uploading images, please don't close the app...</Text>
          </View>
        </View>
      )}
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={[ss.detailRow, { borderTopWidth: 1, borderTopColor: C.line3, paddingTop: 9 }]}>
      <Text style={{ fontSize: 13, color: C.ink3 }}>{label}</Text>
      <Text style={{ fontSize: 13, fontFamily: F.semi, color: C.ink, flex: 1, textAlign: 'right' }}>{value}</Text>
    </View>
  );
}

/* ═══════════════════ PROFILE ═══════════════════ */
function ProfileScreen() {
  const { s, go, logout, updateProfile } = useApp();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(s.customer?.fullName || '');
  const [email, setEmail] = useState(s.customer?.email || '');
  const [saving, setSaving] = useState(false);
  const insets = useSafeAreaInsets();

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.updateProfile({ fullName: name, email });
      updateProfile({ ...s.customer!, fullName: res.customer.fullName, email: res.customer.email });
      setEditing(false);
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSaving(false); }
  };

  const initial = s.customer?.fullName && s.customer.fullName !== s.customer.phone
    ? s.customer.fullName[0].toUpperCase() : 'P';

  const MENU = [
    { icon: '📍', label: 'Saved Addresses', sub: 'Manage locations' },
    { icon: '💳', label: 'Payment Methods', sub: 'Cards & wallets' },
    { icon: '🔔', label: 'Notifications', sub: 'Push & SMS' },
    { icon: '📄', label: 'Documents', sub: 'ID, contracts' },
    { icon: '🌐', label: 'Language', sub: 'English' },
    { icon: '❓', label: 'Help & Support', sub: 'FAQ, contact us' },
  ];

  return (
    <View style={ss.fill}>
      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 20 }}>
        <Text style={{ fontFamily: F.display, fontSize: 28, color: C.ink, letterSpacing: -0.4 }}>Profile</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
        {/* Avatar */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 28 }}>
          <View style={[ss.avatar, { width: 64, height: 64, borderRadius: 20 }]}>
            <Text style={{ color: C.white, fontSize: 24, fontFamily: F.display }}>{initial}</Text>
          </View>
          <View>
            {editing ? (
              <>
                <TextInput style={[ss.fieldInput, { width: 200, marginBottom: 6 }]} value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor={C.faint} />
                <TextInput style={[ss.fieldInput, { width: 200 }]} value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={C.faint} keyboardType="email-address" />
              </>
            ) : (
              <>
                <Text style={{ fontFamily: F.display, fontSize: 20, color: C.ink }}>{s.customer?.fullName || 'Customer'}</Text>
                <Text style={{ fontFamily: F.reg, fontSize: 13, color: C.ink3, marginTop: 2 }}>{s.customer?.phone}</Text>
                {!!s.customer?.email && <Text style={{ fontFamily: F.reg, fontSize: 13, color: C.ink3 }}>{s.customer.email}</Text>}
              </>
            )}
          </View>
        </View>

        {editing && (
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 24 }}>
            <TouchableOpacity onPress={() => setEditing(false)} style={[ss.btnOutline, { flex: 1 }]}>
              <Text style={ss.btnOutlineTxt}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSave} style={[ss.btnPrimary, { flex: 1, borderRadius: 14 }]} disabled={saving}>
              <Text style={ss.btnPrimaryTxt}>{saving ? 'Saving...' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {!editing && (
          <TouchableOpacity onPress={() => setEditing(true)} style={{ alignSelf: 'flex-start', marginBottom: 24 }}>
            <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.purple }}>Edit Profile</Text>
          </TouchableOpacity>
        )}

        {/* Stats */}
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 24 }}>
          {[
            { num: '0', label: 'Total Moves' },
            { num: '—', label: 'Avg Rating' },
            { num: 'New', label: 'Member' },
          ].map((stat, i) => (
            <View key={i} style={ss.statCard}>
              <Text style={{ fontFamily: F.display, fontSize: 24, color: C.purple }}>{stat.num}</Text>
              <Text style={{ fontFamily: F.med, fontSize: 11, color: C.ink3, marginTop: 4 }}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {/* Menu */}
        <View style={ss.menuCard}>
          {MENU.map((item, i) => (
            <TouchableOpacity key={i} activeOpacity={0.7}
              style={[ss.menuRow, i > 0 && { borderTopWidth: 1, borderTopColor: C.line3 }]}>
              <View style={ss.menuIcon}><Text style={{ fontSize: 18 }}>{item.icon}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: F.semi, fontSize: 14, color: C.ink }}>{item.label}</Text>
                <Text style={{ fontFamily: F.reg, fontSize: 12, color: C.ink3, marginTop: 1 }}>{item.sub}</Text>
              </View>
              <Text style={{ fontSize: 16, color: C.ink3 }}>›</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity activeOpacity={0.8} onPress={() => { setToken(null); logout(); }} style={ss.signOutBtn}>
          <Text style={{ fontFamily: F.semi, fontSize: 14, color: C.red }}>Sign Out</Text>
        </TouchableOpacity>
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
  logoCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  loginTitle: { fontFamily: F.displayXB, fontSize: 28, color: C.ink },
  loginSub: { fontFamily: F.reg, fontSize: 15, color: C.ink3, marginTop: 6 },
  label: { fontFamily: F.semi, fontSize: 13, color: C.ink2, marginBottom: 6 },
  input: { height: 52, borderRadius: 14, borderWidth: 1.5, borderColor: C.line, backgroundColor: C.white, paddingHorizontal: 16, fontFamily: F.reg, fontSize: 15, color: C.ink },
  errorTxt: { fontFamily: F.med, fontSize: 13, color: C.red, marginTop: 6 },
  googleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 52, borderRadius: 14, borderWidth: 1.5, borderColor: C.line, backgroundColor: C.white, width: '100%' },
  googleBtnTxt: { fontFamily: F.semi, fontSize: 15, color: C.ink },

  // Buttons
  btnPrimary: { height: 52, borderRadius: 14, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  btnPrimaryTxt: { color: C.white, fontFamily: F.bold, fontSize: 15 },
  btnOutline: { height: 48, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(91,43,201,0.2)', alignItems: 'center', justifyContent: 'center' },
  btnOutlineTxt: { color: C.purple, fontFamily: F.semi, fontSize: 14 },
  btnSmallPurple: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 999, backgroundColor: C.purple },

  // Avatar
  avatar: { width: 40, height: 40, borderRadius: 14, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center' },

  // Home
  heroCard: { marginHorizontal: 20, marginTop: 16, padding: 28, backgroundColor: C.ink, borderRadius: 22, overflow: 'hidden' },
  heroCircle1: { position: 'absolute', right: -40, top: -40, width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(91,43,201,0.3)' },
  heroCircle2: { position: 'absolute', right: 20, bottom: -20, width: 100, height: 100, borderRadius: 50, borderWidth: 20, borderColor: 'rgba(91,43,201,0.15)' },
  heroBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(124,77,255,0.2)', marginBottom: 14 },
  heroTitle: { fontFamily: F.display, fontSize: 26, color: C.white, lineHeight: 30, letterSpacing: -0.4 },
  heroBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', marginTop: 18, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 999, backgroundColor: C.purple },
  sectionTitle: { fontFamily: F.display, fontSize: 16, color: C.ink, letterSpacing: -0.2, marginBottom: 14, marginTop: 18 },
  servicesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  serviceCard: { width: '48%' as any, backgroundColor: C.white, borderWidth: 1, borderColor: C.line2, borderRadius: 16, padding: 14, alignItems: 'center', gap: 8 },
  serviceIcon: { width: 44, height: 44, borderRadius: 13, backgroundColor: C.purpleLite, alignItems: 'center', justifyContent: 'center' },
  serviceLabel: { fontFamily: F.semi, fontSize: 12, color: C.ink, textAlign: 'center', lineHeight: 15 },

  activeCard: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line2, borderRadius: 18, padding: 18 },
  statusChip: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: C.purpleBg },
  activeCardFooter: { flexDirection: 'row', gap: 16, marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.line2 },
  metaLabel: { fontFamily: F.med, fontSize: 11, color: C.ink3 },
  metaValue: { fontFamily: F.semi, fontSize: 13, color: C.ink, marginTop: 2 },
  recentCard: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line2, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },

  // Booking
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingBottom: 12 },
  topBarTitle: { fontFamily: F.display, fontSize: 17, color: C.ink },
  progress: { flexDirection: 'row', paddingHorizontal: 20, paddingBottom: 16, gap: 6 },
  progressBar: { width: '100%', height: 4, borderRadius: 99, backgroundColor: C.line },
  progressBarOn: { backgroundColor: C.purple },
  progressLabel: { fontFamily: F.med, fontSize: 10, color: C.ink3 },
  progressLabelOn: { color: C.purple },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 16, backgroundColor: C.paper },
  backSmall: { width: 52, height: 52, borderRadius: 16, backgroundColor: C.white, borderWidth: 1, borderColor: 'rgba(20,8,31,0.1)', alignItems: 'center', justifyContent: 'center' },

  stepTitle: { fontFamily: F.display, fontSize: 22, color: C.ink, letterSpacing: -0.4 },
  stepSub: { fontFamily: F.reg, fontSize: 14, color: C.ink3, marginTop: 6 },
  fieldLabel: { fontFamily: F.semi, fontSize: 12, color: C.ink3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, marginTop: 16 },
  fieldInput: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 14, fontFamily: F.reg, fontSize: 15, color: C.ink },

  // Service list
  serviceRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 16, backgroundColor: C.white, borderWidth: 1, borderColor: C.line2 },
  serviceRowActive: { backgroundColor: C.purple, borderColor: C.purple },
  serviceRowIcon: { width: 44, height: 44, borderRadius: 13, backgroundColor: C.purpleLite, alignItems: 'center', justifyContent: 'center' },
  serviceRowLabel: { fontFamily: F.semi, fontSize: 15, color: C.ink },
  serviceRowDesc: { fontFamily: F.reg, fontSize: 13, color: C.ink3, marginTop: 2 },

  // Address
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 14 },
  addressIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.purpleLite, alignItems: 'center', justifyContent: 'center' },
  addressInput: { fontFamily: F.reg, fontSize: 15, color: C.ink },

  // Chips
  chip: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(20,8,31,0.1)', backgroundColor: C.white },
  chipOn: { borderColor: C.purple, backgroundColor: C.purple },
  chipTxt: { fontFamily: F.semi, fontSize: 13, color: C.ink },
  chipTxtOn: { color: C.white },

  // Photos
  uploadArea: { borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(91,43,201,0.25)', borderRadius: 20, padding: 40, alignItems: 'center', gap: 8, backgroundColor: C.purpleLite, marginTop: 20 },
  uploadIcon: { width: 56, height: 56, borderRadius: 16, backgroundColor: C.purpleBg, alignItems: 'center', justifyContent: 'center' },
  photoRemove: { position: 'absolute', top: -4, right: -4, width: 20, height: 20, borderRadius: 10, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' },
  roomGuide: { flex: 1, aspectRatio: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 6 },

  // Calendar
  calendarCard: { backgroundColor: C.white, borderRadius: 18, borderWidth: 1, borderColor: C.line2, padding: 18, marginTop: 20 },
  calArrow: { width: 30, height: 30, borderRadius: 8, backgroundColor: C.line3, alignItems: 'center', justifyContent: 'center' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calHeader: { width: '14.28%', textAlign: 'center', fontFamily: F.semi, fontSize: 11, color: C.ink3, paddingVertical: 6 },
  calDay: { width: '14.28%', alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  calDayOn: { backgroundColor: C.purple, borderRadius: 10 },
  calDayTxt: { fontFamily: F.med, fontSize: 13, color: C.ink },
  timeSlot: { flex: 1, minWidth: (W - 56) / 2, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.white, alignItems: 'center' },
  timeSlotOn: { borderColor: C.purple, backgroundColor: C.purple },
  timeSlotTxt: { fontFamily: F.semi, fontSize: 14, color: C.ink },

  // Quote
  successCircle: { width: 64, height: 64, borderRadius: 20, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  quoteCard: { backgroundColor: C.ink, borderRadius: 22, padding: 28 },
  fixedPriceBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(124,77,255,0.2)' },
  quoteRow: { flexDirection: 'row', justifyContent: 'space-between' },
  detailsCard: { backgroundColor: C.white, borderRadius: 18, borderWidth: 1, borderColor: C.line2, padding: 18, marginTop: 16 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9 },

  // Tracking
  trackBanner: { marginHorizontal: 20, marginBottom: 16, padding: 20, backgroundColor: C.purple, borderRadius: 18 },
  trackIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  trackCard: { marginHorizontal: 20, marginBottom: 16, padding: 18, backgroundColor: C.white, borderWidth: 1, borderColor: C.line2, borderRadius: 18 },
  crewAvatar: { width: 44, height: 44, borderRadius: 14, backgroundColor: C.purpleBg, alignItems: 'center', justifyContent: 'center' },
  crewBtn: { flex: 1, padding: 10, borderRadius: 12, alignItems: 'center' },
  tlDot: { width: 24, height: 24, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  tlDotActive: { shadowColor: C.purple, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  tlLine: { width: 2, flex: 1, backgroundColor: C.line, marginVertical: 2 },

  // History
  filterChip: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 999, backgroundColor: C.line3 },
  filterChipOn: { backgroundColor: C.ink },
  filterTxt: { fontFamily: F.semi, fontSize: 13, color: C.ink3 },
  filterTxtOn: { color: C.white },
  bookingCard: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line2, borderRadius: 18, padding: 18 },

  // Profile
  statCard: { flex: 1, backgroundColor: C.white, borderWidth: 1, borderColor: C.line2, borderRadius: 16, padding: 16, alignItems: 'center' },
  menuCard: { backgroundColor: C.white, borderRadius: 18, borderWidth: 1, borderColor: C.line2, overflow: 'hidden' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 },
  menuIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: C.purpleLite, alignItems: 'center', justifyContent: 'center' },
  signOutBtn: { marginTop: 20, padding: 14, borderRadius: 14, backgroundColor: C.redBg, borderWidth: 1, borderColor: 'rgba(239,68,68,0.12)', alignItems: 'center' },
});
