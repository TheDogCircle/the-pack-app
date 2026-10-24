import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { colors } from '../lib/theme';
import TraceDessin from './TraceDessin';

// Mises en page de story (360 x 640, capturees en 1080 x 1920).
// Les deux versions "transparentes" se posent par-dessus sa propre photo dans
// Instagram (image enregistree ou copiee, puis ajoutee en sticker).

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

const ombre = { textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 };

function Stat({ label, valeur, grand, clair }: { label: string; valeur: string; grand?: boolean; clair?: boolean }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={[s.lbl, clair && ombre]}>{label}</Text>
      <Text style={[grand ? s.valGrand : s.val, clair && ombre]}>{valeur}</Text>
    </View>
  );
}

export function StoryBalade({ type, d, carteUri }: { type: MiseEnPage; d: DonneesStory; carteUri: string | null }) {
  if (type === 'stats') {
    return (
      <View style={[s.base, s.centre]}>
        <Text style={[s.brandBlanc, ombre]}>THE PACK LA MEUTE</Text>
        <View style={{ height: 28 }} />
        <Stat label="Distance" valeur={`${d.km} km`} grand clair />
        <View style={{ height: 22 }} />
        <Stat label="Durée" valeur={d.duree} grand clair />
        <View style={{ height: 22 }} />
        <Stat label="Allure" valeur={`${d.allure} /km`} grand clair />
        <Text style={[s.titreBlanc, ombre, { marginTop: 30 }]}>{d.titre} 🐾</Text>
      </View>
    );
  }
  if (type === 'trace') {
    return (
      <View style={[s.base, s.centre]}>
        <TraceDessin trace={d.trace} width={300} height={300} color={colors.terra} epaisseur={6} marge={20} />
        <Text style={[s.titreBlanc, ombre, { marginTop: 12 }]}>{d.titre}</Text>
        <Text style={[s.ligneStats, ombre]}>{d.km} km · {d.duree} · {d.allure} /km</Text>
        <Text style={[s.brandBlanc, ombre, { marginTop: 18 }]}>THE PACK LA MEUTE 🐾</Text>
      </View>
    );
  }
  if (type === 'carte') {
    return (
      <View style={[s.base, { backgroundColor: colors.bordeaux, alignItems: 'center', paddingTop: 40 }]}>
        <Text style={s.brand}>THE PACK LA MEUTE</Text>
        <View style={s.carteCadre}>
          {carteUri
            ? <Image source={{ uri: carteUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            : <View style={[StyleSheet.absoluteFill, s.centre]}><TraceDessin trace={d.trace} width={280} height={300} color={colors.terra} /></View>}
        </View>
        <Text style={s.titre}>{d.titre}</Text>
        <Text style={s.sousTitre} numberOfLines={1}>{d.nom} · {d.date}</Text>
        <View style={s.statsLigne}>
          <Stat label="Distance" valeur={`${d.km} km`} />
          <Stat label="Durée" valeur={d.duree} />
          <Stat label="Allure" valeur={`${d.allure} /km`} />
        </View>
        {d.rang ? <Text style={s.rang}>🏆 {d.rang}</Text> : null}
      </View>
    );
  }
  // 'marque'
  return (
    <View style={[s.base, { backgroundColor: colors.bordeaux, alignItems: 'center', paddingTop: 44 }]}>
      <Text style={s.brand}>THE PACK LA MEUTE</Text>
      <View style={s.ligne} />
      <Text style={[s.titre, { marginTop: 22 }]}>{d.titre}</Text>
      <Text style={s.sousTitre} numberOfLines={1}>{d.nom}</Text>
      <View style={{ marginTop: 20 }}>
        <TraceDessin trace={d.trace} width={300} height={250} color={colors.terra} epaisseur={5} marge={16} />
      </View>
      <View style={s.statsLigne}>
        <Stat label="Distance" valeur={`${d.km} km`} />
        <Stat label="Durée" valeur={d.duree} />
        <Stat label="Allure" valeur={`${d.allure} /km`} />
      </View>
      {d.rang ? <Text style={s.rang}>🏆 {d.rang}</Text> : null}
      <View style={{ flex: 1 }} />
      <Text style={s.date}>{d.date}</Text>
      <View style={{ height: 34 }} />
    </View>
  );
}

// Apercu reduit (moitie de taille) d'une mise en page
export function ApercuStory({ type, d, carteUri, actif }: { type: MiseEnPage; d: DonneesStory; carteUri: string | null; actif: boolean }) {
  const transparent = MISES_EN_PAGE.find(m => m.key === type)?.transparent;
  return (
    <View style={[s.apercu, transparent && s.apercuDamier, actif && s.apercuActif]}>
      <View style={{ width: 360, height: 640, transform: [{ scale: 0.5 }], marginLeft: -90, marginTop: -160 }}>
        <StoryBalade type={type} d={d} carteUri={carteUri} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  base: { width: 360, height: 640, backgroundColor: 'transparent', paddingHorizontal: 24 },
  centre: { alignItems: 'center', justifyContent: 'center' },
  brand: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: 'rgba(232,168,130,0.85)', letterSpacing: 2.5 },
  brandBlanc: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#FFFFFF', letterSpacing: 2.5 },
  ligne: { width: 260, height: 1, backgroundColor: 'rgba(196,105,58,0.5)', marginTop: 10 },
  titre: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 26, color: '#F5EFE0', marginTop: 18, textAlign: 'center' },
  titreBlanc: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 22, color: '#FFFFFF', textAlign: 'center' },
  sousTitre: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: 'rgba(245,239,224,0.6)', marginTop: 4 },
  carteCadre: { width: 312, height: 300, borderRadius: 20, overflow: 'hidden', marginTop: 18, backgroundColor: '#522222' },
  statsLigne: { flexDirection: 'row', justifyContent: 'space-around', alignSelf: 'stretch', marginTop: 20 },
  lbl: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: 'rgba(245,239,224,0.75)' },
  val: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 24, color: '#F5EFE0', marginTop: 2 },
  valGrand: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 44, color: '#FFFFFF', marginTop: 2 },
  ligneStats: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FFFFFF', marginTop: 6 },
  rang: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: '#E8A882', marginTop: 18 },
  date: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: 'rgba(245,239,224,0.45)' },
  apercu: { width: 180, height: 320, borderRadius: 16, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  apercuDamier: { backgroundColor: '#5a5a5a' },
  apercuActif: { borderColor: colors.terra },
});
