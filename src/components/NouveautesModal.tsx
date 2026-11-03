import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView, AppState } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { track } from '../lib/tracking';
import { colors } from '../lib/theme';
import type { CibleVisite } from '../lib/visiteGuidee';

// Pop-up "Quoi de neuf" : affiche UNE fois par telephone, a partir de DEBUT,
// et seulement aux comptes crees avant (les nouveaux ont la visite guidee).
// Pour une prochaine annonce : changer ID_ANNONCE, DEBUT et NOUVEAUTES.
const ID_ANNONCE = '2026-11-03';
const DEBUT = new Date('2026-11-03T12:00:00+01:00');
const CLE = 'thepack_nouveautes_vues';

type Nouveaute = { icon: keyof typeof Ionicons.glyphMap; titre: string; texte: string; ou: string; cible?: CibleVisite };

const NOUVEAUTES: Nouveaute[] = [
  {
    icon: 'chatbubbles', titre: 'Messages comme sur Insta',
    texte: 'Glisse un message vers la droite pour y répondre, appui long pour réagir avec un emoji. Les liens sont cliquables et tu vois quand ton message a été lu.',
    ou: 'La bulle 💬 en haut à droite de chaque écran', cible: 'messages',
  },
  {
    icon: 'people', titre: 'Groupes de discussion',
    texte: 'Adoption, santé, toilettage, balades près de chez toi… Rejoins un groupe en un geste et échange avec la meute.',
    ou: 'Bulle 💬 › « Découvrir des groupes »', cible: 'messages',
  },
  {
    icon: 'footsteps', titre: 'Balades, badges et classement',
    texte: 'Enregistre tes balades, débloque des badges et partage ton classement du mois en story.',
    ou: 'Carte › bouton + › « Démarrer une balade »', cible: 'balade',
  },
  {
    icon: 'camera', titre: 'Partage tes moments',
    texte: 'Une photo de ton chien, un nouveau badge, un lieu que tu as adoré : publie-le dans le feed en deux secondes.',
    ou: 'Meute › Feed › « Partage un moment avec ton chien… »', cible: 'meute',
  },
  {
    icon: 'flash', titre: 'Une app plus rapide',
    texte: 'Les écrans s\'affichent tout de suite avec ton dernier contenu, puis se mettent à jour tout seuls.',
    ou: 'Partout !',
  },
];

export default function NouveautesModal({
  creeLe, onAller,
}: {
  creeLe: string | undefined; onAller: (cible: CibleVisite) => void;
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

  function fermer(action: string, cible?: CibleVisite) {
    setVisible(false);
    AsyncStorage.setItem(CLE, ID_ANNONCE).catch(() => {});
    track('nouveautes_action', { id: ID_ANNONCE, action });
    if (cible) onAller(cible);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => fermer('fermer')}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.paw}>🐾</Text>
          <Text style={styles.titre}>Du nouveau dans la meute</Text>
          <ScrollView style={{ maxHeight: 430 }} contentContainerStyle={{ gap: 16, paddingVertical: 6 }}>
            {NOUVEAUTES.map(n => (
              <View key={n.titre} style={styles.item}>
                <View style={styles.icone}><Ionicons name={n.icon} size={18} color={colors.terra} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitre}>{n.titre}</Text>
                  <Text style={styles.itemTexte}>{n.texte}</Text>
                  <View style={styles.ouLigne}>
                    <Ionicons name="location-outline" size={12} color={colors.terra} />
                    <Text style={styles.ou}>{n.ou}</Text>
                  </View>
                  {n.cible ? (
                    <TouchableOpacity onPress={() => fermer(`aller_${n.cible}`, n.cible)} hitSlop={6}>
                      <Text style={styles.aller}>Y aller ›</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.cta} onPress={() => fermer('compris')}>
            <Text style={styles.ctaText}>J'ai compris, merci !</Text>
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
  ouLigne: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  ou: { flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.terra },
  aller: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.bordeaux, marginTop: 4, textDecorationLine: 'underline' },
  cta: {
    alignItems: 'center', justifyContent: 'center', marginTop: 18,
    backgroundColor: colors.terra, borderRadius: 14, paddingVertical: 14,
  },
  ctaText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.ivory },
});
