import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Image, Linking, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { useSession } from '../hooks/useSession';
import AuthGate from '../components/AuthGate';

const TYPE_LABELS: Record<string, string> = {
  offre: 'Offre exclusive', news: 'Actualité', nouveaute: 'Nouveauté',
};
const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  offre: { bg: colors.terra, text: '#fff' },
  news: { bg: colors.ivoryLight, text: colors.textMid },
  nouveaute: { bg: colors.bordeaux + '12', text: colors.bordeaux },
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

type Post = {
  id: string; titre: string; contenu: string | null; type: string;
  image_url: string | null; lien: string | null;
  date_debut: string | null; date_expiration: string | null;
  disponibilite: string | null; lieu_id: string | null;
};
type Partenaire = { id: string; nom: string; description: string | null; logo_url: string | null; site_web: string | null; };

export default function PartenairesScreen() {
  const navigation = useNavigation<any>();
  const { session, loading: sessionLoading } = useSession();

  const [partenaires, setPartenaires] = useState<Partenaire[]>([]);
  const [postsMap, setPostsMap] = useState<Record<string, Post[]>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);

  useEffect(() => { init(); }, []);

  async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setHasProfile(false); setLoading(false); return; }
    const { data: profil } = await supabase.from('profils').select('prenom').eq('id', session.user.id).single();
    if (!profil?.prenom) { setHasProfile(false); setLoading(false); return; }
    setHasProfile(true);
    await load();
  }

  async function load() {
    setLoading(true);
    const { data: parts } = await supabase.from('partenaires').select('*').eq('actif', true).order('created_at', { ascending: true });
    if (!parts?.length) { setPartenaires([]); setLoading(false); return; }
    const ids = parts.map(p => p.id);
    const { data: posts } = await supabase.from('partenaire_posts').select('*').in('partenaire_id', ids).eq('actif', true).order('created_at', { ascending: false });
    const map: Record<string, Post[]> = {};
    (posts || []).forEach((p: any) => {
      if (!map[p.partenaire_id]) map[p.partenaire_id] = [];
      map[p.partenaire_id].push(p);
    });
    setPartenaires(parts);
    setPostsMap(map);
    setLoading(false);
  }

  if (sessionLoading || loading) return <ActivityIndicator style={{ flex: 1 }} color={colors.terra} />;
  if (!session) return <AuthGate navigation={navigation} message="Connecte-toi pour accéder aux offres et actualités de nos partenaires dog-friendly." />;

  if (hasProfile === false) {
    return (
      <View style={styles.gate}>
        <Text style={styles.gateTitle}>Espace partenaires</Text>
        <Text style={styles.gateText}>Connecte-toi et crée ton profil pour accéder aux actualités de nos marques partenaires.</Text>
      </View>
    );
  }

  if (!partenaires.length) {
    return (
      <View style={styles.gate}>
        <Text style={styles.gateTitle}>Arrive bientôt</Text>
        <Text style={styles.gateText}>Nous sélectionnons des marques dog-friendly pour partager leurs actualités avec la communauté.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.terra} />}
    >
      {partenaires.map(p => {
        const posts = postsMap[p.id] || [];
        return (
          <View key={p.id} style={styles.card}>
            {/* Partenaire header */}
            <View style={styles.partHeader}>
              <View style={styles.logoWrap}>
                {p.logo_url
                  ? <Image source={{ uri: p.logo_url }} style={styles.logoImg} />
                  : <View style={styles.logoFallback}><Text style={styles.logoFallbackText}>{p.nom[0]}</Text></View>}
              </View>
              <View style={styles.partInfo}>
                <Text style={styles.partNom}>{p.nom}</Text>
                {p.description ? <Text style={styles.partDesc} numberOfLines={2}>{p.description}</Text> : null}
                {p.site_web ? (
                  <TouchableOpacity style={styles.siteRow} onPress={() => Linking.openURL(p.site_web!)}>
                    <Ionicons name="globe-outline" size={11} color={colors.terra} />
                    <Text style={styles.partSite}>{p.site_web.replace(/^https?:\/\//, '').replace(/\/$/, '')}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>

            {/* Posts */}
            {posts.length === 0 ? (
              <View style={styles.noPostWrap}>
                <Text style={styles.noPost}>Aucune publication pour l'instant</Text>
              </View>
            ) : posts.map((post, idx) => {
              const typeStyle = TYPE_COLORS[post.type] || TYPE_COLORS.news;
              let periode = '';
              if (post.date_debut && post.date_expiration) periode = `${fmtDate(post.date_debut)} – ${fmtDate(post.date_expiration)}`;
              else if (post.date_debut) periode = `À partir du ${fmtDate(post.date_debut)}`;
              else if (post.date_expiration) periode = `Jusqu'au ${fmtDate(post.date_expiration)}`;

              return (
                <View key={post.id} style={[styles.post, idx === 0 && styles.postFirst]}>
                  {post.image_url && (
                    <Image source={{ uri: post.image_url }} style={styles.postImage} />
                  )}
                  <View style={styles.postBody}>
                    <View style={styles.postTopRow}>
                      <View style={[styles.typeBadge, { backgroundColor: typeStyle.bg }]}>
                        <Text style={[styles.typeBadgeText, { color: typeStyle.text }]}>{TYPE_LABELS[post.type] || post.type}</Text>
                      </View>
                      {periode ? (
                        <View style={styles.periodeRow}>
                          <Ionicons name="calendar-outline" size={10} color={colors.textMuted} />
                          <Text style={styles.periodeText}>{periode}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.postTitre}>{post.titre}</Text>
                    {post.contenu ? <Text style={styles.postContenu}>{post.contenu}</Text> : null}
                    {post.lien ? (
                      <TouchableOpacity style={styles.postBtn} onPress={() => Linking.openURL(post.lien!)}>
                        <Text style={styles.postBtnText}>Découvrir</Text>
                        <Ionicons name="arrow-forward" size={12} color={colors.ivory} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivoryPale },
  list: { padding: 16, gap: 20, paddingBottom: 40 },

  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, backgroundColor: colors.ivoryPale },
  gateTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 20, color: colors.bordeaux, marginBottom: 10, textAlign: 'center' },
  gateText: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },

  card: { backgroundColor: colors.white, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },

  partHeader: { flexDirection: 'row', gap: 14, padding: 18, alignItems: 'center' },
  logoWrap: { width: 56, height: 56, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.ivoryLight },
  logoImg: { width: 56, height: 56 },
  logoFallback: { width: 56, height: 56, backgroundColor: colors.bordeaux + '10', alignItems: 'center', justifyContent: 'center' },
  logoFallbackText: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 22, color: colors.bordeaux },
  partInfo: { flex: 1, gap: 2 },
  partNom: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 16, color: colors.bordeaux },
  partDesc: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, lineHeight: 17, marginTop: 1 },
  siteRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  partSite: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.terra },

  noPostWrap: { borderTopWidth: 1, borderTopColor: colors.border, padding: 20, alignItems: 'center' },
  noPost: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted },

  post: { borderTopWidth: 1, borderTopColor: colors.border },
  postFirst: {},
  postImage: { width: '100%', height: 180, resizeMode: 'cover' },
  postBody: { padding: 16 },
  postTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 },
  typeBadge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  typeBadgeText: { fontFamily: 'DMSans_500Medium', fontSize: 11 },
  periodeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  periodeText: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },
  postTitre: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 17, color: colors.bordeaux, marginBottom: 6, lineHeight: 24 },
  postContenu: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMid, lineHeight: 20, marginBottom: 12 },
  postBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.bordeaux, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 9,
    alignSelf: 'flex-start',
  },
  postBtnText: { fontFamily: 'DMSans_500Medium', color: colors.ivory, fontSize: 13 },
});
