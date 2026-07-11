import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import {
  PlusJakartaSans_400Regular, PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import {
  BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold,
} from '@expo-google-fonts/bricolage-grotesque';
import { AppProvider, C } from './src/core';
import { Router } from './src/screens';

export default function App() {
  const [fontsLoaded] = useFonts({
    'Jakarta': PlusJakartaSans_400Regular,
    'Jakarta-Med': PlusJakartaSans_500Medium,
    'Jakarta-Semi': PlusJakartaSans_600SemiBold,
    'Jakarta-Bold': PlusJakartaSans_700Bold,
    'Bricolage': BricolageGrotesque_700Bold,
    'Bricolage-XB': BricolageGrotesque_800ExtraBold,
  });
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <View style={s.root}>
        {fontsLoaded ? <AppProvider><Router /></AppProvider> : (
          <View style={s.loading}><ActivityIndicator color={C.purple} size="large" /></View>
        )}
      </View>
    </SafeAreaProvider>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.paper },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.paper },
});
