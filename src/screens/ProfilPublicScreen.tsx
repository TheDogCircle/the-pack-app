import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Image, ActivityIndicator, Dimensions,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { mapNavigation } from '../lib/mapNavigation';
import { sendPushNotification } from '../lib/notifications';

const SCREEN_W = Dimensions.get('window').width;
const PHOTO_W = (SCREEN_W - 16 * 2 - 8) / 2;

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

const CAT_CONFIG: Record<string, { icon: IoniconsName; label: string; color: string }> = {
  restaurant: { icon: 'restaurant-outline', label: 'Restaurant', color: '#C4693A' },
  cafe:       { icon: 'cafe-outline',       label: 'Café',        color: '#A0522D' },
  parc:       { icon: 'leaf-outline',       label: 'Parc',        color: '#5A9E6F' },
  parc_chien: { icon: 'paw-outline',        label: 'Espace canin', color: '#3D8B5E' },
  plage:      { icon: 'water-outline',      label: 'Plage',       color: '#7ABFCC' },
  veto:       { icon: 'medical-outline',    label: 'Vétérinaire', color: '#5A7FA5' },
  toiletteur: { icon: 'cut-outline',        label: 'Toiletteur',  color: '#7B7AAA' },
  boutique:   { icon: 'bag-outline',        label: 'Boutique',    color: '#8B5A2B' },
  hotel:      { icon: 'bed-outline',        label: 'Hôtel',       color: '#4A7FA5' },
  bar:        { icon: 'wine-outline',       label: 'Bar',         color: '#8B5E3C' },
  autre:      { icon: 'location-outline',   label: 'Autre',       color: '#546E7A' },
};

type Profil = {
  id: string; prenom: string | null; username: string | null;
  ville: string | null; bio: string | null; avatar_url: string | null;
  nom_chien: string | null; race_chien: string | null; points: number;
};
type AvisItem = {
  id: string; note: number; commentaire: string | null; created_at: string; lieu_id: string;
  lieux: { nom: string; ville: string; cat: string } | null;
};
type FavItem = { id: string; lieu_id: string; liste: string; nom: string; ville: string; cat: string };
type PhotoItem = { id: string; url: string; lieu_id: string | null };

export default function ProfilPublicScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { userId } = route.params as { userId: string };

  const [profil, setProfil] = useState<Profil | null>(null);
  const [avis, setAvis] = useState<AvisItem[]>([]);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [favoris, setFavoris] = useState<FavItem[]>([]);
  const [stats, setStats] = useState({ avis: 0, favoris: 0, followers: 0 });
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'adresses' | 'photos' | 'avis'>('adresses');

  useEffect(() => { init(); }, []);

  async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    setMyId(session?.user.id ?? null);

    const [{ data: p }, { data: avisRaw }, { data: photosRaw }, { data: favsRaw }, avisCount, favCount, followCount, followStatus] = await Promise.all([
      supabase.from('profils').select('*').eq('id', userId).single(),
      supabase.from('avis').select('id,note,commentaire,created_at,lieu_id').eq('user_id', userId).order('created_at', { ascending: false }).limit(10),
      supabase.from('photos').select('id,url,lieu_id').eq('user_id', userId).eq('validee', true).order('created_at', { ascending: false }).limit(18),
      supabase.from('favoris').select('id,lieu_id,liste').eq('user_id', userId).in('liste', ['favori', 'a_tester']),
      supabase.from('avis').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('favoris').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('follows').select('id', { count: 'exact', head: true }).eq('following_id', userId),
      session ? supabase.from('follows').select('id').eq('follower_id', session.user.id).eq('following_id', userId).maybeSingle() : Promise.resolve({ data: null }),
    ]);

    setProfil(p);
    setPhotos((photosRaw || []).map((ph: any) => ({ id: ph.id, url: ph.url, lieu_id: ph.lieu_id || null })));

    // Two-step: collect all lieu IDs then fetch info
    const allLieuIds = [...new Set([
      ...(favsRaw || []).map((f: any) => f.lieu_id),
      ...(avisRaw || []).map((a: any) => a.lieu_id),
    ].filter(Boolean))];

    let lieuxMap: Record<string, { nom: string; ville: string; cat: string }> = {};
    if (allLieuIds.length > 0) {
      const { data: lieuxData } = await supabase.from('lieux').select('id,nom,ville,cat').in('id', allLieuIds);
      (lieuxData || []).forEach((l: any) => { lieuxMap[l.id] = { nom: l.nom, ville: l.ville, cat: l.cat }; });
    }

    setFavoris((favsRaw || []).map((f: any) => ({
      id: f.id, lieu_id: f.lieu_id, liste: f.liste,
      nom: lieuxMap[f.lieu_id]?.nom || 'Lieu inconnu',
      ville: lieuxMap[f.lieu_id]?.ville || '',
      cat: lieuxMap[f.lieu_id]?.cat || 'autre',
    })));

    setAvis((avisRaw || []).map((a: any) => ({
      id: a.id, note: a.note, commentaire: a.commentaire, created_at: a.created_at, lieu_id: a.lieu_id,
      lieux: lieuxMap[a.lieu_id] || null,
    })));

    setStats({ avis: (avisCount as any).count || 0, favoris: (favCount as any).count || 0, followers: (followCount as any).count || 0 });
    setIsFollowing(!!(followStatus as any).data);
    setLoading(false);
  }

  async function toggleFollow() {
    if (!myId) return;
    setFollowLoading(true);
    if (isFollowing) {
      await supabase.from('follows').delete().eq('follower_id', myId).eq('following_id', userId);
      setIsFollowing(false);
      setStats(s => ({ ...s, followers: s.followers - 1 }));
    } else {
      await supabase.from('follows').insert({ follower_id: myId, following_id: userId, statut: 'accepte' });
      setIsFollowing(true);
      setStats(s => ({ ...s, followers: s.followers + 1 }));
      const [{ data: target }, { data: me }] = await Promise.all([
        supabase.from('profils').select('push_token, notif_follow').eq('id', userId).single(),
        supabase.from('profils').select('prenom').eq('id', myId).single(),
      ]);
      if (target?.push_token && target?.notif_follow !== false) {
        const name = me?.prenom || 'Quelqu\'un';
        await sendPushNotification(
          target.push_token,
          'Nouvel abonné 🐾',
          `${name} commence à te suivre sur The Pack !`,
          { type: 'follow', userId: myId },
        );
      }
    }
    setFollowLoading(false);
  }

  function goToLieu(lieuId: string) {
    mapNavigation.setPendingLieu(lieuId);
    navigation.navigate('Tabs', { screen: 'Carte' });
  }

  function renderLieuCard(item: FavItem) {
    const cfg = CAT_CONFIG[item.cat] || CAT_CONFIG.autre;
    return (
      <TouchableOpacity key={item.id} style={styles.lieuCard} onPress={() => goToLieu(item.lieu_id)} activeOpacity={0.7}>
        <View style={[styles.lieuCardIcon, { backgroundColor: cfg.color + '22' }]}>
          <Ionicons name={cfg.icon} size={18} color={cfg.color} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.lieuCardNom} numberOfLines={1}>{item.nom}</Text>
          <Text style={styles.lieuCardVille} numberOfLines={1}>{[item.ville, cfg.label].filter(Boolean).join(' · ')}</Text>
        </View>
        <Ionicons name="chevron-forward" size={15} color={colors.textMuted} />
      </TouchableOpacity>
    );
  }

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={colors.terra} />;
  if (!profil) return <View style={styles.center}><Text style={styles.errorText}>Profil introuvable</Text></View>;

  const favorisList = favoris.filter(f => f.liste === 'favori');
  const aTesterList = favoris.filter(f => f.liste === 'a_tester');

  return (
    <View style={styles.container}>
      {/* Header fixe */}
      <View style={styles.header}>
        <View style={styles.avatarRow}>
          {profil.avatar_url ? (
            <Image source={{ uri: profil.avatar_url }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarLetter}>{(profil.prenom || '?')[0].toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.headerInfo}>
            <Text style={styles.nom}>{profil.prenom || 'Membre'}</Text>
            {profil.username ? <Text style={styles.username}>@{profil.username}</Text> : null}
            {profil.ville ? (
              <View style={styles.villeRow}>
                <Ionicons name="location-outline" size={12} color="rgba(245,239,224,0.6)" />
                <Text style={styles.villeText}>{profil.ville}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.statsRow}>
          {[
            { label: 'Avis',    value: stats.avis },
            { label: 'Adresses', value: stats.favoris },
            { label: 'Abonnés', value: stats.followers },
          ].map(s => (
            <View key={s.label} style={styles.stat}>
              <Text style={styles.statNum}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        {myId && myId !== userId && (
          <TouchableOpacity style={[styles.followBtn, isFollowing && styles.followBtnActive]} onPress={toggleFollow} disabled={followLoading}>
            {followLoading ? (
              <ActivityIndicator size="small" color={isFollowing ? colors.terra : colors.ivory} />
            ) : (
              <>
                <Ionicons name={isFollowing ? 'checkmark' : 'person-add-outline'} size={15} color={isFollowing ? colors.terra : colors.ivory} />
                <Text style={[styles.followBtnText, isFollowing && styles.followBtnTextActive]}>
                  {isFollowing ? 'Abonné' : 'Suivre'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Info chien */}
        {(profil.nom_chien || profil.race_chien) ? (
          <View style={styles.dogRow}>
            <Text style={styles.dogEmoji}>🐾</Text>
            <Text style={styles.dogText}>
              {[profil.nom_chien, profil.race_chien].filter(Boolean).join(' · ')}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Onglets */}
      <View style={styles.tabs}>
        {([
          { key: 'adresses', label: 'Adresses', icon: 'heart-outline' as IoniconsName },
          { key: 'photos',   label: 'Photos',   icon: 'images-outline' as IoniconsName },
          { key: 'avis',     label: 'Avis',     icon: 'star-outline' as IoniconsName },
        ] as const).map(t => (
          <TouchableOpacity key={t.key} style={[styles.tab, activeTab === t.key && styles.tabActive]} onPress={() => setActiveTab(t.key)}>
            <Ionicons name={t.icon} size={15} color={activeTab === t.key ? colors.terra : colors.textMuted} />
            <Text style={[styles.tabText, activeTab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Contenu onglet Adresses */}
      {activeTab === 'adresses' && (
        <ScrollView contentContainerStyle={styles.tabContent}>
          {favoris.length === 0 ? (
            <View style={styles.emptyTab}>
              <Ionicons name="heart-outline" size={40} color={colors.border} />
              <Text style={styles.emptyText}>Aucune adresse enregistrée.</Text>
            </View>
          ) : (
            <>
              {favorisList.length > 0 && (
                <>
                  <View style={styles.listSection}>
                    <Ionicons name="heart" size={13} color="#E05070" />
                    <Text style={[styles.listSectionTitle, { color: '#E05070' }]}>Favoris</Text>
                  </View>
                  {favorisList.map(item => renderLieuCard(item))}
                </>
              )}
              {aTesterList.length > 0 && (
                <>
                  <View style={[styles.listSection, favorisList.length > 0 && { marginTop: 16 }]}>
                    <Ionicons name="bookmark" size={13} color={colors.bordeaux} />
                    <Text style={styles.listSectionTitle}>À tester</Text>
                  </View>
                  {aTesterList.map(item => renderLieuCard(item))}
                </>
              )}
            </>
          )}
        </ScrollView>
      )}

      {/* Contenu onglet Photos */}
      {activeTab === 'photos' && (
        photos.length === 0 ? (
          <View style={styles.emptyTab}>
            <Ionicons name="images-outline" size={40} color={colors.border} />
            <Text style={styles.emptyText}>Aucune photo publiée.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.photoTabContent}>
            <View style={styles.photoGrid}>
              {photos.map(ph => (
                <TouchableOpacity
                  key={ph.id}
                  style={styles.photoCard}
                  onPress={() => ph.lieu_id && goToLieu(ph.lieu_id)}
                  activeOpacity={0.85}
                >
                  <Image source={{ uri: ph.url }} style={styles.photoImg} resizeMode="cover" />
                  {ph.lieu_id && (
                    <View style={styles.photoOverlay}>
                      <Ionicons name="location-outline" size={12} color="#fff" />
                      <Text style={styles.photoOverlayText}>Voir le lieu</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        )
      )}

      {/* Contenu onglet Avis */}
      {activeTab === 'avis' && (
        avis.length === 0 ? (
          <View style={styles.emptyTab}>
            <Ionicons name="star-outline" size={40} color={colors.border} />
            <Text style={styles.emptyText}>Aucun avis publié.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.tabContent}>
            {avis.map(a => {
              const cfg = CAT_CONFIG[a.lieux?.cat || 'autre'] || CAT_CONFIG.autre;
              return (
                <TouchableOpacity
                  key={a.id}
                  style={styles.avisCard}
                  onPress={() => a.lieu_id && goToLieu(a.lieu_id)}
                  activeOpacity={0.75}
                >
                  <View style={styles.avisHeader}>
                    <View style={[styles.avisIcon, { backgroundColor: cfg.color + '22' }]}>
                      <Ionicons name={cfg.icon} size={14} color={cfg.color} />
                    </View>
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text style={styles.avisLieu} numberOfLines={1}>{a.lieux?.nom || 'Lieu inconnu'}</Text>
                      {a.lieux?.ville ? <Text style={styles.avisVille}>{a.lieux.ville}</Text> : null}
                    </View>
                    <View style={styles.starsRow}>
                      {[1,2,3,4,5].map(i => (
                        <Ionicons key={i} name={i <= a.note ? 'star' : 'star-outline'} size={12} color={colors.terra} />
                      ))}
                    </View>
                  </View>
                  {a.commentaire ? <Text style={styles.avisComment} numberOfLines={3}>{a.commentaire}</Text> : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivoryPale },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontFamily: 'DMSans_400Regular', color: colors.textMuted },

  // Header
  header: { backgroundColor: colors.bordeaux, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20, gap: 14 },
  avatarRow: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  avatar: { width: 68, height: 68, borderRadius: 34, borderWidth: 2, borderColor: 'rgba(245,239,224,0.3)' },
  avatarFallback: { backgroundColor: 'rgba(245,239,224,0.15)', alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 26, color: colors.ivory },
  headerInfo: { flex: 1, gap: 3 },
  nom: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 20, color: colors.ivory },
  username: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.terraPale },
  villeRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  villeText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: 'rgba(245,239,224,0.6)' },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: 'rgba(245,239,224,0.08)', borderRadius: 12, padding: 12 },
  stat: { alignItems: 'center', gap: 2 },
  statNum: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.ivory },
  statLabel: { fontFamily: 'DMSans_400Regular', fontSize: 10, color: 'rgba(245,239,224,0.6)', textTransform: 'uppercase', letterSpacing: 0.5 },
  followBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.terra, borderRadius: 12, paddingVertical: 11,
  },
  followBtnActive: { backgroundColor: 'rgba(245,239,224,0.1)', borderWidth: 1, borderColor: colors.terra + '66' },
  followBtnText: { fontFamily: 'DMSans_500Medium', color: colors.ivory, fontSize: 14 },
  followBtnTextActive: { color: colors.terra },
  dogRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dogEmoji: { fontSize: 16 },
  dogText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: 'rgba(245,239,224,0.7)' },

  // Tabs
  tabs: { flexDirection: 'row', backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 13 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: colors.terra },
  tabText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.textMuted },
  tabTextActive: { color: colors.terra },

  // Adresses
  tabContent: { padding: 16, gap: 8, paddingBottom: 40 },
  listSection: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  listSectionTitle: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.bordeaux, textTransform: 'uppercase', letterSpacing: 0.6 },
  lieuCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.white, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: colors.border,
  },
  lieuCardIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  lieuCardNom: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
  lieuCardVille: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted },

  // Photos
  photoTabContent: { padding: 16, paddingBottom: 40 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoCard: { width: PHOTO_W, height: PHOTO_W * 1.15, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.border },
  photoImg: { width: '100%', height: '100%' },
  photoOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 10, paddingVertical: 7,
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  photoOverlayText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: '#fff' },

  // Avis
  emptyTab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 60, paddingBottom: 40 },
  emptyText: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.textMuted },
  avisCard: {
    backgroundColor: colors.white, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: colors.border, gap: 8,
  },
  avisHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avisIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  avisLieu: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux },
  avisVille: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },
  starsRow: { flexDirection: 'row', gap: 2 },
  avisComment: { fontFamily: 'DMSans_300Light', fontSize: 12, color: colors.textMid, lineHeight: 18, fontStyle: 'italic' },
});
