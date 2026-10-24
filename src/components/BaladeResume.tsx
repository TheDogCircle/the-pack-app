import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Share, Image } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { supabase } from '../lib/supabase';
import { track } from '../lib/tracking';
import { colors } from '../lib/theme';
import TraceDessin from './TraceDessin';

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

type Stats = { semaine_km: number; semaine_nb: number; rang: number | null; serie_semaines: number };

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
  const [storyCarteUri, setStoryCarteUri] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [moi, setMoi] = useState<{ prenom: string | null; nom_chien: string | null; code: string | null }>({ prenom: null, nom_chien: null, code: null });
  const [partage, setPartage] = useState(false);

  useEffect(() => {
    if (!balade) return;
    setStats(null);
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const [{ data: st }, { data: p }, { data: parr }] = await Promise.all([
        supabase.rpc('mes_stats_balades'),
        session ? supabase.from('profils').select('prenom,nom_chien').eq('id', session.user.id).maybeSingle() : Promise.resolve({ data: null }),
        supabase.rpc('mon_parrainage'),
      ]);
      if (st) setStats(st as Stats);
      setMoi({ prenom: (p as any)?.prenom ?? null, nom_chien: (p as any)?.nom_chien ?? null, code: (parr as any)?.code ?? null });
    })();
  }, [balade]);

  async function partager() {
    if (!balade || !storyRef.current) return;
    setPartage(true);
    track('balade_partage', { km: Math.round(balade.distanceKm * 10) / 10 });
    try {
      // 1. photo de la carte affichee (trace deja ampute du debut et de la fin),
      // 2. placee en fond de la story, 3. capture de la story
      if (carteRef.current) {
        try {
          setStoryCarteUri(await captureRef(carteRef, { format: 'png', quality: 0.95 }));
          await new Promise(r => setTimeout(r, 350));
        } catch {}
      }
      const uri = await captureRef(storyRef, { format: 'png', quality: 1, width: 1080, height: 1920 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Partager ma balade' });
      else await Share.share({ url: uri });
    } catch {} finally { setPartage(false); }
  }

  if (!balade) return null;
  const chien = moi.nom_chien;
  const traceCarte = masquerExtremites(balade.trace);
  const fiche = mode === 'fiche';
  const partageable = !fiche || !!balade.estAMoi;
  const dateLabel = balade.date
    ? new Date(balade.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
    : '';
  const allure = formatAllure(balade.distanceKm, balade.dureeSec);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
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
              {stats.rang ? `${stats.rang}${stats.rang === 1 ? 'er' : 'e'} de la semaine` : 'Classement de la semaine'}
              {` · ${km1(Number(stats.semaine_km))} km au total`}
              {stats.serie_semaines > 1 ? ` · ${stats.serie_semaines} semaines d'affilée 🔥` : ''}
            </Text>
          ) : <ActivityIndicator size="small" color="#854F0B" />}
          <Ionicons name="chevron-forward" size={14} color="#854F0B" />
        </TouchableOpacity>
        ) : null}

        {partageable ? (
        <TouchableOpacity style={styles.cta} onPress={partager} disabled={partage}>
          {partage ? <ActivityIndicator color={colors.ivory} /> : (
            <>
              <Ionicons name="share-outline" size={17} color={colors.ivory} />
              <Text style={styles.ctaText}>Partager ma balade</Text>
            </>
          )}
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

      {/* Story 9:16 hors ecran */}
      <View ref={storyRef} collapsable={false} style={styles.story}>
        <Text style={styles.storyBrand}>THE PACK LA MEUTE</Text>
        <View style={styles.storyLine} />
        <Text style={styles.storyTitre}>{chien ? `Balade avec ${chien}` : 'Ma balade'}</Text>
        <Text style={styles.storyNom} numberOfLines={1}>{balade.nom}</Text>
        <View style={{ marginTop: 22 }}>
          {storyCarteUri
            ? <Image source={{ uri: storyCarteUri }} style={styles.storyCarte} resizeMode="cover" />
            : <TraceDessin trace={balade.trace} width={300} height={250} color={colors.terra} epaisseur={5} marge={16} />}
        </View>
        <View style={styles.storyStats}>
          <View style={styles.storyStat}><Text style={styles.storyVal}>{km1(balade.distanceKm)}</Text><Text style={styles.storyLbl}>km</Text></View>
          <View style={styles.storyStat}><Text style={styles.storyVal}>{formatDuree(balade.dureeSec)}</Text><Text style={styles.storyLbl}>durée</Text></View>
          <View style={styles.storyStat}><Text style={styles.storyVal}>{allure}</Text><Text style={styles.storyLbl}>/ km</Text></View>
        </View>
        {stats?.rang ? <Text style={styles.storyRang}>🏆 {stats.rang}{stats.rang === 1 ? 'er' : 'e'} de la semaine · {km1(Number(stats.semaine_km))} km</Text> : null}
        <View style={{ flex: 1 }} />
        {moi.code ? (
          <>
            <Text style={styles.storyCta}>Rejoins ma meute 🐾</Text>
            <View style={styles.storyCode}><Text style={styles.storyCodeText}>{moi.code}</Text></View>
          </>
        ) : <Text style={styles.storyCta}>Rejoins la meute 🐾</Text>}
        <Text style={styles.storyUrl}>App Store · Google Play</Text>
        <View style={{ height: 34 }} />
      </View>
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
  storyCarte: { width: 312, height: 250, borderRadius: 18 },
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

  story: {
    position: 'absolute', left: -9999, top: 0, width: 360, height: 640,
    backgroundColor: '#3D1A1A', alignItems: 'center', paddingTop: 44, paddingHorizontal: 24,
  },
  storyBrand: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: 'rgba(232,168,130,0.85)', letterSpacing: 2.5 },
  storyLine: { width: 260, height: 1, backgroundColor: 'rgba(196,105,58,0.5)', marginTop: 10 },
  storyTitre: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 30, color: '#F5EFE0', marginTop: 22, textAlign: 'center' },
  storyNom: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: 'rgba(245,239,224,0.6)', marginTop: 4 },
  storyStats: { flexDirection: 'row', marginTop: 18, alignSelf: 'stretch' },
  storyStat: { flex: 1, alignItems: 'center' },
  storyVal: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 28, color: '#F5EFE0' },
  storyLbl: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: 'rgba(245,239,224,0.55)', marginTop: 2 },
  storyRang: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: '#E8A882', marginTop: 16 },
  storyCta: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 17, color: '#F5EFE0' },
  storyCode: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 8, borderRadius: 12, backgroundColor: '#C4693A' },
  storyCodeText: { fontFamily: 'DMSans_500Medium', fontSize: 20, color: '#F5EFE0', letterSpacing: 2 },
  storyUrl: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: 'rgba(196,105,58,0.9)', marginTop: 10 },
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
