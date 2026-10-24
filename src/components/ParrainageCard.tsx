import React, { useCallback, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Image, ScrollView, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { track } from '../lib/tracking';
import { colors } from '../lib/theme';
import { ParrainBadge, PALIERS_PARRAINAGE } from './AmbassadeurBadge';
import InviteSheet from './InviteSheet';

type Membre = { id: string; prenom: string | null; username: string | null; avatar_url: string | null; nom_chien?: string | null; statut?: string };

type MonParrainage = {
  code: string;
  username: string | null;
  nb_valides: number;
  nb_en_attente: number;
  palier: number;
  peut_saisir: boolean;
  parrain: Membre | null;
  filleuls: Membre[];
};

const MESSAGES_ERREUR: Record<string, string> = {
  code_inconnu: 'Aucun membre avec ce code ou ce pseudo.',
  soi_meme: 'Tu ne peux pas utiliser ton propre code 😉',
  deja_parraine: 'Tu as déjà un parrain.',
  delai_depasse: "Le code doit être saisi dans les 7 jours qui suivent l'inscription.",
  boucle: 'Cette personne fait déjà partie de ta meute.',
  non_connecte: 'Connecte-toi pour saisir un code.',
};

export default function ParrainageCard() {
  const navigation = useNavigation<any>();
  const [data, setData] = useState<MonParrainage | null>(null);
  const [code, setCode] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [moi, setMoi] = useState<{ prenom: string | null; nom_chien: string | null; avatar_url: string | null } | null>(null);

  const load = useCallback(async () => {
    const { data: res } = await supabase.rpc('mon_parrainage');
    if (res) setData(res as MonParrainage);
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (user) {
      const { data: p } = await supabase.from('profils').select('prenom,nom_chien,avatar_url').eq('id', user.id).maybeSingle();
      setMoi(p || null);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function saisirCode() {
    if (!code.trim()) return;
    setEnvoi(true);
    const { data: resultat, error } = await supabase.rpc('appliquer_code_parrainage', { p_code: code.trim() });
    setEnvoi(false);
    track('parrainage_code_saisi', { source: 'profil', resultat: resultat || 'erreur' });
    if (error) { Alert.alert('Erreur', error.message); return; }
    if (resultat === 'valide' || resultat === 'en_attente') {
      setCode('');
      Alert.alert('Bienvenue dans la meute 🐾', 'Ton parrain et toi vous suivez maintenant mutuellement.');
      load();
      return;
    }
    Alert.alert('Code non appliqué', MESSAGES_ERREUR[resultat as string] || 'Réessaie dans un instant.');
  }

  if (!data) return null;

  const prochain = PALIERS_PARRAINAGE.find(p => data.nb_valides < p.min);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Ionicons name="paw" size={16} color={colors.bordeaux} />
        <Text style={styles.title}>Ma meute</Text>
        <ParrainBadge nbFilleuls={data.nb_valides} size="md" />
      </View>

      <Text style={styles.sub}>
        Invite d'autres propriétaires : ils rejoignent ta meute dès que leur profil est complété.
      </Text>

      <View style={styles.codeRow}>
        <View style={styles.codeBox}>
          <Text style={styles.codeLabel}>Ton code</Text>
          <Text style={styles.code} selectable>{data.code}</Text>
        </View>
        <TouchableOpacity style={styles.shareBtn} onPress={() => setInviteOpen(true)} activeOpacity={0.85}>
          <Ionicons name="share-outline" size={16} color={colors.ivory} />
          <Text style={styles.shareBtnText}>Inviter</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.statsRow}>
        <Text style={styles.stat}>
          <Text style={styles.statNum}>{data.nb_valides}</Text> membre{data.nb_valides > 1 ? 's' : ''}
          {data.nb_en_attente > 0 ? `  ·  ${data.nb_en_attente} en attente` : ''}
        </Text>
        {prochain && (
          <Text style={styles.next}>
            {(() => {
              const reste = prochain.min - data.nb_valides;
              const amis = `${reste} ami${reste > 1 ? 's' : ''}`;
              return data.nb_valides === 0
                ? `Invite ${amis} pour le badge ${prochain.nom} 🏅`
                : `Plus que ${amis} pour le badge ${prochain.nom} 🏅`;
            })()}
          </Text>
        )}
      </View>

      {data.filleuls.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.membres}>
          {data.filleuls.map(f => (
            <TouchableOpacity
              key={f.id}
              style={styles.membre}
              onPress={() => navigation.navigate('ProfilPublic', { userId: f.id, prenom: f.prenom || '' })}
            >
              {f.avatar_url
                ? <Image source={{ uri: f.avatar_url }} style={[styles.avatar, f.statut !== 'valide' && styles.avatarAttente]} />
                : (
                  <View style={[styles.avatar, styles.avatarFallback, f.statut !== 'valide' && styles.avatarAttente]}>
                    <Text style={styles.avatarLetter}>{(f.prenom || '?')[0].toUpperCase()}</Text>
                  </View>
                )}
              <Text style={styles.membreNom} numberOfLines={1}>{f.prenom || f.username || '—'}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {data.parrain && (
        <TouchableOpacity
          style={styles.parrainRow}
          onPress={() => navigation.navigate('ProfilPublic', { userId: data.parrain!.id, prenom: data.parrain!.prenom || '' })}
        >
          <Ionicons name="heart" size={13} color={colors.terra} />
          <Text style={styles.parrainText}>
            Tu fais partie de la meute de {data.parrain.prenom || `@${data.parrain.username}`}
          </Text>
        </TouchableOpacity>
      )}

      {data.peut_saisir && (
        <View style={styles.saisieRow}>
          <TextInput
            style={styles.input}
            placeholder="Code ou pseudo de ton parrain"
            placeholderTextColor={colors.textMuted}
            value={code}
            onChangeText={t => setCode(t.replace(/[^A-Za-z0-9._@-]/g, '').slice(0, 21))}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={saisirCode}
          />
          <TouchableOpacity style={styles.validerBtn} onPress={saisirCode} disabled={envoi || !code}>
            {envoi
              ? <ActivityIndicator size="small" color={colors.bordeaux} />
              : <Text style={styles.validerText}>Valider</Text>}
          </TouchableOpacity>
        </View>
      )}

      <InviteSheet
        visible={inviteOpen}
        onClose={() => setInviteOpen(false)}
        invitant={{
          code: data.code,
          username: data.username,
          prenom: moi?.prenom ?? null,
          nomChien: moi?.nom_chien ?? null,
          avatarUrl: moi?.avatar_url ?? null,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white, borderRadius: 14, padding: 14,
    marginHorizontal: 16, marginBottom: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.bordeaux },
  sub: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, marginTop: 4, lineHeight: 17 },
  codeRow: { flexDirection: 'row', alignItems: 'stretch', gap: 10, marginTop: 12 },
  codeBox: {
    flex: 1, backgroundColor: colors.ivoryLight, borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.terraPale,
  },
  codeLabel: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },
  code: { fontFamily: 'DMSans_500Medium', fontSize: 18, color: colors.bordeaux, letterSpacing: 1.5 },
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.terra, borderRadius: 10, paddingHorizontal: 16,
  },
  shareBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.ivory },
  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  stat: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMid },
  statNum: { fontFamily: 'DMSans_500Medium', color: colors.bordeaux },
  next: { flexShrink: 1, marginLeft: 12, textAlign: 'right', fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted },
  membres: { gap: 12, paddingTop: 12 },
  membre: { alignItems: 'center', width: 54 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarAttente: { opacity: 0.45 },
  avatarFallback: { backgroundColor: colors.terraPale, alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontFamily: 'DMSans_500Medium', fontSize: 16, color: colors.bordeaux },
  membreNom: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMid, marginTop: 4 },
  parrainRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  parrainText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMid },
  saisieRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  input: {
    flex: 1, backgroundColor: colors.ivoryLight, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux,
  },
  validerBtn: {
    justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10,
    borderWidth: 1, borderColor: colors.bordeaux,
  },
  validerText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux },
});
