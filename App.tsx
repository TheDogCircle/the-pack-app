import 'react-native-gesture-handler';
import React, { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AppState, AppStateStatus } from 'react-native';
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
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Navigation from './src/navigation';
import { clearBadge } from './src/lib/notifications';
import { STRIPE_PUBLISHABLE_KEY } from './src/lib/stripeConfig';
import SplashLoader from './src/components/SplashLoader';
import { trackAppOpen, startTrackingFlushLoop } from './src/lib/tracking';

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

// Sans ca, quelqu'un qui ne quitte jamais vraiment l'app (la laisse juste en
// arriere-plan -- le cas le plus frequent) ne redemarre jamais a froid, donc
// ne recupere jamais la mise a jour telechargee par checkForOTAUpdate ci-dessus.
// Contrairement au lancement a froid, un retour au premier plan n'a pas de
// contexte de notification fraichement tapee a perdre : on peut recharger
// sans risque. Question posee par Marine en testant le carnet de sante.
async function checkAndApplyOTAUpdateOnResume() {
  try {
    if (!Updates.isEnabled) return;
    const update = await Updates.checkForUpdateAsync();
    if (update.isAvailable) {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    }
  } catch (_) {}
}

export default function App() {
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    checkForOTAUpdate();
    startTrackingFlushLoop();
    trackAppOpen();

    // Efface le badge dès que l'app revient au premier plan
    const appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && next === 'active') {
        clearBadge();
        trackAppOpen();
        checkAndApplyOTAUpdateOnResume();
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

  if (!fontsLoaded) return <SplashLoader />;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>
          <StatusBar style="light" />
          <Navigation />
        </StripeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
