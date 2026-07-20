import 'react-native-gesture-handler';
import React, { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AppState, AppStateStatus, View } from 'react-native';
import { useFonts } from 'expo-font';
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
import * as Notifications from 'expo-notifications';
import * as Updates from 'expo-updates';
import Navigation, { navigationRef } from './src/navigation';
import { mapNavigation } from './src/lib/mapNavigation';
import { clearBadge } from './src/lib/notifications';

async function checkForOTAUpdate() {
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

    // Efface le badge dès que l'app revient au premier plan
    const appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && next === 'active') {
        clearBadge();
      }
      appStateRef.current = next;
    });

    // Gère le tap sur une notification (app en arrière-plan ou fermée)
    const responseSub = Notifications.addNotificationResponseReceivedListener(response => {
      clearBadge();
      const data = response.notification.request.content.data as any;
      if (!navigationRef.isReady()) return;

      if ((data?.type === 'new_lieu' && data?.lieuId) ||
          (data?.type === 'suggestion_validee' && data?.lieu_id)) {
        const lieuId = data?.lieuId ?? data?.lieu_id;
        mapNavigation.setPendingLieu(lieuId);
        navigationRef.navigate('Tabs', { screen: 'Carte' } as any);
      } else if (data?.type === 'follow' && data?.userId) {
        navigationRef.navigate('ProfilPublic', { userId: data.userId, prenom: '' });
      } else if (data?.conversationId) {
        navigationRef.navigate('Tabs', { screen: 'Meute' } as any);
      }
    });

    return () => {
      appStateSub.remove();
      responseSub.remove();
    };
  }, []);

  const [fontsLoaded] = useFonts({
    PlayfairDisplay_400Regular,
    PlayfairDisplay_400Regular_Italic,
    PlayfairDisplay_500Medium,
    DMSans_300Light,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: '#3D1A1A' }} />;

  return (
    <>
      <StatusBar style="light" />
      <Navigation />
    </>
  );
}
