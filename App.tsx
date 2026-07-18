import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
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
  useEffect(() => {
    checkForOTAUpdate();
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as any;
      if (data?.type === 'new_lieu' && data?.lieuId) {
        mapNavigation.setPendingLieu(data.lieuId);
        if (navigationRef.isReady()) {
          navigationRef.navigate('Tabs', { screen: 'Carte' } as any);
        }
      }
    });
    return () => sub.remove();
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
