import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { mapNavigation } from '../lib/mapNavigation';
import { BaladeFiche, formatDuree } from '../components/BaladeResume';

// Espace Balades : Top de la semaine (km, calcule cote serveur :
// classement_balades_semaine / mes_stats_balades), historique perso et dernieres
// balades de la meute. Toute balade s'ouvre dans la meme fiche (BaladeFiche),
// aussi utilisee depuis la carte.

type BaladeLigne = {
  id: string; user_id: string; nom: string; distance_km: number | null; duree_secondes: number | null;
  created_at: string; prenom?: string | null; nom_chien?: string | null; avatar_url?: string | null;
};

type Ligne = { rang: number; user_id: string; prenom: string | null; nom_chien: string | null; avatar_url: string | null; km: number; nb: number };
type Stats = { semaine_km: number; semaine_nb: number; rang: number | null; serie_semaines: number; total_km: number; total_nb: number };

const MEDAILLES = ['🥇', '🥈', '🥉'];
const km1 = (v: number) => Number(v).toFixed(1).replace('.', ',');

function finDeSemaine() {
  const d = new Date();
  const jours = (7 - d.getDay()) % 7; // dimanche = 0
  if (jours === 0) return 'Fin ce soir à minuit';
  return jours === 1 ? 'Fin demain à minuit' : `Fin dans ${jours} jours`;
}

export default function ClassementScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const [onglet, setOnglet] = useState<'top' | 'mes' | 'meute'>(route.params?.onglet || 'top');
  const [mesBalades, setMesBalades] = useState<BaladeLigne[] | null>(null);
  const [meuteBalades, setMeuteBalades] = useState<BaladeLigne[] | null>(null);
  const [ficheId, setFicheId] = useState<string | null>(null);
  const [portee, setPortee] = useState<'meute' | 'tous'>('meute');
  const [lignes, setLignes] = useState<Ligne[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [moiId, setMoiId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const charger = useCallback(async (p: 'meute' | 'tous') => {
    const { data: { session } } = await supabase.auth.getSession();
    setMoiId(session?.user.id ?? null);
    const [{ data: cl }, { data: st }] = await Promise.all([
      supabase.rpc('classement_balades_semaine', { p_portee: p }),
      supabase.rpc('mes_stats_balades'),
    ]);
    setLignes((cl as Ligne[]) || []);
    if (st) setStats(st as Stats);
  }, []);

  useFocusEffect(useCallback(() => { charger(portee); }, [portee, charger]));

  const chargerHistoriques = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const champs = 'id,user_id,nom,distance_km,duree_secondes,created_at';
    const { data: follows } = await supabase.from('follows').select('following_id')
      .eq('follower_id', session.user.id).eq('statut', 'accepte');
    const suivis = (follows || []).map((f: any) => f.following_id);
    const [{ data: mes }, { data: meute }] = await Promise.all([
      supabase.from('balades').select(champs).eq('user_id', session.user.id)
        .order('created_at', { ascending: false }).limit(50),
      suivis.length
        ? supabase.from('balades').select(champs).in('user_id', suivis).in('visibilite', ['public', 'abonnes'])
          .order('created_at', { ascending: false }).limit(30)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    setMesBalades((mes as BaladeLigne[]) || []);
    const liste = (meute as BaladeLigne[]) || [];
    if (liste.length) {
      const { data: profs } = await supabase.from('profils').select('id,prenom,nom_chien,avatar_url')
        .in('id', [...new Set(liste.map(b => b.user_id))]);
      const pm: Record<string, any> = {};
      (profs || []).forEach((p: any) => { pm[p.id] = p; });
      setMeuteBalades(liste.map(b => ({ ...b, ...pm[b.user_id], id: b.id })));
    } else setMeuteBalades([]);
  }, []);

  useFocusEffect(useCallback(() => { chargerHistoriques(); }, [chargerHistoriques]));

  function voirSurCarte(id: string) {
    setFicheId(null);
    mapNavigation.setPendingBalade(id);
    navigation.navigate('Tabs', { screen: 'Carte' });
  }

  function LigneBalade({ b, avecAuteur }: { b: BaladeLigne; avecAuteur?: boolean }) {
    const d = new Date(b.created_at);
    return (
      <TouchableOpacity style={styles.ligne} activeOpacity={0.7} onPress={() => setFicheId(b.id)}>
        {avecAuteur ? (
          b.avatar_url
            ? <Image source={{ uri: b.avatar_url }} style={styles.avatar} />
            : <View style={[styles.avatar, styles.avatarVide]}><Text style={styles.avatarLettre}>{(b.prenom || '?')[0].toUpperCase()}</Text></View>
        ) : (
          <View style={[styles.avatar, styles.iconeBalade]}><Ionicons name="footsteps" size={16} color={colors.ivory} /></View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.nom} numberOfLines={1}>{b.nom}</Text>
          <Text style={styles.nb} numberOfLines={1}>
            {avecAuteur ? `${b.prenom || 'Membre'}${b.nom_chien ? ` & ${b.nom_chien}` : ''} · ` : ''}
            {d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
            {b.duree_secondes ? ` · ${formatDuree(b.duree_secondes)}` : ''}
          </Text>
        </View>
        <Text style={styles.km}>{km1(b.distance_km || 0)} <Text style={styles.kmUnite}>km</Text></Text>
      </TouchableOpacity>
    );
  }

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await charger(portee); setRefreshing(false); }} tintColor={colors.terra} />}
    >
      {stats ? (
        <View style={styles.statsCard}>
          <View style={styles.stat}><Text style={styles.statVal}>{km1(stats.semaine_km)}</Text><Text style={styles.statLbl}>km cette semaine</Text></View>
          <View style={styles.stat}><Text style={styles.statVal}>{stats.semaine_nb}</Text><Text style={styles.statLbl}>balade{stats.semaine_nb > 1 ? 's' : ''}</Text></View>
          <View style={styles.stat}><Text style={styles.statVal}>{stats.serie_semaines}{stats.serie_semaines > 1 ? ' 🔥' : ''}</Text><Text style={styles.statLbl}>semaine{stats.serie_semaines > 1 ? 's' : ''} d'affilée</Text></View>
        </View>
      ) : null}

      <View style={styles.onglets}>
        {([['top', 'Top'], ['mes', 'Mes balades'], ['meute', 'La meute']] as const).map(([k, label]) => (
          <TouchableOpacity key={k} style={[styles.onglet, onglet === k && styles.ongletOn]} onPress={() => setOnglet(k)}>
            <Text style={[styles.ongletText, onglet === k && styles.ongletTextOn]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {onglet === 'mes' ? (
        mesBalades === null ? <ActivityIndicator style={{ marginTop: 40 }} color={colors.terra} />
        : mesBalades.length === 0 ? (
          <View style={styles.vide}>
            <Ionicons name="footsteps-outline" size={30} color={colors.terra} />
            <Text style={styles.videTitre}>Ta première balade t'attend</Text>
            <Text style={styles.videTexte}>Appuie sur + puis « Démarrer une balade » sur la carte.</Text>
          </View>
        ) : (
          <View style={styles.liste}>{mesBalades.map(b => <LigneBalade key={b.id} b={b} />)}</View>
        )
      ) : onglet === 'meute' ? (
        meuteBalades === null ? <ActivityIndicator style={{ marginTop: 40 }} color={colors.terra} />
        : meuteBalades.length === 0 ? (
          <View style={styles.vide}>
            <Ionicons name="people-outline" size={30} color={colors.terra} />
            <Text style={styles.videTitre}>Ta meute n'a pas encore partagé de balade</Text>
            <Text style={styles.videTexte}>Suis d'autres membres ou invite tes amis pour voir leurs balades ici.</Text>
          </View>
        ) : (
          <View style={styles.liste}>{meuteBalades.map(b => <LigneBalade key={b.id} b={b} avecAuteur />)}</View>
        )
      ) : (
      <>
      <View style={styles.seg}>
        {(['meute', 'tous'] as const).map(p => (
          <TouchableOpacity key={p} style={[styles.segBtn, portee === p && styles.segBtnOn]} onPress={() => { setLignes(null); setPortee(p); }}>
            <Text style={[styles.segText, portee === p && styles.segTextOn]}>{p === 'meute' ? 'Ma meute' : 'Tout le monde'}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.sub}>{finDeSemaine()} · classement en kilomètres</Text>

      {lignes === null ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.terra} />
      ) : lignes.length === 0 ? (
        <View style={styles.vide}>
          <Ionicons name="footsteps-outline" size={30} color={colors.terra} />
          <Text style={styles.videTitre}>Personne n'a encore marché cette semaine</Text>
          <Text style={styles.videTexte}>
            {portee === 'meute' ? 'Lance une balade et prends la tête de ta meute !' : 'Lance une balade et prends la première place !'}
          </Text>
        </View>
      ) : (
        <View style={styles.liste}>
          {lignes.map(l => {
            const moi = l.user_id === moiId;
            return (
              <TouchableOpacity
                key={l.user_id}
                style={[styles.ligne, moi && styles.ligneMoi]}
                activeOpacity={0.7}
                onPress={() => !moi && navigation.navigate('ProfilPublic', { userId: l.user_id, prenom: l.prenom || '' })}
              >
                <Text style={styles.rang}>{l.rang <= 3 ? MEDAILLES[l.rang - 1] : l.rang}</Text>
                {l.avatar_url
                  ? <Image source={{ uri: l.avatar_url }} style={styles.avatar} />
                  : <View style={[styles.avatar, styles.avatarVide]}><Text style={styles.avatarLettre}>{(l.prenom || '?')[0].toUpperCase()}</Text></View>}
                <View style={{ flex: 1 }}>
                  <Text style={styles.nom} numberOfLines={1}>
                    {moi ? 'Toi' : (l.prenom || 'Membre')}{l.nom_chien ? ` & ${l.nom_chien}` : ''}
                  </Text>
                  <Text style={styles.nb}>{l.nb} balade{l.nb > 1 ? 's' : ''}</Text>
                </View>
                <Text style={styles.km}>{km1(l.km)} <Text style={styles.kmUnite}>km</Text></Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      <Text style={styles.regle}>
        Comptent les balades d'au moins 500 m et 5 min, à allure de marche. Remise à zéro chaque lundi.
      </Text>
      </>
      )}
      <BaladeFiche baladeId={ficheId} onClose={() => setFicheId(null)} onVoirCarte={voirSurCarte} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ivoryPale },
  statsCard: {
    flexDirection: 'row', margin: 16, marginBottom: 6, padding: 16, borderRadius: 16,
    backgroundColor: colors.bordeaux,
  },
  stat: { flex: 1, alignItems: 'center' },
  statVal: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 24, color: colors.ivory },
  statLbl: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: 'rgba(245,239,224,0.6)', marginTop: 2, textAlign: 'center' },
  onglets: { flexDirection: 'row', marginHorizontal: 16, marginTop: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  onglet: { flex: 1, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
  ongletOn: { borderBottomColor: colors.terra },
  ongletText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.textMuted },
  ongletTextOn: { color: colors.bordeaux },
  iconeBalade: { backgroundColor: colors.sage, alignItems: 'center', justifyContent: 'center' },
  seg: { flexDirection: 'row', marginHorizontal: 16, marginTop: 12, backgroundColor: colors.ivoryLight, borderRadius: 10, padding: 4 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 7 },
  segBtnOn: { backgroundColor: colors.white },
  segText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.textMuted },
  segTextOn: { color: colors.bordeaux },
  sub: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, marginHorizontal: 18, marginTop: 10 },
  liste: { marginHorizontal: 16, marginTop: 10, backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  ligne: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border },
  ligneMoi: { backgroundColor: '#FAEEDA' },
  rang: { width: 26, textAlign: 'center', fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.textMid },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarVide: { backgroundColor: colors.terraPale, alignItems: 'center', justifyContent: 'center' },
  avatarLettre: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
  nom: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
  nb: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 1 },
  km: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.bordeaux },
  kmUnite: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },
  vide: { alignItems: 'center', gap: 8, margin: 16, marginTop: 24, padding: 24, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(61,26,26,0.2)' },
  videTitre: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 16, color: colors.bordeaux, textAlign: 'center' },
  videTexte: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  regle: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, textAlign: 'center', marginHorizontal: 30, marginTop: 18, lineHeight: 16 },
});
