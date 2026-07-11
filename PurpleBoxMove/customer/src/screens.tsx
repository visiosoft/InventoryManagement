import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  FlatList, ActivityIndicator, Alert, RefreshControl, Image,
  KeyboardAvoidingView, Platform, Dimensions,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  C, F, Icon, PrimaryButton, OutlineButton, TopBar, Footer,
  BottomNav, StatusBadge, Card, useApp,
} from './core';
import { api, setToken } from './api';

/* ─── ROUTER ─── */
export function Router() {
  const { s } = useApp();
  switch (s.screen) {
    case 'login': return <LoginScreen />;
    case 'otp': return <OtpScreen />;
    case 'hub': return <HubScreen />;
    case 'history': return <HistoryScreen />;
    case 'profile': return <ProfileScreen />;
    case 'booking': return <BookingScreen />;
    case 'bookingSubmitted': return <BookingSubmittedScreen />;
    case 'moveDetail': return <MoveDetailScreen />;
    default: return <HubScreen />;
  }
}

/* ─── LOGIN ─── */
function LoginScreen() {
  const { setPhone } = useApp();
  const [phone, setPhoneLocal] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const insets = useSafeAreaInsets();

  const handleSend = async () => {
    if (phone.length < 8) { setError('Enter a valid phone number'); return; }
    setLoading(true);
    setError('');
    try {
      await api.requestOtp(phone);
      setPhone(phone);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[ss.fill, { paddingTop: insets.top + 60 }]}>
      <View style={ss.loginWrap}>
        <View style={ss.logoCircle}>
          <Icon name="truck" size={32} color={C.white} />
        </View>
        <Text style={ss.loginTitle}>PurpleBox</Text>
        <Text style={ss.loginSub}>Moving made simple</Text>

        <View style={{ marginTop: 40, width: '100%' }}>
          <Text style={ss.label}>Phone Number</Text>
          <TextInput
            style={ss.input}
            value={phone}
            onChangeText={setPhoneLocal}
            placeholder="+971 50 123 4567"
            placeholderTextColor={C.faint}
            keyboardType="phone-pad"
            autoFocus
          />
          {!!error && <Text style={ss.errorTxt}>{error}</Text>}

          <PrimaryButton
            label={loading ? 'Sending...' : 'Get OTP'}
            onPress={handleSend}
            disabled={loading || phone.length < 8}
            style={{ marginTop: 16 }}
          />
        </View>
      </View>
    </View>
  );
}

/* ─── OTP ─── */
function OtpScreen() {
  const { s, login, go } = useApp();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const insets = useSafeAreaInsets();

  const handleVerify = async () => {
    if (code.length < 4) { setError('Enter the 4-digit code'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await api.verifyOtp(s.phone, code);
      setToken(res.token);
      login(
        { id: res.customer.id, fullName: res.customer.fullName, phone: res.customer.phone, email: res.customer.email || '' },
        res.token,
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[ss.fill, { paddingTop: insets.top + 60 }]}>
      <View style={ss.loginWrap}>
        <TouchableOpacity onPress={() => go('login')} style={{ alignSelf: 'flex-start', marginBottom: 20 }}>
          <Icon name="arrow-left" size={22} color={C.ink} />
        </TouchableOpacity>

        <Text style={ss.loginTitle}>Verify Phone</Text>
        <Text style={ss.loginSub}>Enter the code sent to {s.phone}</Text>

        <View style={{ marginTop: 30, width: '100%' }}>
          <Text style={ss.label}>OTP Code</Text>
          <TextInput
            style={[ss.input, { textAlign: 'center', fontSize: 24, letterSpacing: 12 }]}
            value={code}
            onChangeText={setCode}
            placeholder="0000"
            placeholderTextColor={C.faint}
            keyboardType="number-pad"
            maxLength={4}
            autoFocus
          />
          {!!error && <Text style={ss.errorTxt}>{error}</Text>}

          <PrimaryButton
            label={loading ? 'Verifying...' : 'Verify'}
            onPress={handleVerify}
            disabled={loading || code.length < 4}
            style={{ marginTop: 16 }}
          />
        </View>
      </View>
    </View>
  );
}

/* ─── HUB (Home) ─── */
function HubScreen() {
  const { s, go } = useApp();
  const [recentMoves, setRecentMoves] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    api.getMoves()
      .then(r => {
        const all = [
          ...r.jobs.map((j: any) => ({ ...j, _type: 'job' })),
          ...r.leads.map((l: any) => ({ ...l, _type: 'lead' })),
        ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setRecentMoves(all.slice(0, 3));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const greeting = s.customer?.fullName ? `Hi, ${s.customer.fullName.split(' ')[0]}` : 'Welcome';

  return (
    <View style={ss.fill}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 100 }}>
        <View style={ss.px}>
          <Text style={ss.hubGreeting}>{greeting}</Text>
          <Text style={ss.hubSub}>What can we help you move today?</Text>
        </View>

        {/* CTA */}
        <TouchableOpacity activeOpacity={0.9} onPress={() => go('booking')} style={ss.ctaCard}>
          <View style={ss.ctaIcon}>
            <Icon name="package" size={28} color={C.white} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={ss.ctaTitle}>Request a Move</Text>
            <Text style={ss.ctaSub}>Get a free quote for your home or office move</Text>
          </View>
          <Icon name="chevron-right" size={20} color={C.white} />
        </TouchableOpacity>

        {/* Quick actions */}
        <View style={[ss.px, { flexDirection: 'row', gap: 12, marginTop: 20 }]}>
          <TouchableOpacity style={ss.quickAction} activeOpacity={0.8} onPress={() => go('history')}>
            <View style={[ss.quickIcon, { backgroundColor: C.purpleLite }]}>
              <Icon name="clock" size={20} color={C.purple} />
            </View>
            <Text style={ss.quickLabel}>My Moves</Text>
          </TouchableOpacity>
          <TouchableOpacity style={ss.quickAction} activeOpacity={0.8} onPress={() => go('profile')}>
            <View style={[ss.quickIcon, { backgroundColor: C.greenBg }]}>
              <Icon name="user" size={20} color={C.green} />
            </View>
            <Text style={ss.quickLabel}>Profile</Text>
          </TouchableOpacity>
        </View>

        {/* Recent moves */}
        {recentMoves.length > 0 && (
          <View style={{ marginTop: 28 }}>
            <View style={[ss.px, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
              <Text style={ss.sectionTitle}>Recent Activity</Text>
              <TouchableOpacity onPress={() => go('history')}>
                <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.purple }}>See All</Text>
              </TouchableOpacity>
            </View>
            {recentMoves.map((m) => (
              <TouchableOpacity
                key={m._id}
                style={ss.moveCard}
                activeOpacity={0.7}
                onPress={() => go('moveDetail', m._id)}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={ss.moveCardTitle}>
                    {m._type === 'job' ? `Job #${m.jobNo}` : 'Move Request'}
                  </Text>
                  <StatusBadge status={m.status} />
                </View>
                {(m.pickupAddress || m.deliveryAddress) && (
                  <View style={{ marginTop: 8 }}>
                    {!!m.pickupAddress && (
                      <View style={ss.addrRow}>
                        <Icon name="map-pin" size={13} color={C.green} />
                        <Text style={ss.addrTxt} numberOfLines={1}>{m.pickupAddress}</Text>
                      </View>
                    )}
                    {!!m.deliveryAddress && (
                      <View style={ss.addrRow}>
                        <Icon name="flag" size={13} color={C.purple} />
                        <Text style={ss.addrTxt} numberOfLines={1}>{m.deliveryAddress}</Text>
                      </View>
                    )}
                  </View>
                )}
                <Text style={ss.moveDate}>
                  {m.scheduledDate || m.moveDate
                    ? new Date(m.scheduledDate || m.moveDate).toLocaleDateString()
                    : 'Date TBD'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {loading && (
          <ActivityIndicator color={C.purple} style={{ marginTop: 40 }} />
        )}
      </ScrollView>
      <BottomNav />
    </View>
  );
}

/* ─── HISTORY ─── */
function HistoryScreen() {
  const { go } = useApp();
  const [moves, setMoves] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    api.getMoves()
      .then(r => {
        const all = [
          ...r.jobs.map((j: any) => ({ ...j, _type: 'job' })),
          ...r.leads.map((l: any) => ({ ...l, _type: 'lead' })),
        ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setMoves(all);
      })
      .catch(() => {})
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={ss.fill}>
      <TopBar title="My Moves" />
      {loading ? (
        <ActivityIndicator color={C.purple} style={{ marginTop: 40 }} />
      ) : moves.length === 0 ? (
        <View style={ss.empty}>
          <Icon name="inbox" size={48} color={C.faint} />
          <Text style={ss.emptyTxt}>No moves yet</Text>
          <PrimaryButton label="Request a Move" onPress={() => go('booking')} style={{ marginTop: 16, width: 200 }} />
        </View>
      ) : (
        <FlatList
          data={moves}
          keyExtractor={m => m._id}
          contentContainerStyle={{ paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.purple} />}
          renderItem={({ item: m }) => (
            <TouchableOpacity
              style={ss.moveCard}
              activeOpacity={0.7}
              onPress={() => go('moveDetail', m._id)}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={ss.moveCardTitle}>
                  {m._type === 'job' ? `Job #${m.jobNo}` : 'Move Request'}
                </Text>
                <StatusBadge status={m.status} />
              </View>
              {!!m.pickupAddress && (
                <View style={[ss.addrRow, { marginTop: 8 }]}>
                  <Icon name="map-pin" size={13} color={C.green} />
                  <Text style={ss.addrTxt} numberOfLines={1}>{m.pickupAddress}</Text>
                </View>
              )}
              {!!m.deliveryAddress && (
                <View style={ss.addrRow}>
                  <Icon name="flag" size={13} color={C.purple} />
                  <Text style={ss.addrTxt} numberOfLines={1}>{m.deliveryAddress}</Text>
                </View>
              )}
              <Text style={ss.moveDate}>
                {m.scheduledDate || m.moveDate
                  ? new Date(m.scheduledDate || m.moveDate).toLocaleDateString()
                  : 'Date TBD'}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
      <BottomNav />
    </View>
  );
}

/* ─── MOVE DETAIL ─── */
function MoveDetailScreen() {
  const { s, go } = useApp();
  const [data, setData] = useState<any>(null);
  const [type, setType] = useState<'job' | 'lead'>('lead');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!s.selectedMoveId) return;
    api.getMove(s.selectedMoveId)
      .then(r => { setType(r.type as any); setData(r.data); })
      .catch(() => Alert.alert('Error', 'Could not load move details'))
      .finally(() => setLoading(false));
  }, [s.selectedMoveId]);

  if (loading) return (
    <View style={ss.fill}>
      <TopBar title="Move Details" onBack={() => go(s.prevScreen || 'history')} />
      <ActivityIndicator color={C.purple} style={{ marginTop: 40 }} />
    </View>
  );

  if (!data) return (
    <View style={ss.fill}>
      <TopBar title="Move Details" onBack={() => go(s.prevScreen || 'history')} />
      <View style={ss.empty}><Text style={ss.emptyTxt}>Not found</Text></View>
    </View>
  );

  const isJob = type === 'job';

  return (
    <View style={ss.fill}>
      <TopBar title={isJob ? `Job #${data.jobNo}` : 'Move Request'} onBack={() => go(s.prevScreen || 'history')} />
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <Text style={ss.detailLabel}>Status</Text>
            <StatusBadge status={data.status} />
          </View>

          {(isJob ? data.scheduledDate : data.moveDate) && (
            <DetailRow icon="calendar" label="Date" value={new Date(isJob ? data.scheduledDate : data.moveDate).toLocaleDateString()} />
          )}
          {isJob && data.scheduledTimeSlot && (
            <DetailRow icon="clock" label="Time" value={data.scheduledTimeSlot} />
          )}
          {isJob && data.jobType && (
            <DetailRow icon="truck" label="Type" value={data.jobType.replace(/_/g, ' ')} />
          )}
        </Card>

        {(data.pickupAddress || data.deliveryAddress) && (
          <Card style={{ marginTop: 14 }}>
            <Text style={ss.cardTitle}>Addresses</Text>
            {!!data.pickupAddress && (
              <View style={{ marginTop: 10 }}>
                <Text style={ss.detailLabel}>Pickup</Text>
                <Text style={ss.detailValue}>{data.pickupAddress}</Text>
                {isJob && data.pickupFloor && <Text style={ss.detailMeta}>Floor: {data.pickupFloor} {data.pickupHasElevator ? '(Elevator)' : '(No elevator)'}</Text>}
              </View>
            )}
            {!!data.deliveryAddress && (
              <View style={{ marginTop: 10 }}>
                <Text style={ss.detailLabel}>Delivery</Text>
                <Text style={ss.detailValue}>{data.deliveryAddress}</Text>
                {isJob && data.deliveryFloor && <Text style={ss.detailMeta}>Floor: {data.deliveryFloor} {data.deliveryHasElevator ? '(Elevator)' : '(No elevator)'}</Text>}
              </View>
            )}
          </Card>
        )}

        {isJob && data.clientPackage?.label && (
          <Card style={{ marginTop: 14 }}>
            <Text style={ss.cardTitle}>Package</Text>
            <DetailRow icon="box" label="Package" value={data.clientPackage.label} />
            {data.clientPackage.agreedPrice > 0 && (
              <DetailRow icon="dollar-sign" label="Price" value={`AED ${data.clientPackage.agreedPrice.toLocaleString()}`} />
            )}
          </Card>
        )}

        {isJob && data.images?.length > 0 && (
          <Card style={{ marginTop: 14 }}>
            <Text style={ss.cardTitle}>Photos ({data.images.length})</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
              {data.images.map((img: any, i: number) => (
                <Image key={i} source={{ uri: img.url }} style={ss.thumb} />
              ))}
            </ScrollView>
          </Card>
        )}

        {data.notes && (
          <Card style={{ marginTop: 14 }}>
            <Text style={ss.cardTitle}>Notes</Text>
            <Text style={ss.detailValue}>{data.notes}</Text>
          </Card>
        )}

        {isJob && data.timeline?.length > 0 && (
          <Card style={{ marginTop: 14 }}>
            <Text style={ss.cardTitle}>Timeline</Text>
            {data.timeline.map((t: any, i: number) => (
              <View key={i} style={ss.timelineRow}>
                <View style={ss.timelineDot} />
                <View style={{ flex: 1 }}>
                  <Text style={ss.detailValue}>{t.action}</Text>
                  <Text style={ss.detailMeta}>{new Date(t.date).toLocaleString()}</Text>
                </View>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

function DetailRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={ss.detailRow}>
      <Icon name={icon as any} size={15} color={C.ink3} />
      <Text style={ss.detailLabel}>{label}</Text>
      <Text style={[ss.detailValue, { flex: 1, textAlign: 'right' }]}>{value}</Text>
    </View>
  );
}

/* ─── BOOKING WIZARD ─── */
const PROPERTY_TYPES = [
  { key: 'apartment', icon: 'home', label: 'Apartment' },
  { key: 'villa', icon: 'home', label: 'Villa' },
  { key: 'office', icon: 'briefcase', label: 'Office' },
  { key: 'studio', icon: 'square', label: 'Studio' },
];

const PROPERTY_SIZES = [
  'Studio', '1 BHK', '2 BHK', '3 BHK', '4 BHK', '5+ BHK',
];

const PHOTO_CATEGORIES = [
  'Living Room', 'Bedrooms', 'Kitchen', 'Bathrooms', 'Balcony', 'Storage / Boxes', 'Other',
];

type BookingData = {
  propertyType: string;
  propertySize: string;
  pickupAddress: string;
  deliveryAddress: string;
  moveDate: string;
  photos: { category: string; uri: string; name: string; type: string }[];
  instructions: string;
};

const STEPS = ['Property', 'Details', 'Photos', 'Instructions', 'Review'];

function BookingScreen() {
  const { go } = useApp();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<BookingData>({
    propertyType: '',
    propertySize: '',
    pickupAddress: '',
    deliveryAddress: '',
    moveDate: '',
    photos: [],
    instructions: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const update = (patch: Partial<BookingData>) => setData(prev => ({ ...prev, ...patch }));
  const canNext = () => {
    if (step === 0) return !!data.propertyType;
    if (step === 1) return !!data.pickupAddress;
    return true;
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      await api.requestMove({
        propertyType: data.propertyType,
        propertySize: data.propertySize,
        moveDate: data.moveDate || undefined,
        pickupAddress: data.pickupAddress,
        deliveryAddress: data.deliveryAddress,
        instructions: data.instructions,
      });
      go('bookingSubmitted');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={ss.fill}>
      <TopBar
        title="Request a Move"
        onBack={() => step > 0 ? setStep(step - 1) : go('hub')}
      />

      {/* Progress */}
      <View style={ss.progress}>
        {STEPS.map((label, i) => (
          <View key={i} style={ss.progressItem}>
            <View style={[ss.progressDot, i <= step && ss.progressDotActive]} />
            <Text style={[ss.progressLabel, i <= step && ss.progressLabelActive]}>{label}</Text>
          </View>
        ))}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 120 }}>
          {step === 0 && <StepProperty data={data} update={update} />}
          {step === 1 && <StepDetails data={data} update={update} />}
          {step === 2 && <StepPhotos data={data} update={update} />}
          {step === 3 && <StepInstructions data={data} update={update} />}
          {step === 4 && <StepReview data={data} />}
        </ScrollView>
      </KeyboardAvoidingView>

      <Footer>
        {step < 4 ? (
          <PrimaryButton
            label="Continue"
            icon="arrow-right"
            onPress={() => setStep(step + 1)}
            disabled={!canNext()}
          />
        ) : (
          <PrimaryButton
            label={submitting ? 'Submitting...' : 'Submit Request'}
            icon="check"
            onPress={submit}
            disabled={submitting}
          />
        )}
      </Footer>
    </View>
  );
}

function StepProperty({ data, update }: { data: BookingData; update: (p: Partial<BookingData>) => void }) {
  return (
    <View>
      <Text style={ss.stepTitle}>Property Type</Text>
      <Text style={ss.stepSub}>What type of property are you moving from?</Text>
      <View style={ss.typeGrid}>
        {PROPERTY_TYPES.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[ss.typeCard, data.propertyType === t.key && ss.typeCardActive]}
            activeOpacity={0.8}
            onPress={() => update({ propertyType: t.key })}
          >
            <Icon name={t.icon as any} size={28} color={data.propertyType === t.key ? C.purple : C.ink3} />
            <Text style={[ss.typeLabel, data.propertyType === t.key && { color: C.purple }]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={[ss.stepTitle, { marginTop: 24 }]}>Property Size</Text>
      <View style={ss.chipRow}>
        {PROPERTY_SIZES.map((size) => (
          <TouchableOpacity
            key={size}
            style={[ss.chip, data.propertySize === size && ss.chipActive]}
            activeOpacity={0.8}
            onPress={() => update({ propertySize: size })}
          >
            <Text style={[ss.chipTxt, data.propertySize === size && ss.chipTxtActive]}>{size}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function StepDetails({ data, update }: { data: BookingData; update: (p: Partial<BookingData>) => void }) {
  return (
    <View>
      <Text style={ss.stepTitle}>Move Details</Text>
      <Text style={ss.stepSub}>Where are you moving from and to?</Text>

      <Text style={[ss.label, { marginTop: 16 }]}>Pickup Address *</Text>
      <TextInput
        style={[ss.input, { minHeight: 60 }]}
        value={data.pickupAddress}
        onChangeText={t => update({ pickupAddress: t })}
        placeholder="Enter your current address"
        placeholderTextColor={C.faint}
        multiline
      />

      <Text style={[ss.label, { marginTop: 16 }]}>Delivery Address</Text>
      <TextInput
        style={[ss.input, { minHeight: 60 }]}
        value={data.deliveryAddress}
        onChangeText={t => update({ deliveryAddress: t })}
        placeholder="Enter your new address"
        placeholderTextColor={C.faint}
        multiline
      />

      <Text style={[ss.label, { marginTop: 16 }]}>Preferred Move Date</Text>
      <TextInput
        style={ss.input}
        value={data.moveDate}
        onChangeText={t => update({ moveDate: t })}
        placeholder="e.g. 2026-08-01"
        placeholderTextColor={C.faint}
      />
    </View>
  );
}

function StepPhotos({ data, update }: { data: BookingData; update: (p: Partial<BookingData>) => void }) {
  const pickImage = async (category: string) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.7,
    });
    if (result.canceled) return;
    const newPhotos = result.assets.map((a, i) => ({
      category,
      uri: a.uri,
      name: `${category.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}_${i}.jpg`,
      type: 'image/jpeg',
    }));
    update({ photos: [...data.photos, ...newPhotos] });
  };

  const removePhoto = (idx: number) => {
    update({ photos: data.photos.filter((_, i) => i !== idx) });
  };

  return (
    <View>
      <Text style={ss.stepTitle}>Photos</Text>
      <Text style={ss.stepSub}>Add photos of each room for a more accurate quote (optional)</Text>

      {PHOTO_CATEGORIES.map((cat) => {
        const catPhotos = data.photos.map((p, i) => ({ ...p, _idx: i })).filter(p => p.category === cat);
        return (
          <View key={cat} style={ss.photoCat}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={ss.photoCatTitle}>{cat}</Text>
              <TouchableOpacity onPress={() => pickImage(cat)} style={ss.addPhotoBtn}>
                <Icon name="plus" size={14} color={C.purple} />
                <Text style={{ fontFamily: F.semi, fontSize: 12, color: C.purple }}>Add</Text>
              </TouchableOpacity>
            </View>
            {catPhotos.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                {catPhotos.map((p) => (
                  <View key={p._idx} style={ss.photoThumbWrap}>
                    <Image source={{ uri: p.uri }} style={ss.photoThumb} />
                    <TouchableOpacity style={ss.photoRemove} onPress={() => removePhoto(p._idx)}>
                      <Icon name="x" size={12} color={C.white} />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        );
      })}
    </View>
  );
}

function StepInstructions({ data, update }: { data: BookingData; update: (p: Partial<BookingData>) => void }) {
  return (
    <View>
      <Text style={ss.stepTitle}>Special Instructions</Text>
      <Text style={ss.stepSub}>Any details we should know about your move?</Text>

      <TextInput
        style={[ss.input, { minHeight: 120, textAlignVertical: 'top', marginTop: 16 }]}
        value={data.instructions}
        onChangeText={t => update({ instructions: t })}
        placeholder="e.g. Fragile items, piano, pets, parking restrictions, preferred time..."
        placeholderTextColor={C.faint}
        multiline
      />
    </View>
  );
}

function StepReview({ data }: { data: BookingData }) {
  return (
    <View>
      <Text style={ss.stepTitle}>Review & Submit</Text>
      <Text style={ss.stepSub}>Please review your move request details</Text>

      <Card style={{ marginTop: 16 }}>
        <ReviewRow label="Property Type" value={data.propertyType || '—'} />
        <ReviewRow label="Property Size" value={data.propertySize || '—'} />
        <ReviewRow label="Pickup" value={data.pickupAddress || '—'} />
        <ReviewRow label="Delivery" value={data.deliveryAddress || '—'} />
        <ReviewRow label="Move Date" value={data.moveDate || 'TBD'} />
        <ReviewRow label="Photos" value={`${data.photos.length} photo(s)`} />
        {!!data.instructions && <ReviewRow label="Instructions" value={data.instructions} />}
      </Card>
    </View>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={ss.reviewRow}>
      <Text style={ss.reviewLabel}>{label}</Text>
      <Text style={ss.reviewValue}>{value}</Text>
    </View>
  );
}

/* ─── BOOKING SUBMITTED ─── */
function BookingSubmittedScreen() {
  const { go } = useApp();
  return (
    <View style={[ss.fill, { alignItems: 'center', justifyContent: 'center', padding: 30 }]}>
      <View style={ss.successCircle}>
        <Icon name="check" size={40} color={C.white} />
      </View>
      <Text style={[ss.loginTitle, { marginTop: 24 }]}>Request Submitted!</Text>
      <Text style={[ss.loginSub, { marginTop: 8, textAlign: 'center' }]}>
        Our team will review your request and get back to you with a quote shortly.
      </Text>
      <PrimaryButton label="Back to Home" onPress={() => go('hub')} style={{ marginTop: 32, width: 200 }} />
      <OutlineButton label="View My Moves" onPress={() => go('history')} style={{ marginTop: 12, width: 200 }} />
    </View>
  );
}

/* ─── PROFILE ─── */
function ProfileScreen() {
  const { s, logout, updateProfile } = useApp();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(s.customer?.fullName || '');
  const [email, setEmail] = useState(s.customer?.email || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.updateProfile({ fullName: name, email });
      updateProfile({ ...s.customer!, fullName: res.customer.fullName, email: res.customer.email });
      setEditing(false);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    setToken(null);
    logout();
  };

  return (
    <View style={ss.fill}>
      <TopBar title="Profile" />
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 120 }}>
        <Card>
          <View style={{ alignItems: 'center', paddingVertical: 10 }}>
            <View style={ss.avatarCircle}>
              <Icon name="user" size={32} color={C.purple} />
            </View>
            <Text style={ss.profileName}>{s.customer?.fullName || 'Customer'}</Text>
            <Text style={ss.profilePhone}>{s.customer?.phone}</Text>
          </View>
        </Card>

        <Card style={{ marginTop: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <Text style={ss.cardTitle}>Personal Information</Text>
            {!editing && (
              <TouchableOpacity onPress={() => setEditing(true)}>
                <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.purple }}>Edit</Text>
              </TouchableOpacity>
            )}
          </View>

          {editing ? (
            <>
              <Text style={ss.label}>Full Name</Text>
              <TextInput style={ss.input} value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={C.faint} />
              <Text style={[ss.label, { marginTop: 12 }]}>Email</Text>
              <TextInput style={ss.input} value={email} onChangeText={setEmail} placeholder="Your email" placeholderTextColor={C.faint} keyboardType="email-address" />
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                <OutlineButton label="Cancel" onPress={() => { setEditing(false); setName(s.customer?.fullName || ''); setEmail(s.customer?.email || ''); }} style={{ flex: 1 }} />
                <PrimaryButton label={saving ? 'Saving...' : 'Save'} onPress={handleSave} disabled={saving} style={{ flex: 1 }} />
              </View>
            </>
          ) : (
            <>
              <ProfileRow icon="user" label="Name" value={s.customer?.fullName || 'Not set'} />
              <ProfileRow icon="phone" label="Phone" value={s.customer?.phone || ''} />
              <ProfileRow icon="mail" label="Email" value={s.customer?.email || 'Not set'} />
            </>
          )}
        </Card>

        <TouchableOpacity style={ss.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
          <Icon name="log-out" size={18} color={C.red} />
          <Text style={ss.logoutTxt}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
      <BottomNav />
    </View>
  );
}

function ProfileRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={ss.profileRow}>
      <Icon name={icon as any} size={16} color={C.ink3} />
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={ss.detailLabel}>{label}</Text>
        <Text style={ss.detailValue}>{value}</Text>
      </View>
    </View>
  );
}

/* ─── STYLES ─── */
const ss = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.paper },
  px: { paddingHorizontal: 18 },

  // Login
  loginWrap: { paddingHorizontal: 28, alignItems: 'center' },
  logoCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  loginTitle: { fontFamily: F.displayXB, fontSize: 28, color: C.ink },
  loginSub: { fontFamily: F.reg, fontSize: 15, color: C.ink3, marginTop: 6 },
  label: { fontFamily: F.semi, fontSize: 13, color: C.ink2, marginBottom: 6 },
  input: {
    height: 52, borderRadius: 14, borderWidth: 1.5, borderColor: C.line,
    backgroundColor: C.white, paddingHorizontal: 16, fontFamily: F.reg, fontSize: 15, color: C.ink,
  },
  errorTxt: { fontFamily: F.med, fontSize: 13, color: C.red, marginTop: 6 },

  // Hub
  hubGreeting: { fontFamily: F.displayXB, fontSize: 26, color: C.ink },
  hubSub: { fontFamily: F.reg, fontSize: 15, color: C.ink3, marginTop: 4 },
  ctaCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    marginHorizontal: 18, marginTop: 22, padding: 20, borderRadius: 18,
    backgroundColor: C.purple,
    shadowColor: C.purple, shadowOpacity: 0.3, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 6,
  },
  ctaIcon: { width: 52, height: 52, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  ctaTitle: { fontFamily: F.bold, fontSize: 17, color: C.white },
  ctaSub: { fontFamily: F.reg, fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  quickAction: { flex: 1, alignItems: 'center', padding: 18, borderRadius: 16, backgroundColor: C.white, borderWidth: 1, borderColor: C.line2 },
  quickIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  quickLabel: { fontFamily: F.semi, fontSize: 13, color: C.ink },
  sectionTitle: { fontFamily: F.display, fontSize: 17, color: C.ink },

  // Move cards
  moveCard: {
    marginHorizontal: 18, marginTop: 10, padding: 16, borderRadius: 14,
    backgroundColor: C.white, borderWidth: 1, borderColor: C.line2,
  },
  moveCardTitle: { fontFamily: F.semi, fontSize: 15, color: C.ink },
  addrRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  addrTxt: { fontFamily: F.reg, fontSize: 13, color: C.ink2, flex: 1 },
  moveDate: { fontFamily: F.med, fontSize: 12, color: C.ink3, marginTop: 8 },

  // Empty
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  emptyTxt: { fontFamily: F.med, fontSize: 16, color: C.ink3, marginTop: 12 },

  // Detail
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  detailLabel: { fontFamily: F.med, fontSize: 13, color: C.ink3 },
  detailValue: { fontFamily: F.reg, fontSize: 14, color: C.ink },
  detailMeta: { fontFamily: F.reg, fontSize: 12, color: C.ink3, marginTop: 2 },
  cardTitle: { fontFamily: F.semi, fontSize: 15, color: C.ink },
  thumb: { width: 72, height: 72, borderRadius: 10, marginRight: 8 },
  timelineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.line2, marginTop: 4 },
  timelineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.purple, marginTop: 5 },

  // Booking
  progress: { flexDirection: 'row', paddingHorizontal: 18, paddingVertical: 10, gap: 4 },
  progressItem: { flex: 1, alignItems: 'center', gap: 4 },
  progressDot: { width: '100%', height: 3, borderRadius: 2, backgroundColor: C.line },
  progressDotActive: { backgroundColor: C.purple },
  progressLabel: { fontFamily: F.med, fontSize: 9, color: C.faint },
  progressLabelActive: { color: C.purple, fontFamily: F.semi },
  stepTitle: { fontFamily: F.display, fontSize: 20, color: C.ink },
  stepSub: { fontFamily: F.reg, fontSize: 14, color: C.ink3, marginTop: 4 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 16 },
  typeCard: {
    width: (Dimensions.get('window').width - 48 - 12) / 2,
    padding: 20, borderRadius: 16, alignItems: 'center', gap: 10,
    backgroundColor: C.white, borderWidth: 1.5, borderColor: C.line,
  },
  typeCardActive: { borderColor: C.purple, backgroundColor: C.purpleLite },
  typeLabel: { fontFamily: F.semi, fontSize: 14, color: C.ink },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: C.white, borderWidth: 1.5, borderColor: C.line },
  chipActive: { borderColor: C.purple, backgroundColor: C.purpleLite },
  chipTxt: { fontFamily: F.semi, fontSize: 13, color: C.ink2 },
  chipTxtActive: { color: C.purple },

  // Photos
  photoCat: { marginTop: 16, padding: 14, borderRadius: 14, backgroundColor: C.white, borderWidth: 1, borderColor: C.line2 },
  photoCatTitle: { fontFamily: F.semi, fontSize: 14, color: C.ink },
  addPhotoBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: C.purpleLite },
  photoThumbWrap: { position: 'relative', marginRight: 8 },
  photoThumb: { width: 68, height: 68, borderRadius: 10 },
  photoRemove: { position: 'absolute', top: -4, right: -4, width: 22, height: 22, borderRadius: 11, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' },

  // Review
  reviewRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line2 },
  reviewLabel: { fontFamily: F.med, fontSize: 12, color: C.ink3 },
  reviewValue: { fontFamily: F.reg, fontSize: 14, color: C.ink, marginTop: 2 },

  // Success
  successCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },

  // Profile
  avatarCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.purpleLite, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  profileName: { fontFamily: F.display, fontSize: 20, color: C.ink },
  profilePhone: { fontFamily: F.reg, fontSize: 14, color: C.ink3, marginTop: 2 },
  profileRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line2 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 24, padding: 16, borderRadius: 14, backgroundColor: C.redBg },
  logoutTxt: { fontFamily: F.semi, fontSize: 15, color: C.red },
});
