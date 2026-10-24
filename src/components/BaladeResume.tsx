import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Share, ScrollView, Platform } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { supabase } from '../lib/supabase';
import { track } from '../lib/tracking';
import { colors } from '../lib/theme';
import TraceDessin from './TraceDessin';
import { StoryBalade, CarteStory, MISES_EN_PAGE, type MiseEnPage, type DonneesStory } from './BaladeStories';

export type BaladeTerminee = {
  nom: string;
  distanceKm: number;
  dureeSec: number;
  trace: { latitude: number; longitude: number; b?: 1 }[];
  // Mode "fiche" (consultation d'une balade existante)
  id?: string;
  auteur?: string | null;
  date?: string;
  estAMoi?: boolean;
};

type Stats = { mois_km: number; mois_nb: number; rang_mois: number | null; serie_semaines: number };

export function formatDuree(sec: number) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function formatAllure(km: number, sec: number) {
  if (km < 0.05 || sec <= 0) return '–';
  const parKm = sec / km;
  return `${Math.floor(parKm / 60)}'${String(Math.round(parKm % 60)).padStart(2, '0')}`;
}

const km1 = (v: number) => v.toFixed(1).replace('.', ',');

function haversineKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const R = 6371, dLat = (b.latitude - a.latitude) * Math.PI / 180, dLng = (b.longitude - a.longitude) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * Math.PI / 180) * Math.cos(b.latitude * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// Comme Strava : on retire le debut et la fin du trace (200 m, ou 25 % sur une
// petite balade) pour que la carte ne revele ni le depart ni l'arrivee.
export function masquerExtremites<T extends { latitude: number; longitude: number }>(trace: T[]): T[] {
  if (trace.length < 3) return trace;
  const cumul = [0];
  for (let i = 1; i < trace.length; i++) cumul.push(cumul[i - 1] + haversineKm(trace[i - 1], trace[i]));
  const total = cumul[cumul.length - 1];
  const coupe = Math.min(0.2, total * 0.25);
  const garde = trace.filter((_, i) => cumul[i] >= coupe && cumul[i] <= total - coupe);
  return garde.length >= 2 ? garde : trace.slice(Math.floor(trace.length / 3), Math.ceil((trace.length * 2) / 3) + 1);
}

export default function BaladeResume({
  balade, onClose, onVoirClassement, mode = 'fin', onVoirCarte,
}: {
  balade: BaladeTerminee | null; onClose: () => void; onVoirClassement?: () => void;
  mode?: 'fin' | 'fiche'; onVoirCarte?: () => void;
}) {
  const storyRef = useRef<View>(null);
  const carteRef = useRef<View>(null);
  const mapRef = useRef<MapView>(null);
  const [cartePrete, setCartePrete] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [nomChien, setNomChien] = useState<string | null>(null);
  const [etape, setEtape] = useState<'resume' | 'partage'>('resume');
  const [miseEnPage, setMiseEnPage] = useState<MiseEnPage>('carte');
  const [partage, setPartage] = useState(false);

  useEffect(() => {
    if (!balade) return;
    setStats(null); setEtape('resume'); setCartePrete(false);
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const [{ data: st }, { data: p }] = await Promise.all([
        supabase.rpc('mes_stats_balades'),
        session ? supabase.from('profils').select('nom_chien').eq('id', session.user.id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      if (st) setStats(st as Stats);
      setNomChien((p as any)?.nom_chien ?? null);
    })();
  }, [balade]);

  function ouvrirPartage() {
    setCartePrete(false);
    setEtape('partage');
  }

  async function envoyer() {
    if (!balade || !storyRef.current) return;
    setPartage(true);
    track('balade_partage', { km: Math.round(balade.distanceKm * 10) / 10, mise_en_page: miseEnPage });
    try {
      const uri = await captureRef(storyRef, { format: 'png', quality: 1, width: 1080, height: 1920 });
      // iOS : feuille de partage systeme (UIActivityViewController) qui propose
      // Instagram, mais aussi "Copier" et "Enregistrer l'image" pour les fonds
      // transparents. Android : expo-sharing (Share.share n'accepte pas de fichier).
      if (Platform.OS === 'ios') await Share.share({ url: uri });
      else if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Partager ma balade' });
    } catch {} finally { setPartage(false); }
  }

  if (!balade) return null;
  const chien = nomChien;
  const traceCarte = masquerExtremites(balade.trace);
  const fiche = mode === 'fiche';
  const partageable = !fiche || !!balade.estAMoi;
  const dateLabel = balade.date
    ? new Date(balade.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
    : '';
  const allure = formatAllure(balade.distanceKm, balade.dureeSec);
  const donnees: DonneesStory = {
    titre: chien ? `Balade avec ${chien}` : 'Ma balade',
    nom: balade.nom,
    km: km1(balade.distanceKm),
    duree: formatDuree(balade.dureeSec),
    allure,
    date: new Date(balade.date || Date.now()).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
    rang: !fiche && stats?.rang_mois ? `${stats.rang_mois}${stats.rang_mois === 1 ? 'er' : 'e'} du mois · ${km1(Number(stats.mois_km))} km` : null,
    trace: masquerExtremites(balade.trace),
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {etape === 'partage' ? (
        <View style={styles.page}>
          <View style={styles.top}>
            <TouchableOpacity onPress={() => setEtape('resume')} hitSlop={10} accessibilityLabel="Retour" style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="chevron-back" size={22} color={colors.bordeaux} />
              <Text style={styles.retour}>Retour</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityLabel="Fermer">
              <Ionicons name="close" size={24} color={colors.bordeaux} />
            </TouchableOpacity>
          </View>
          <View style={styles.choixRangee}>
            {MISES_EN_PAGE.map(m => (
              <TouchableOpacity
                key={m.key}
                style={[styles.choix, miseEnPage === m.key && styles.choixActif]}
                onPress={() => setMiseEnPage(m.key)}
              >
                <Text style={[styles.choixTexte, miseEnPage === m.key && styles.choixTexteActif]}>{m.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <ScrollView style={{ flex: 1, marginHorizontal: -22 }} contentContainerStyle={{ alignItems: 'center', paddingVertical: 12 }}>
            {/* Apercu en taille reelle = image envoyee (capture directe, carte nette) */}
            <View style={[styles.apercuFond, MISES_EN_PAGE.find(m => m.key === miseEnPage)?.transparent && styles.apercuDamier]}>
              <View ref={storyRef} collapsable={false} style={{ width: 360, height: 640 }}>
                <StoryBalade
                  type={miseEnPage}
                  d={donnees}
                  carte={miseEnPage === 'carte' ? <CarteStory trace={donnees.trace} onPrete={() => setCartePrete(true)} /> : undefined}
                />
              </View>
            </View>
            {MISES_EN_PAGE.find(m => m.key === miseEnPage)?.transparent ? (
              <Text style={[styles.astuce, { marginHorizontal: 22, marginTop: 12 }]}>
                Fond transparent : dans le partage, choisis « Copier » (ou « Enregistrer l'image »), puis dans ta story Instagram colle-la par-dessus ta photo.
              </Text>
            ) : null}
          </ScrollView>
          <TouchableOpacity
            style={[styles.cta, { marginBottom: 24 }, miseEnPage === 'carte' && !cartePrete && { opacity: 0.6 }]}
            onPress={envoyer}
            disabled={partage || (miseEnPage === 'carte' && !cartePrete)}
          >
            {partage || (miseEnPage === 'carte' && !cartePrete) ? <ActivityIndicator color={colors.ivory} /> : (
              <>
                <Ionicons name="share-outline" size={17} color={colors.ivory} />
                <Text style={styles.ctaText}>Partager</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : (
      <View style={styles.page}>
        <View style={styles.top}>
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityLabel="Fermer">
            <Ionicons name="close" size={24} color={colors.bordeaux} />
          </TouchableOpacity>
        </View>

        {fiche ? (
          <>
            <Text style={styles.bravo} numberOfLines={2}>{balade.nom}</Text>
            <Text style={styles.nom} numberOfLines={1}>
              {balade.estAMoi ? 'Ta balade' : `Par ${balade.auteur || 'un membre'}`}{dateLabel ? ` · ${dateLabel}` : ''}
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.bravo}>{chien ? `Bravo ${chien} !` : 'Belle balade !'} 🐾</Text>
            <Text style={styles.nom} numberOfLines={1}>{balade.nom}</Text>
          </>
        )}

        {traceCarte.length >= 2 ? (
          <View ref={carteRef} collapsable={false} style={styles.carteBox} pointerEvents="none">
            <MapView
              ref={mapRef}
              style={StyleSheet.absoluteFill}
              liteMode
              scrollEnabled={false} zoomEnabled={false} rotateEnabled={false} pitchEnabled={false}
              toolbarEnabled={false} showsPointsOfInterest={false}
              onMapReady={() => mapRef.current?.fitToCoordinates(traceCarte, {
                edgePadding: { top: 30, right: 30, bottom: 30, left: 30 }, animated: false,
              })}
            >
              <Polyline coordinates={traceCarte} strokeColor={colors.terra} strokeWidth={5} lineCap="round" lineJoin="round" />
            </MapView>
          </View>
        ) : (
          <View style={styles.traceBox}>
            <TraceDessin trace={balade.trace} width={300} height={170} color={colors.sage} />
          </View>
        )}

        <View style={styles.statsRow}>
          <View style={styles.stat}><Text style={styles.statVal}>{km1(balade.distanceKm)}</Text><Text style={styles.statLbl}>km</Text></View>
          <View style={styles.stat}><Text style={styles.statVal}>{formatDuree(balade.dureeSec)}</Text><Text style={styles.statLbl}>durée</Text></View>
          <View style={styles.stat}><Text style={styles.statVal}>{allure}</Text><Text style={styles.statLbl}>/ km</Text></View>
        </View>

        {!fiche ? (
        <TouchableOpacity style={styles.rangBox} onPress={onVoirClassement} activeOpacity={0.8}>
          <Ionicons name="trophy-outline" size={16} color="#854F0B" />
          {stats ? (
            <Text style={styles.rangText}>
              {stats.rang_mois ? `${stats.rang_mois}${stats.rang_mois === 1 ? 'er' : 'e'} du mois` : 'Classement du mois'}
              {` · ${km1(Number(stats.mois_km))} km en ${new Date().toLocaleDateString('fr-FR', { month: 'long' })}`}
              {stats.serie_semaines > 1 ? ` · ${stats.serie_semaines} semaines d'affilée 🔥` : ''}
            </Text>
          ) : <ActivityIndicator size="small" color="#854F0B" />}
          <Ionicons name="chevron-forward" size={14} color="#854F0B" />
        </TouchableOpacity>
        ) : null}

        {partageable ? (
        <TouchableOpacity style={styles.cta} onPress={ouvrirPartage}>
          <Ionicons name="share-outline" size={17} color={colors.ivory} />
          <Text style={styles.ctaText}>Partager ma balade</Text>
        </TouchableOpacity>
        ) : null}
        {onVoirCarte ? (
          <TouchableOpacity style={styles.secondaire} onPress={onVoirCarte}>
            <Ionicons name="map-outline" size={16} color={colors.bordeaux} />
            <Text style={styles.secondaireText}>Voir sur la carte</Text>
          </TouchableOpacity>
        ) : null}
        {partageable ? <Text style={styles.note}>Le début et la fin du tracé sont masqués : ton adresse reste privée.</Text> : null}
      </View>
      )}

    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ivoryPale, paddingHorizontal: 22, paddingTop: 12 },
  top: { flexDirection: 'row', marginBottom: 8 },
  bravo: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 26, color: colors.bordeaux, textAlign: 'center' },
  nom: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.textMuted, textAlign: 'center', marginTop: 4 },
  traceBox: {
    alignItems: 'center', marginTop: 18, paddingVertical: 10, borderRadius: 18,
    backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border,
  },
  carteBox: {
    height: 210, marginTop: 18, borderRadius: 18, overflow: 'hidden',
    backgroundColor: colors.ivoryLight, borderWidth: 1, borderColor: colors.border,
  },
  statsRow: { flexDirection: 'row', marginTop: 18 },
  stat: { flex: 1, alignItems: 'center' },
  statVal: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 26, color: colors.bordeaux },
  statLbl: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, marginTop: 2 },
  rangBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20,
    backgroundColor: '#FAEEDA', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
  },
  rangText: { flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 13, color: '#633806' },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 18,
    backgroundColor: colors.terra, borderRadius: 14, paddingVertical: 15,
  },
  ctaText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.ivory },
  secondaire: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12,
    borderWidth: 1, borderColor: colors.bordeaux, borderRadius: 14, paddingVertical: 13,
  },
  secondaireText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
  note: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: 10 },

  choixRangee: { flexDirection: 'row', gap: 6, marginTop: 4 },
  choix: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  choixActif: { backgroundColor: colors.bordeaux, borderColor: colors.bordeaux },
  choixTexte: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.textMid },
  choixTexteActif: { color: colors.ivory },
  apercuFond: { borderRadius: 18, overflow: 'hidden' },
  apercuDamier: { backgroundColor: '#6b6560' },
  retour: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.bordeaux },
  astuce: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMid, lineHeight: 17, backgroundColor: colors.ivoryLight, borderRadius: 10, padding: 10 },
});

// Fiche d'une balade existante, chargee par id. balade_by_id applique la zone de
// confidentialite des autres membres (debut/fin du trace masques si demande).
export function BaladeFiche({
  baladeId, onClose, onVoirCarte,
}: {
  baladeId: string | null; onClose: () => void; onVoirCarte?: (id: string) => void;
}) {
  const [balade, setBalade] = useState<BaladeTerminee | null>(null);
  useEffect(() => {
    setBalade(null);
    if (!baladeId) return;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const { data } = await supabase.rpc('balade_by_id', { p_id: baladeId });
      const b = Array.isArray(data) ? data[0] : null;
      if (!b) return;
      setBalade({
        id: b.id, nom: b.nom, distanceKm: Number(b.distance_km) || 0, dureeSec: b.duree_secondes || 0,
        trace: Array.isArray(b.trace) ? b.trace : [], auteur: b.prenom, date: b.created_at,
        estAMoi: !!session && b.user_id === session.user.id,
      });
    })();
  }, [baladeId]);
  if (!baladeId || !balade) return null;
  return (
    <BaladeResume
      balade={balade}
      mode="fiche"
      onClose={onClose}
      onVoirCarte={onVoirCarte ? () => onVoirCarte(balade.id!) : undefined}
    />
  );
}
