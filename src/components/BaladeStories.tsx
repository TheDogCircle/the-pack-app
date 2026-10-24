import React, { useRef } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../lib/theme';
import TraceDessin from './TraceDessin';

// Mises en page de story (360 x 640, capturees en 1080 x 1920).
// Zones de securite Instagram : le haut (~90 px) et le bas (~100 px) sont
// recouverts par l'interface d'Instagram, rien d'important n'y est place.
// "Stats" et "Trace" ont un fond transparent : a poser sur sa propre photo.

export type MiseEnPage = 'carte' | 'marque' | 'stats' | 'trace';

export const MISES_EN_PAGE: { key: MiseEnPage; label: string; transparent: boolean }[] = [
  { key: 'carte', label: 'Carte', transparent: false },
  { key: 'marque', label: 'The Pack', transparent: false },
  { key: 'stats', label: 'Stats', transparent: true },
  { key: 'trace', label: 'Tracé', transparent: true },
];

export type DonneesStory = {
  titre: string; nom: string; km: string; duree: string; allure: string; date: string;
  rang: string | null; trace: { latitude: number; longitude: number; b?: 1 }[];
};

const LOGO = require('../../assets/icon.png');
const ombre = { textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8 };

function Marque({ clair }: { clair?: boolean }) {
  return (
    <View style={s.marque}>
      <Image source={LOGO} style={s.logo} />
      <Text style={[s.marqueTexte, clair && ombre]}>THE PACK LA MEUTE</Text>
    </View>
  );
}

function Stats({ d, clair }: { d: DonneesStory; clair?: boolean }) {
  const items: [string, string][] = [['Distance', `${d.km} km`], ['Durée', d.duree], ['Allure', `${d.allure}/km`]];
  return (
    <View style={s.statsRangee}>
      {items.map(([label, valeur], i) => (
        <React.Fragment key={label}>
          {i > 0 ? <View style={[s.separateur, clair && { backgroundColor: 'rgba(255,255,255,0.5)' }]} /> : null}
          <View style={s.statCase}>
            <Text style={[s.statLabel, clair && { color: '#fff' }, clair && ombre]}>{label.toUpperCase()}</Text>
            <Text style={[s.statValeur, clair && ombre]} numberOfLines={1} adjustsFontSizeToFit>{valeur}</Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

// Trace avec liseré blanc (deux passes du meme dessin)
function TraceContour({ trace, width, height, epaisseur }: { trace: DonneesStory['trace']; width: number; height: number; epaisseur: number }) {
  return (
    <View style={{ width, height }}>
      <View style={StyleSheet.absoluteFill}><TraceDessin trace={trace} width={width} height={height} color="#FFFFFF" epaisseur={epaisseur + 5} marge={24} /></View>
      <View style={StyleSheet.absoluteFill}><TraceDessin trace={trace} width={width} height={height} color={colors.terra} epaisseur={epaisseur} marge={24} /></View>
    </View>
  );
}

// Carte affichee en direct (nette a la capture). Plus haute que son cadre pour
// que la mention legale du fournisseur de carte sorte du champ.
export function CarteStory({ trace, onPrete }: { trace: DonneesStory['trace']; onPrete?: () => void }) {
  const ref = useRef<MapView>(null);
  return (
    <View style={s.carteCadre} pointerEvents="none">
      <MapView
        ref={ref}
        style={{ position: 'absolute', left: -40, right: -40, top: 0, height: 470 }}
        scrollEnabled={false} zoomEnabled={false} rotateEnabled={false} pitchEnabled={false}
        toolbarEnabled={false} showsPointsOfInterest={false} showsBuildings={false}
        onMapReady={() => {
          if (trace.length > 1) ref.current?.fitToCoordinates(trace, {
            edgePadding: { top: 130, right: 80, bottom: 160, left: 80 }, animated: false,
          });
        }}
        onMapLoaded={() => setTimeout(() => onPrete?.(), 500)}
      >
        <Polyline coordinates={trace} strokeColor="#FFFFFF" strokeWidth={10} lineCap="round" lineJoin="round" />
        <Polyline coordinates={trace} strokeColor={colors.terra} strokeWidth={5.5} lineCap="round" lineJoin="round" />
      </MapView>
      <LinearGradient
        colors={['rgba(61,26,26,0.55)', 'rgba(61,26,26,0)', 'rgba(61,26,26,0)', colors.bordeaux]}
        locations={[0, 0.28, 0.62, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

export function StoryBalade({ type, d, carte }: { type: MiseEnPage; d: DonneesStory; carte?: React.ReactNode }) {
  if (type === 'carte') {
    return (
      <View style={[s.base, { backgroundColor: colors.bordeaux }]}>
        {carte}
        <View style={s.marqueHaut}><Marque clair /></View>
        <View style={s.basCarte}>
          <Text style={s.titre} numberOfLines={1} adjustsFontSizeToFit>{d.titre}</Text>
          <Text style={s.sousTitre} numberOfLines={1}>{d.date}</Text>
          <Stats d={d} />
          {d.rang ? <View style={s.rangPilule}><Text style={s.rangTexte}>🏆 {d.rang}</Text></View> : null}
        </View>
      </View>
    );
  }
  if (type === 'marque') {
    return (
      <View style={[s.base, { backgroundColor: colors.bordeaux, alignItems: 'center' }]}>
        <Image source={LOGO} style={s.filigrane} />
        <View style={{ marginTop: 96 }}><Marque /></View>
        <Text style={[s.titre, { marginTop: 18, textAlign: 'center' }]} numberOfLines={1} adjustsFontSizeToFit>{d.titre}</Text>
        <Text style={[s.sousTitre, { textAlign: 'center' }]} numberOfLines={1}>{d.date}</Text>
        <View style={{ marginTop: 6 }}><TraceContour trace={d.trace} width={312} height={230} epaisseur={5} /></View>
        <View style={{ alignSelf: 'stretch', paddingHorizontal: 22 }}><Stats d={d} /></View>
        {d.rang ? <View style={s.rangPilule}><Text style={s.rangTexte}>🏆 {d.rang}</Text></View> : null}
      </View>
    );
  }
  if (type === 'stats') {
    return (
      <View style={[s.base, { alignItems: 'center', justifyContent: 'center' }]}>
        <Marque clair />
        {[['DISTANCE', `${d.km} km`], ['DURÉE', d.duree], ['ALLURE', `${d.allure} /km`]].map(([l, v]) => (
          <View key={l} style={{ alignItems: 'center', marginTop: 22 }}>
            <Text style={[s.grandLabel, ombre]}>{l}</Text>
            <Text style={[s.grandeValeur, ombre]}>{v}</Text>
          </View>
        ))}
      </View>
    );
  }
  // 'trace'
  return (
    <View style={[s.base, { alignItems: 'center', justifyContent: 'center' }]}>
      <TraceContour trace={d.trace} width={320} height={300} epaisseur={6} />
      <Text style={[s.titre, ombre, { textAlign: 'center', marginTop: 4 }]} numberOfLines={1} adjustsFontSizeToFit>{d.titre}</Text>
      <Text style={[s.ligneStats, ombre]}>{d.km} km  ·  {d.duree}  ·  {d.allure}/km</Text>
      <View style={{ marginTop: 18 }}><Marque clair /></View>
    </View>
  );
}

const s = StyleSheet.create({
  base: { width: 360, height: 640, backgroundColor: 'transparent', overflow: 'hidden' },
  marque: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo: { width: 30, height: 30, borderRadius: 8 },
  marqueTexte: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#F5EFE0', letterSpacing: 2.4 },
  marqueHaut: {
    position: 'absolute', top: 96, left: 22, paddingVertical: 6, paddingLeft: 6, paddingRight: 12,
    borderRadius: 14, backgroundColor: 'rgba(61,26,26,0.82)',
  },
  carteCadre: { position: 'absolute', left: 0, right: 0, top: 0, height: 430, overflow: 'hidden' },
  basCarte: { position: 'absolute', left: 22, right: 22, top: 392 },
  titre: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 30, color: '#F5EFE0' },
  sousTitre: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.terraPale, marginTop: 3 },
  statsRangee: { flexDirection: 'row', alignItems: 'center', marginTop: 18 },
  statCase: { flex: 1, alignItems: 'center' },
  separateur: { width: 1, height: 34, backgroundColor: 'rgba(232,168,130,0.35)' },
  statLabel: { fontFamily: 'DMSans_500Medium', fontSize: 10, color: colors.terraPale, letterSpacing: 1.4 },
  statValeur: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 27, color: '#F5EFE0', marginTop: 3 },
  rangPilule: {
    alignSelf: 'center', marginTop: 16, backgroundColor: colors.terra, borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 6,
  },
  rangTexte: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: '#F5EFE0' },
  filigrane: { position: 'absolute', width: 300, height: 300, right: -90, bottom: -60, opacity: 0.07, transform: [{ rotate: '-18deg' }] },
  grandLabel: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: '#FFFFFF', letterSpacing: 2 },
  grandeValeur: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 50, color: '#FFFFFF', marginTop: 2 },
  ligneStats: { fontFamily: 'DMSans_500Medium', fontSize: 16, color: '#FFFFFF', marginTop: 8 },
});
