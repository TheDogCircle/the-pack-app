import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../lib/theme';

export default function AuthGate({ navigation, message }: { navigation: any; message?: string }) {
  return (
    <View style={styles.gate}>
      <Ionicons name="paw-outline" size={52} color={colors.border} />
      <Text style={styles.title}>Rejoins la meute !</Text>
      <Text style={styles.sub}>
        {message || 'Crée un compte gratuit pour accéder à toutes les fonctionnalités.'}
      </Text>
      <TouchableOpacity style={styles.btn} onPress={() => navigation.navigate('Auth')}>
        <Text style={styles.btnText}>Se connecter / S'inscrire →</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 16, backgroundColor: colors.ivoryPale },
  title: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 22, color: colors.bordeaux, textAlign: 'center' },
  sub: { fontFamily: 'DMSans_300Light', fontSize: 14, color: colors.textMid, textAlign: 'center', lineHeight: 22 },
  btn: { backgroundColor: colors.bordeaux, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 28, marginTop: 8 },
  btnText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.ivory },
});
