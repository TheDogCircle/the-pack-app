import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../lib/theme';
import { useSession } from '../hooks/useSession';
import { useNonLus } from '../lib/nonLus';
import { usePastillesActives } from '../lib/pastilles';

// Bulle "Messages" en haut a droite des ecrans principaux (Carte, Meute, Events,
// Partenaires, Profil), avec le nombre de conversations non lues.
export default function BulleMessages({ navigation }: { navigation: any }) {
  const { session } = useSession();
  const userId = session?.user?.id ?? null;
  const n = useNonLus(userId);
  const pastilles = usePastillesActives();
  if (!userId) return null;
  return (
    <TouchableOpacity
      style={st.btn}
      onPress={() => navigation.navigate('Messages')}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityLabel={n ? `Messages, ${n} conversation${n > 1 ? 's' : ''} non lue${n > 1 ? 's' : ''}` : 'Messages'}
    >
      <Ionicons name="chatbubble-ellipses-outline" size={22} color={colors.ivory} />
      {pastilles && n > 0 ? (
        <View style={st.badge}>
          <Text style={st.badgeText}>{n > 9 ? '9+' : n}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const st = StyleSheet.create({
  btn: { marginRight: 12, width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute', top: -3, right: -6, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
    backgroundColor: '#E5484D', borderWidth: 1.5, borderColor: colors.bordeaux,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontFamily: 'DMSans_500Medium', fontSize: 10, lineHeight: 12 },
});
