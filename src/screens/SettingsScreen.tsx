import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Switch,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';

export default function SettingsScreen() {
  const navigation = useNavigation<any>();
  const [username, setUsername] = useState('');
  const [currentUsername, setCurrentUsername] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);
  const [notifsCommunaute, setNotifsCommunaute] = useState(true);
  const [notifsActu, setNotifsActu] = useState(true);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => { init(); }, []);

  async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }
    setUserId(session.user.id);
    const { data } = await supabase.from('profils').select('username').eq('id', session.user.id).single();
    if (data?.username) { setUsername(data.username); setCurrentUsername(data.username); }
    setLoading(false);
  }

  async function saveUsername() {
    if (!userId || !username.trim()) return;
    const clean = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (clean.length < 3) { Alert.alert('Trop court', 'Le nom d\'utilisateur doit faire au moins 3 caractères.'); return; }
    setSavingUsername(true);
    const { error } = await supabase.from('profils').update({ username: clean }).eq('id', userId);
    setSavingUsername(false);
    if (error) {
      if (error.message.includes('unique') || error.code === '23505') {
        Alert.alert('Déjà pris', 'Ce nom d\'utilisateur est déjà utilisé.');
      } else {
        Alert.alert('Erreur', error.message);
      }
      return;
    }
    setCurrentUsername(clean);
    setUsername(clean);
    Alert.alert('Enregistré', `Ton username est maintenant @${clean}`);
  }

  async function confirmLogout() {
    Alert.alert('Déconnexion', 'Tu vas être déconnecté(e).', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Déconnecter', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);
  }

  async function confirmDeleteAccount() {
    Alert.alert(
      'Supprimer mon compte',
      'Cette action est irréversible. Toutes tes données (avis, favoris, photos) seront supprimées.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer', style: 'destructive', onPress: async () => {
          if (!userId) return;
          await supabase.from('profils').delete().eq('id', userId);
          await supabase.auth.signOut();
        }},
      ]
    );
  }

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={colors.terra} />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Username */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Nom d'utilisateur</Text>
        <View style={styles.usernameRow}>
          <Text style={styles.atSign}>@</Text>
          <TextInput
            style={styles.usernameInput}
            value={username}
            onChangeText={setUsername}
            placeholder="mon_username"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <Text style={styles.usernameHint}>Lettres minuscules, chiffres et _ uniquement. Min. 3 caractères.</Text>
        {username !== currentUsername && (
          <TouchableOpacity style={styles.saveBtn} onPress={saveUsername} disabled={savingUsername}>
            {savingUsername
              ? <ActivityIndicator color={colors.ivory} size="small" />
              : <Text style={styles.saveBtnText}>Enregistrer</Text>}
          </TouchableOpacity>
        )}
      </View>

      {/* Notifications */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifications</Text>
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Activité de la communauté</Text>
            <Text style={styles.toggleSub}>Nouveaux abonnés, mentions</Text>
          </View>
          <Switch
            value={notifsCommunaute}
            onValueChange={setNotifsCommunaute}
            trackColor={{ false: colors.border, true: colors.terra + '88' }}
            thumbColor={notifsCommunaute ? colors.terra : '#f4f4f4'}
          />
        </View>
        <View style={[styles.toggleRow, { borderBottomWidth: 0 }]}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Actualités partenaires</Text>
            <Text style={styles.toggleSub}>Nouvelles offres et annonces</Text>
          </View>
          <Switch
            value={notifsActu}
            onValueChange={setNotifsActu}
            trackColor={{ false: colors.border, true: colors.terra + '88' }}
            thumbColor={notifsActu ? colors.terra : '#f4f4f4'}
          />
        </View>
      </View>

      {/* Compte */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Mon compte</Text>
        <TouchableOpacity style={styles.menuRow} onPress={confirmLogout}>
          <Ionicons name="log-out-outline" size={20} color={colors.bordeaux} />
          <Text style={styles.menuRowText}>Se déconnecter</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.menuRow, styles.menuRowDanger, { borderBottomWidth: 0 }]} onPress={confirmDeleteAccount}>
          <Ionicons name="trash-outline" size={20} color="#C62828" />
          <Text style={[styles.menuRowText, { color: '#C62828' }]}>Supprimer mon compte</Text>
          <Ionicons name="chevron-forward" size={16} color="#C62828" />
        </TouchableOpacity>
      </View>

      {/* Infos */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>À propos</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Version</Text>
          <Text style={styles.infoValue}>1.0.0</Text>
        </View>
        <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
          <Text style={styles.infoLabel}>Développé par</Text>
          <Text style={styles.infoValue}>The Pack Club</Text>
        </View>
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivoryPale },
  content: { padding: 16, gap: 20, paddingBottom: 48 },
  section: {
    backgroundColor: colors.white, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  sectionTitle: {
    fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  usernameRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 16, paddingTop: 12,
  },
  atSign: { fontFamily: 'DMSans_500Medium', fontSize: 16, color: colors.bordeaux },
  usernameInput: {
    flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 16, color: colors.bordeaux,
    borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 8,
  },
  usernameHint: {
    fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted,
    paddingHorizontal: 16, paddingBottom: 12, marginTop: 6,
  },
  saveBtn: {
    backgroundColor: colors.terra, margin: 16, marginTop: 0,
    borderRadius: 12, padding: 14, alignItems: 'center',
  },
  saveBtnText: { fontFamily: 'DMSans_500Medium', color: colors.ivory, fontSize: 14 },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  toggleInfo: { flex: 1, marginRight: 12 },
  toggleLabel: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
  toggleSub: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, marginTop: 1 },
  menuRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  menuRowDanger: {},
  menuRowText: { fontFamily: 'DMSans_400Regular', fontSize: 15, color: colors.bordeaux, flex: 1 },
  infoRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  infoLabel: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.textMuted },
  infoValue: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
});
