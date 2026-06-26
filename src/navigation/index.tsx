import React, { useEffect, useState } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

import { useSession } from '../hooks/useSession';
import AuthScreen from '../screens/AuthScreen';
import CarteScreen from '../screens/CarteScreen';
import FeedScreen from '../screens/FeedScreen';
import PartenairesScreen from '../screens/PartenairesScreen';
import ProfilScreen from '../screens/ProfilScreen';
import ProfilPublicScreen from '../screens/ProfilPublicScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { colors } from '../lib/theme';

export type RootStackParamList = {
  Tabs: undefined;
  Auth: undefined;
  ProfilPublic: { userId: string; prenom: string; avatarUrl?: string };
  Settings: undefined;
};

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator<RootStackParamList>();

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];
const TAB_ICONS: Record<string, { active: IoniconsName; inactive: IoniconsName }> = {
  Carte:       { active: 'map',           inactive: 'map-outline' },
  Meute:       { active: 'people',        inactive: 'people-outline' },
  Partenaires: { active: 'pricetag',      inactive: 'pricetag-outline' },
  Profil:      { active: 'person-circle', inactive: 'person-circle-outline' },
};

function MainTabs() {
  const { session } = useSession();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!session) { setAvatarUrl(null); return; }
    supabase.from('profils').select('avatar_url').eq('id', session.user.id).single()
      .then(({ data }) => setAvatarUrl(data?.avatar_url ?? null));
  }, [session?.user.id]);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.bordeaux },
        headerTitleStyle: { color: colors.ivory, fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18 },
        headerTintColor: colors.ivory,
        tabBarStyle: {
          backgroundColor: colors.bordeaux,
          borderTopColor: 'rgba(245,239,224,0.08)',
          paddingBottom: 8, paddingTop: 4, height: 74,
        },
        tabBarActiveTintColor: colors.terraPale,
        tabBarInactiveTintColor: 'rgba(245,239,224,0.45)',
        tabBarLabelStyle: { fontFamily: 'DMSans_500Medium', fontSize: 10, letterSpacing: 0.4 },
        tabBarIcon: ({ focused, color }) => {
          if (route.name === 'Profil' && avatarUrl) {
            return (
              <Image
                source={{ uri: avatarUrl }}
                style={{
                  width: 26, height: 26, borderRadius: 13,
                  borderWidth: focused ? 2 : 0,
                  borderColor: colors.terraPale,
                }}
              />
            );
          }
          const icons = TAB_ICONS[route.name];
          const name = icons ? (focused ? icons.active : icons.inactive) : 'ellipse-outline';
          return <Ionicons name={name} size={22} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Carte"       component={CarteScreen}       options={{ title: 'Carte' }} />
      <Tab.Screen name="Partenaires" component={PartenairesScreen} options={{ title: 'Partenaires' }} />
      <Tab.Screen name="Meute"       component={FeedScreen}        options={{ title: 'Meute' }} />
      <Tab.Screen name="Profil"      component={ProfilScreen}      options={{ title: 'Mon profil' }} />
    </Tab.Navigator>
  );
}

export default function Navigation() {
  const { loading } = useSession();

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bordeaux, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.terraPale} size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Tabs" component={MainTabs} />
        <Stack.Screen
          name="Auth"
          component={AuthScreen}
          options={{ presentation: 'modal' }}
        />
        <Stack.Screen
          name="ProfilPublic"
          component={ProfilPublicScreen}
          options={{
            headerShown: true, presentation: 'card',
            headerStyle: { backgroundColor: colors.bordeaux },
            headerTintColor: colors.ivory,
            headerTitle: '', headerBackTitle: 'Retour',
          }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            headerShown: true, presentation: 'card',
            headerStyle: { backgroundColor: colors.bordeaux },
            headerTintColor: colors.ivory,
            headerTitle: 'Paramètres',
            headerTitleStyle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.ivory },
            headerBackTitle: 'Retour',
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
