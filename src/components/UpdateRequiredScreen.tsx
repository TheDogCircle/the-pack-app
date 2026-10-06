import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Image } from 'react-native';
import { colors } from '../lib/theme';
import { getStoreUrl } from '../lib/versionCheck';

// Plein ecran, pas de bouton "fermer" : la version installee est sous le
// minimum requis (app_settings.min_app_version), il faut forcer la mise a
// jour avant de pouvoir continuer.
export default function UpdateRequiredScreen() {
  return (
    <View style={styles.container}>
      <Image source={require('../../assets/splash-icon.png')} style={styles.logo} resizeMode="contain" />
      <Text style={styles.title}>Mise à jour nécessaire</Text>
      <Text style={styles.body}>
        Une nouvelle version de The Pack La Meute est disponible et corrige des problèmes importants.
        Mets à jour l'application pour continuer.
      </Text>
      <TouchableOpacity style={styles.btn} onPress={() => Linking.openURL(getStoreUrl())} activeOpacity={0.85}>
        <Text style={styles.btnText}>Mettre à jour</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bordeaux, alignItems: 'center', justifyContent: 'center', padding: 32 },
  logo: { width: 110, height: 110, borderRadius: 55, marginBottom: 28 },
  title: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 22, color: colors.ivory, textAlign: 'center', marginBottom: 12 },
  body: { fontSize: 14, color: colors.ivory, opacity: 0.85, textAlign: 'center', lineHeight: 20, marginBottom: 28 },
  btn: { backgroundColor: colors.terra, paddingVertical: 14, paddingHorizontal: 32, borderRadius: 14 },
  btnText: { color: colors.ivory, fontSize: 15, fontFamily: 'DMSans_500Medium' },
});
