import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView, AppState } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { track } from '../lib/tracking';
import { colors } from '../lib/theme';

// Pop-up "Quoi de neuf" : affiche UNE fois par telephone, a partir de DEBUT,
// et seulement aux comptes crees avant (les nouveaux n'ont rien de "nouveau").
// Pour une prochaine annonce : changer ID_ANNONCE, DEBUT et NOUVEAUTES.
const ID_ANNONCE = '2026-10-25';
const DEBUT = new Date('2026-10-25T09:00:00+02:00');
const CLE = 'thepack_nouveautes_vues';

const NOUVEAUTES: { icon: keyof typeof Ionicons.glyphMap; titre: string; texte: string }[] = [
  { icon: 'footsteps', titre: 'Balades : le Top de la semaine', texte: 'Tes km comptent ! Grimpe au classement de ta meute et partage ta balade en story.' },
  { icon: 'people', titre: 'Invite tes amis dans ta meute', texte: 'Ton code parrain est dans ton profil. Débloque les badges Parrain, Chef de meute et Alpha.' },
  { icon: 'calendar', titre: 'Tes rendez-vous au même endroit', texte: 'Events enregistrés et réservations, avec un rappel la veille et 2 h avant.' },
  { icon: 'sparkles', titre: 'Avantages membres', texte: 'Des attentions réservées à la meute chez nos marques partenaires.' },
];

export default function NouveautesModal({
  creeLe, onBalade,
}: {
  creeLe: string | undefined; onBalade: () => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let deja = false;
    const verifier = () => {
      if (deja || Date.now() < DEBUT.getTime()) return;
      if (creeLe && new Date(creeLe) >= DEBUT) return;
      AsyncStorage.getItem(CLE).then(v => {
        if (v !== ID_ANNONCE && !deja) { deja = true; setVisible(true); track('nouveautes_vues', { id: ID_ANNONCE }); }
      }).catch(() => {});
    };
    verifier();
    // App laissee ouverte en arriere-plan depuis la veille : re-verifier au retour
    const sub = AppState.addEventListener('change', st => { if (st === 'active') verifier(); });
    return () => sub.remove();
  }, [creeLe]);

  function fermer(action: 'fermer' | 'balade') {
    setVisible(false);
    AsyncStorage.setItem(CLE, ID_ANNONCE).catch(() => {});
    track('nouveautes_action', { id: ID_ANNONCE, action });
    if (action === 'balade') onBalade();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => fermer('fermer')}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.paw}>🐾</Text>
          <Text style={styles.titre}>Du nouveau dans la meute</Text>
          <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 14, paddingVertical: 6 }}>
            {NOUVEAUTES.map(n => (
              <View key={n.titre} style={styles.item}>
                <View style={styles.icone}><Ionicons name={n.icon} size={18} color={colors.terra} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitre}>{n.titre}</Text>
                  <Text style={styles.itemTexte}>{n.texte}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.cta} onPress={() => fermer('balade')}>
            <Ionicons name="footsteps-outline" size={16} color={colors.ivory} />
            <Text style={styles.ctaText}>C'est parti, on va se balader</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.plusTard} onPress={() => fermer('fermer')}>
            <Text style={styles.plusTardText}>Découvrir plus tard</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(30,12,12,0.55)', justifyContent: 'center', padding: 22 },
  card: { backgroundColor: colors.ivoryPale, borderRadius: 22, padding: 22 },
  paw: { fontSize: 30, textAlign: 'center' },
  titre: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 22, color: colors.bordeaux, textAlign: 'center', marginTop: 4, marginBottom: 14 },
  item: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  icone: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(196,105,58,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  itemTitre: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
  itemTexte: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMid, lineHeight: 18, marginTop: 2 },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 18,
    backgroundColor: colors.terra, borderRadius: 14, paddingVertical: 14,
  },
  ctaText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.ivory },
  plusTard: { alignItems: 'center', paddingTop: 12 },
  plusTardText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.textMuted },
});
