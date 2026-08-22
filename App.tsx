import 'react-native-gesture-handler';
import React, { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AppState, AppStateStatus, View } from 'react-native';
import { useFonts } from 'expo-font';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import {
  PlayfairDisplay_400Regular,
  PlayfairDisplay_400Regular_Italic,
  PlayfairDisplay_500Medium,
} from '@expo-google-fonts/playfair-display';
import {
  DMSans_300Light,
  DMSans_400Regular,
  DMSans_500Medium,
} from '@expo-google-fonts/dm-sans';
import * as Updates from 'expo-updates';
import { StripeProvider } from '@stripe/stripe-react-native';
import Navigation from './src/navigation';
import { clearBadge } from './src/lib/notifications';
import { STRIPE_PUBLISHABLE_KEY } from './src/lib/stripeConfig';

async function checkForOTAUpdate() {
  try {
    if (!Updates.isEnabled) return;
    const update = await Updates.checkForUpdateAsync();
    if (update.isAvailable) {
      // On telecharge la mise a jour mais on NE recharge PAS immediatement :
      // un reload en plein lancement (ex: ouverture via une notification) coupe
      // l'ecran et efface le contexte de lancement (notif tapee, lien profond...).
      // La mise a jour telechargee sera utilisee automatiquement au prochain
      // demarrage complet de l'app.
      await Updates.fetchUpdateAsync();
    }
  } catch (_) {}
}

export default function App() {
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    checkForOTAUpdate();

    // Efface le badge dès que l'app revient au premier plan
    const appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && next === 'active') {
        clearBadge();
      }
      appStateRef.current = next;
    });

    // Le tap sur une notification est gere dans src/navigation/index.tsx (un seul
    // gestionnaire, pour eviter deux listeners concurrents avec une logique differente)

    return () => {
      appStateSub.remove();
    };
  }, []);

  const [fontsLoaded] = useFonts({
    PlayfairDisplay_400Regular,
    PlayfairDisplay_400Regular_Italic,
    PlayfairDisplay_500Medium,
    DMSans_300Light,
    DMSans_400Regular,
    DMSans_500Medium,
    ...Ionicons.font,
    ...MaterialCommunityIcons.font,
  });

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: '#3D1A1A' }} />;

  return (
    <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>
      <StatusBar style="light" />
      <Navigation />
    </StripeProvider>
  );
}
