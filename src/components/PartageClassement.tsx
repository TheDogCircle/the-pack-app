import React, { useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, Modal, TouchableOpacity, ScrollView, ActivityIndicator, Platform, Share } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../lib/theme';
import { track } from '../lib/tracking';

// Partage du classement du mois en image story (360 x 640, capturee en
// 1080 x 1920), meme principe que le partage de balade (BaladeResume).
// Zones de securite Instagram : rien d'important dans les ~90 px du haut et
// les ~100 px du bas.

export type LignePartage = { rang: number; nom: string; km: number; moi: boolean };
export type DonneesClassement = {
  mois: string;           // "octobre"
  portee: string;         // "Toute la meute", "Ma ville"...
  rang: number | null;
  km: number;
  nb: number;
  titre: string;          // "Marine & Albus"
  lignes: LignePartage[]; // top 3 (+ moi si hors podium)
};

const LOGO = require('../../assets/icon.png');
const MEDAILLES = ['🥇', '🥈', '🥉'];
const km1 = (v: number) => Number(v).toFixed(1).replace('.', ',');
const ordinal = (r: number) => `${r}${r === 1 ? 'er' : 'e'}`;

function StoryClassement({ d }: { d: DonneesClassement }) {
  return (
    <View style={s.base}>
      <Image source={LOGO} style={s.filigrane} />
      <View style={s.marque}>
        <Image source={LOGO} style={s.logo} />
        <Text style={s.marqueTexte}>THE PACK LA MEUTE</Text>
      </View>
      <Text style={s.surtitre}>CLASSEMENT DE {d.mois.toUpperCase()}</Text>
      <Text style={s.portee}>{d.portee}</Text>
      <Text style={s.rang}>{d.rang ? (d.rang <= 3 ? `${MEDAILLES[d.rang - 1]} ${ordinal(d.rang)}` : ordinal(d.rang)) : '–'}</Text>
      <Text style={s.titre} numberOfLines={1} adjustsFontSizeToFit>{d.titre}</Text>
      <View style={s.statsRangee}>
        <View style={s.statCase}>
          <Text style={s.statValeur}>{km1(d.km)} km</Text>
          <Text style={s.statLabel}>CE MOIS-CI</Text>
        </View>
        <View style={s.separateur} />
        <View style={s.statCase}>
          <Text style={s.statValeur}>{d.nb}</Text>
          <Text style={s.statLabel}>BALADE{d.nb > 1 ? 'S' : ''}</Text>
        </View>
      </View>
      <View style={s.liste}>
        {d.lignes.map(l => (
          <View key={`${l.rang}-${l.nom}`} style={[s.ligne, l.moi && s.ligneMoi]}>
            <Text style={s.ligneRang}>{l.rang <= 3 ? MEDAILLES[l.rang - 1] : l.rang}</Text>
            <Text style={[s.ligneNom, l.moi && { color: colors.bordeaux }]} numberOfLines={1}>{l.nom}</Text>
            <Text style={[s.ligneKm, l.moi && { color: colors.bordeaux }]}>{km1(l.km)} km</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function PartageClassement({ donnees, onClose }: { donnees: DonneesClassement | null; onClose: () => void }) {
  const ref = useRef<View>(null);
  const [envoi, setEnvoi] = useState(false);

  async function partager() {
    if (!ref.current || !donnees) return;
    setEnvoi(true);
    track('classement_partage', { rang: donnees.rang, portee: donnees.portee });
    try {
      const uri = await captureRef(ref, { format: 'png', quality: 1, width: 1080, height: 1920 });
      if (Platform.OS === 'ios') await Share.share({ url: uri });
      else if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Partager mon classement' });
    } catch {} finally { setEnvoi(false); }
  }

  return (
    <Modal visible={!!donnees} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.page}>
        <View style={s.top}>
          <Text style={s.pageTitre}>Partager mon classement</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityLabel="Fermer">
            <Ionicons name="close" size={24} color={colors.bordeaux} />
          </TouchableOpacity>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', paddingVertical: 12 }}>
          {donnees ? (
            <View ref={ref} collapsable={false} style={{ width: 360, height: 640 }}>
              <StoryClassement d={donnees} />
            </View>
          ) : null}
        </ScrollView>
        <TouchableOpacity style={s.cta} onPress={partager} disabled={envoi}>
          {envoi ? <ActivityIndicator color={colors.ivory} /> : (
            <>
              <Ionicons name="share-outline" size={17} color={colors.ivory} />
              <Text style={s.ctaTexte}>Partager</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ivoryPale, paddingHorizontal: 22, paddingTop: 18 },
  top: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  pageTitre: { flex: 1, fontFamily: 'PlayfairDisplay_500Medium', fontSize: 20, color: colors.bordeaux },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.bordeaux, borderRadius: 14, paddingVertical: 15, marginBottom: 28,
  },
  ctaTexte: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.ivory },

  base: { width: 360, height: 640, backgroundColor: colors.bordeaux, alignItems: 'center', overflow: 'hidden' },
  filigrane: { position: 'absolute', width: 420, height: 420, opacity: 0.05, bottom: -90, right: -120 },
  marque: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 96 },
  logo: { width: 30, height: 30, borderRadius: 8 },
  marqueTexte: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#F5EFE0', letterSpacing: 2.4 },
  surtitre: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: 'rgba(245,239,224,0.7)', letterSpacing: 2, marginTop: 26 },
  portee: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: 'rgba(245,239,224,0.55)', marginTop: 4 },
  rang: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 64, color: colors.ivory, marginTop: 6 },
  titre: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 22, color: colors.ivory, marginTop: 2, paddingHorizontal: 24 },
  statsRangee: { flexDirection: 'row', alignItems: 'center', marginTop: 18, alignSelf: 'stretch', paddingHorizontal: 40 },
  statCase: { flex: 1, alignItems: 'center' },
  statValeur: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 24, color: colors.ivory },
  statLabel: { fontFamily: 'DMSans_500Medium', fontSize: 10, color: 'rgba(245,239,224,0.6)', letterSpacing: 1.5, marginTop: 2 },
  separateur: { width: 1, height: 34, backgroundColor: 'rgba(245,239,224,0.25)' },
  liste: { alignSelf: 'stretch', marginHorizontal: 28, marginTop: 22, gap: 6 },
  ligne: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12,
    backgroundColor: 'rgba(245,239,224,0.08)',
  },
  ligneMoi: { backgroundColor: colors.ivory },
  ligneRang: { width: 28, fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.ivory, textAlign: 'center' },
  ligneNom: { flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.ivory, marginLeft: 6 },
  ligneKm: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.ivory },
});
