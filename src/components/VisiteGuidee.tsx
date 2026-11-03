import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { track } from '../lib/tracking';
import { colors } from '../lib/theme';
import { visiteGuidee, type CibleVisite } from '../lib/visiteGuidee';

// Visite guidee de l'app, en quelques ecrans : montree UNE fois aux comptes
// crees a partir de DEBUT (les anciens ont la fenetre "Quoi de neuf"), juste
// apres l'inscription. Reouvrable depuis Reglages (visiteGuidee.ouvrir()).
const DEBUT = new Date('2026-11-03T12:00:00+01:00');
const CLE = (uid: string) => `thepack_visite_vue_${uid}`;

type Etape = { icon: keyof typeof Ionicons.glyphMap; couleur: string; titre: string; texte: string; points: string[]; cible?: CibleVisite };

const ETAPES: Etape[] = [
  {
    icon: 'paw', couleur: colors.terra, titre: 'Bienvenue dans la meute !',
    texte: 'The Pack La Meute, c\'est l\'app des propriétaires de chiens : des lieux où ton chien est le bienvenu, des balades, des rencontres et des pros de confiance.',
    points: ['Une visite rapide pour tout découvrir', 'Tu pourras la revoir dans Réglages'],
  },
  {
    icon: 'map', couleur: colors.terra, titre: 'La Carte',
    texte: 'Trouve les lieux dog-friendly autour de toi : cafés, restos, parcs, plages, hôtels, boutiques…',
    points: ['Filtre par catégorie en haut de la carte', 'Ouvre une fiche pour voir photos, avis et infos chiens', 'Bouton + : suggérer un lieu qui manque'],
    cible: 'carte',
  },
  {
    icon: 'footsteps', couleur: colors.sage, titre: 'Les balades',
    texte: 'Enregistre tes promenades avec ton chien, découvre celles des autres et grimpe au classement du mois.',
    points: ['Carte › bouton + › « Démarrer une balade »', 'Débloque des badges (5 km, 10 km…)', 'Partage ta balade ou ton classement en story'],
    cible: 'balade',
  },
  {
    icon: 'people', couleur: colors.bordeaux, titre: 'La Meute',
    texte: 'Le fil de la communauté : photos, balades et nouveaux lieux partagés par les membres.',
    points: ['Feed : publie un moment avec ton chien', 'Membres : trouve des chiens près de chez toi et suis-les', 'Le ♡ en haut : tes notifications'],
    cible: 'meute',
  },
  {
    icon: 'chatbubbles', couleur: colors.bordeaux, titre: 'Messages et groupes',
    texte: 'Discute en privé avec d\'autres membres ou rejoins des groupes : adoption, santé, toilettage, balades par ville…',
    points: ['La bulle 💬 en haut à droite de chaque écran', '« Découvrir des groupes » pour en rejoindre', 'Glisse un message pour répondre, appui long pour réagir'],
    cible: 'messages',
  },
  {
    icon: 'calendar', couleur: colors.terra, titre: 'Events et Partenaires',
    texte: 'Sorties canines, ateliers et rencontres près de chez toi, et des pros de confiance : éducateurs, toiletteurs, promeneurs…',
    points: ['Events : inscris-toi en un geste, rappel la veille', 'Partenaires : réserve un pro, profite des avantages membres'],
    cible: 'events',
  },
  {
    icon: 'person-circle', couleur: colors.sage, titre: 'Ton profil',
    texte: 'Le coin de ton chien et le tien.',
    points: ['Santé : le carnet de santé de ton chien', 'Rendez-vous : tes events et réservations', 'Ma meute : invite tes amis et gagne des badges'],
    cible: 'profil',
  },
];

export default function VisiteGuidee({
  userId, creeLe, onAller,
}: {
  userId: string; creeLe: string | undefined; onAller: (cible: CibleVisite) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [i, setI] = useState(0);

  // Premiere fois pour un nouveau compte
  useEffect(() => {
    if (!creeLe || new Date(creeLe) < DEBUT) return;
    AsyncStorage.getItem(CLE(userId)).then(v => {
      if (!v) { setI(0); setVisible(true); track('visite_guidee', { action: 'ouverte_auto' }); }
    }).catch(() => {});
  }, [userId, creeLe]);

  // Reouverture depuis Reglages
  useEffect(() => {
    visiteGuidee.ecouter(() => { setI(0); setVisible(true); track('visite_guidee', { action: 'ouverte_reglages' }); });
    return () => visiteGuidee.ecouter(null);
  }, []);

  function fermer(action: string, cible?: CibleVisite) {
    setVisible(false);
    AsyncStorage.setItem(CLE(userId), '1').catch(() => {});
    track('visite_guidee', { action, etape: i });
    if (cible) onAller(cible);
  }

  const e = ETAPES[i];
  const derniere = i === ETAPES.length - 1;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => fermer('fermer')}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <TouchableOpacity style={styles.passer} onPress={() => fermer('passer')} hitSlop={10}>
            <Text style={styles.passerTexte}>Passer</Text>
          </TouchableOpacity>

          <View style={[styles.rond, { backgroundColor: e.couleur }]}>
            <Ionicons name={e.icon} size={34} color={colors.ivory} />
          </View>
          <Text style={styles.titre}>{e.titre}</Text>
          <Text style={styles.texte}>{e.texte}</Text>

          <View style={styles.points}>
            {e.points.map(p => (
              <View key={p} style={styles.point}>
                <Ionicons name="checkmark-circle" size={16} color={e.couleur} />
                <Text style={styles.pointTexte}>{p}</Text>
              </View>
            ))}
          </View>

          {e.cible ? (
            <TouchableOpacity onPress={() => fermer(`essayer_${e.cible}`, e.cible)} hitSlop={6}>
              <Text style={styles.essayer}>Essayer maintenant ›</Text>
            </TouchableOpacity>
          ) : null}

          <View style={styles.points3}>
            {ETAPES.map((_, k) => <View key={k} style={[styles.dot, k === i && styles.dotActif]} />)}
          </View>

          <View style={styles.boutons}>
            {i > 0 ? (
              <TouchableOpacity style={styles.retour} onPress={() => setI(i - 1)}>
                <Ionicons name="chevron-back" size={18} color={colors.bordeaux} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={styles.suivant}
              onPress={() => (derniere ? fermer('terminee') : setI(i + 1))}
            >
              <Text style={styles.suivantTexte}>{derniere ? 'C\'est parti !' : i === 0 ? 'Découvrir' : 'Suivant'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(30,12,12,0.6)', justifyContent: 'center', padding: 22 },
  card: { backgroundColor: colors.ivoryPale, borderRadius: 24, padding: 24, paddingTop: 30, alignItems: 'center' },
  passer: { position: 'absolute', top: 14, right: 18 },
  passerTexte: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.textMuted },
  rond: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  titre: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 23, color: colors.bordeaux, textAlign: 'center', marginTop: 14 },
  texte: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.textMid, textAlign: 'center', lineHeight: 20, marginTop: 8 },
  points: { alignSelf: 'stretch', gap: 8, marginTop: 16 },
  point: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  pointTexte: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.bordeaux, lineHeight: 18 },
  essayer: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.terra, marginTop: 14, textDecorationLine: 'underline' },
  points3: { flexDirection: 'row', gap: 6, marginTop: 18 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(61,26,26,0.15)' },
  dotActif: { width: 18, backgroundColor: colors.terra },
  boutons: { flexDirection: 'row', alignSelf: 'stretch', gap: 10, marginTop: 18 },
  retour: {
    width: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  suivant: { flex: 1, backgroundColor: colors.terra, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  suivantTexte: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.ivory },
});
