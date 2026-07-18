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
import ExplorerScreen from '../screens/ExplorerScreen';
import EvenementsScreen from '../screens/EvenementsScreen';
import ProfilScreen from '../screens/ProfilScreen';
import ProfilPublicScreen from '../screens/ProfilPublicScreen';
import SettingsScreen from '../screens/SettingsScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import { colors } from '../lib/theme';

export type RootStackParamList = {
  Tabs: undefined;
  Onboarding: undefined;
  Auth: undefined;
  ProfilPublic: { userId: string; prenom: string; avatarUrl?: string };
  Settings: undefined;
};

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator<RootStackParamList>();

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];
const TAB_ICONS: Record<string, { active: IoniconsName; inactive: IoniconsName }> = {
  Explorer:    { active: 'compass',         inactive: 'compass-outline' },
  Carte:       { active: 'map',             inactive: 'map-outline' },
  Events:      { active: 'calendar',        inactive: 'calendar-outline' },
  Meute:       { active: 'people',          inactive: 'people-outline' },
  Services:    { active: 'ribbon',          inactive: 'ribbon-outline' },
  Profil:      { active: 'person-circle',   inactive: 'person-circle-outline' },
};

function MainTabs() {
  const { session } = useSession();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [meuteBadge, setMeuteBadge] = useState(false);
  const [partBadge, setPartBadge] = useState(false);

  useEffect(() => {
    if (!session) { setAvatarUrl(null); return; }
    supabase.from('profils').select('avatar_url').eq('id', session.user.id).single()
      .then(({ data }) => setAvatarUrl(data?.avatar_url ?? null));
    checkBadges(session.user.id);
  }, [session?.user.id]);

  async function checkBadges(userId: string) {
    const since48h = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const since7d  = new Date(Date.now() -  7 * 86400 * 1000).toISOString();

    // Partenaires : nouveaux posts dans les 7 derniers jours
    const { count: partCount } = await supabase
      .from('partenaire_posts').select('id', { count: 'exact', head: true })
      .eq('actif', true).gte('created_at', since7d);
    setPartBadge((partCount ?? 0) > 0);

    // Meute : avis/photos des gens suivis dans les 48h + messages non lus
    const { data: follows } = await supabase
      .from('follows').select('following_id')
      .eq('follower_id', userId).eq('statut', 'accepte');
    let meuteHasActivity = false;
    if (follows?.length) {
      const ids = follows.map((f: any) => f.following_id);
      const [{ count: a }, { count: p }] = await Promise.all([
        supabase.from('avis').select('id', { count: 'exact', head: true }).in('user_id', ids).gte('created_at', since48h),
        supabase.from('photos').select('id', { count: 'exact', head: true }).in('user_id', ids).eq('validee', true).gte('created_at', since48h),
      ]);
      meuteHasActivity = ((a ?? 0) + (p ?? 0)) > 0;
    }

    // Messages non lus : messages des autres dans mes conversations dans les 24h
    const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: myConvs } = await supabase
      .from('conversation_members').select('conversation_id').eq('user_id', userId);
    if (myConvs?.length) {
      const convIds = myConvs.map((r: any) => r.conversation_id);
      const { count: msgCount } = await supabase
        .from('messages').select('id', { count: 'exact', head: true })
        .in('conversation_id', convIds)
        .neq('user_id', userId)
        .gte('created_at', since24h);
      if ((msgCount ?? 0) > 0) meuteHasActivity = true;
    }

    setMeuteBadge(meuteHasActivity);
  }

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
        tabBarBadgeStyle: { minWidth: 8, height: 8, borderRadius: 4, padding: 0, top: 2, right: 2, backgroundColor: colors.terra },
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
      <Tab.Screen name="Carte"      component={CarteScreen}      options={{ title: 'Carte' }} />
      <Tab.Screen name="Explorer"   component={ExplorerScreen}   options={{ title: 'Explorer', headerShown: false }} />
      <Tab.Screen
        name="Meute" component={FeedScreen}
        options={{ title: 'Meute', tabBarBadge: meuteBadge ? ' ' : undefined }}
        listeners={{ focus: () => setMeuteBadge(false) }}
      />
      <Tab.Screen name="Events" component={EvenementsScreen} options={{ title: 'Events' }} />
      <Tab.Screen
        name="Services" component={PartenairesScreen}
        options={{ title: 'Partenaires', tabBarBadge: partBadge ? ' ' : undefined }}
        listeners={{ focus: () => setPartBadge(false) }}
      />
      <Tab.Screen name="Profil" component={ProfilScreen} options={{ title: 'Mon profil' }} />
    </Tab.Navigator>
  );
}

export default function Navigation() {
  const { session, loading } = useSession();
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    if (!session) {
      setNeedsOnboarding(false);
      setOnboardingChecked(true);
      return;
    }
    setOnboardingChecked(false);
    supabase.from('profils').select('prenom').eq('id', session.user.id).maybeSingle()
      .then(({ data }) => {
        setNeedsOnboarding(!data?.prenom);
        setOnboardingChecked(true);
      });
  }, [session?.user.id]);

  if (loading || (session && !onboardingChecked)) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bordeaux, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.terraPale} size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator
        screenOptions={{ headerShown: false }}
        initialRouteName={session && needsOnboarding ? 'Onboarding' : 'Tabs'}
      >
        <Stack.Screen name="Tabs" component={MainTabs} />
        <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ gestureEnabled: false }} />
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
