import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, RefreshControl, Image,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { supabase } from '../lib/supabase';
import { useSession } from '../hooks/useSession';
import { colors } from '../lib/theme';
import { mapNavigation } from '../lib/mapNavigation';
import { chargerMesEvenementsAVenir, synchroniserRappelsEvenements, type MonEvenement } from '../lib/rappelsEvenements';

type Reservation = {
  id: string;
  date: string;
  heure_debut: string;
  heure_fin: string;
  statut: string;
  statut_paiement: string;
  montant_ht: number;
  montant_rembourse: number | null;
  presence: string | null;
  lieux: { nom: string } | null;
  prestations: { nom: string } | null;
};

// Phase Pro 5 : compte rendu poste par le pro apres une prestation terminee
// (photo/duree/notes) -- affiche ici, jamais cree depuis l'app (cote pro
// uniquement, espace-pro.html).
type CompteRendu = { reservation_id: string; photo_url: string | null; duree_minutes: number | null; notes: string | null };

// Abonnement recurrent (offre type 'abonnement') actif de l'utilisateur.
type AbonnementReservation = {
  id: string;
  jour_semaine: number;
  heure_debut: string;
  statut: string;
  lieux: { nom: string } | null;
  offers: { nom: string } | null;
};
const JOURS_LABELS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

// Format .ics universel (Apple Calendar, Google Calendar, tout client compatible RFC 5545) --
// evite d'avoir a integrer deux SDK/OAuth differents pour un simple ajout d'evenement.
function icsDate(date: string, heure: string): string {
  return `${date.replace(/-/g, '')}T${heure.replace(/:/g, '').slice(0, 6)}Z`;
}
function icsEscape(text: string): string {
  return text.replace(/[\\,;]/g, m => '\\' + m).replace(/\n/g, '\\n');
}
function buildIcs(resa: Reservation): string {
  const summary = icsEscape([resa.prestations?.nom, resa.lieux?.nom].filter(Boolean).join(' — ') || 'Rendez-vous The Pack La Meute');
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//The Pack La Meute//FR',
    'BEGIN:VEVENT',
    `UID:${resa.id}@thepacklameute.fr`,
    `DTSTAMP:${now}`,
    `DTSTART:${icsDate(resa.date, resa.heure_debut)}`,
    `DTEND:${icsDate(resa.date, resa.heure_fin || resa.heure_debut)}`,
    `SUMMARY:${summary}`,
    'DESCRIPTION:Rendez-vous pris via The Pack La Meute',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
async function addToCalendar(resa: Reservation) {
  try {
    const uri = FileSystem.cacheDirectory + `rdv-${resa.id}.ics`;
    await FileSystem.writeAsStringAsync(uri, buildIcs(resa));
    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) { Alert.alert('Indisponible', "Le partage n'est pas disponible sur cet appareil."); return; }
    await Sharing.shareAsync(uri, { mimeType: 'text/calendar', dialogTitle: 'Ajouter au calendrier', UTI: 'com.apple.ical.ics' });
  } catch (e: any) {
    Alert.alert('Erreur', "Impossible de générer l'événement calendrier.");
  }
}

const STATUT_LABELS: Record<string, { label: string; color: string }> = {
  en_attente: { label: 'En attente de paiement', color: colors.textMuted },
  confirmee:  { label: 'Confirmée', color: colors.sage },
  annulee:    { label: 'Annulée', color: '#C62828' },
  terminee:   { label: 'Terminée', color: colors.textMuted },
};

function refundPreview(date: string, heure_debut: string): { percent: number; label: string } {
  const rdvDate = new Date(`${date}T${heure_debut}Z`);
  const hoursUntil = (rdvDate.getTime() - Date.now()) / 3_600_000;
  return hoursUntil >= 24
    ? { percent: 100, label: 'Remboursement intégral (100%)' }
    : { percent: 50, label: 'Remboursement partiel (50%) — annulation à moins de 24h' };
}

export default function MesReservationsScreen() {
  const navigation = useNavigation<any>();
  const { session } = useSession();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [comptesRendus, setComptesRendus] = useState<Record<string, CompteRendu>>({});
  const [abonnements, setAbonnements] = useState<AbonnementReservation[]>([]);
  const [cancellingAbonnementId, setCancellingAbonnementId] = useState<string | null>(null);
  const [mesEvents, setMesEvents] = useState<MonEvenement[]>([]);

  const load = useCallback(async () => {
    if (!session) return;
    const [{ data }, { data: abos }] = await Promise.all([
      supabase
        .from('reservations')
        .select('id, date, heure_debut, heure_fin, statut, statut_paiement, montant_ht, montant_rembourse, presence, lieux(nom), prestations(nom)')
        .eq('user_id', session.user.id)
        .order('date', { ascending: false })
        .order('heure_debut', { ascending: false }),
      supabase
        .from('abonnements_reservations')
        .select('id, jour_semaine, heure_debut, statut, lieux(nom), offers(nom)')
        .eq('user_id', session.user.id)
        .eq('statut', 'actif'),
    ]);
    // Evenements a venir (inscrit ou enregistre) + recalage des rappels locaux
    try {
      const evs = await chargerMesEvenementsAVenir(session.user.id);
      setMesEvents(evs);
      synchroniserRappelsEvenements(evs.filter(e => e.statut === 'enregistre'));
    } catch { setMesEvents([]); }

    const resas = (data as any) || [];
    setReservations(resas);
    setAbonnements((abos as any) || []);

    const termineesIds = resas.filter((r: Reservation) => r.statut === 'terminee').map((r: Reservation) => r.id);
    if (termineesIds.length) {
      const { data: crs } = await supabase
        .from('comptes_rendus')
        .select('reservation_id, photo_url, duree_minutes, notes')
        .in('reservation_id', termineesIds);
      const map: Record<string, CompteRendu> = {};
      (crs || []).forEach((cr: CompteRendu) => { map[cr.reservation_id] = cr; });
      setComptesRendus(map);
    } else {
      setComptesRendus({});
    }

    setLoading(false);
    setRefreshing(false);
  }, [session?.user.id]);

  useEffect(() => { load(); }, [load]);

  function handleCancelAbonnement(abo: AbonnementReservation) {
    Alert.alert(
      'Annuler cet abonnement ?',
      `Le prélèvement récurrent (${abo.offers?.nom || 'abonnement'}) sera arrêté. Les séances déjà réservées ne sont pas annulées par cette action.`,
      [
        { text: 'Retour', style: 'cancel' },
        {
          text: "Arrêter l'abonnement", style: 'destructive',
          onPress: async () => {
            setCancellingAbonnementId(abo.id);
            try {
              const { data, error } = await supabase.functions.invoke('cancel-abonnement-reservation', { body: { abonnement_id: abo.id } });
              if (error) throw error;
              if (data?.error) throw new Error(data.error);
              await load();
            } catch (e: any) {
              Alert.alert('Erreur', e.message || "Impossible d'annuler l'abonnement pour le moment.");
            } finally {
              setCancellingAbonnementId(null);
            }
          },
        },
      ]
    );
  }

  async function handleCancel(resa: Reservation) {
    const estPayee = resa.statut_paiement === 'paye';
    const preview = estPayee ? refundPreview(resa.date, resa.heure_debut) : null;
    const message = preview
      ? `Annuler ce RDV ? ${preview.label}.`
      : 'Annuler cette réservation ?';

    Alert.alert('Confirmer l\'annulation', message, [
      { text: 'Retour', style: 'cancel' },
      {
        text: 'Annuler le RDV', style: 'destructive',
        onPress: async () => {
          setCancellingId(resa.id);
          try {
            const { data, error } = await supabase.functions.invoke('cancel-reservation', {
              body: { reservation_id: resa.id },
            });
            if (error) throw error;
            if (data?.error) throw new Error(data.error);
            await load();
            Alert.alert(
              'Réservation annulée',
              data?.refunded
                ? `${Number(data.montant_rembourse).toFixed(2)} € remboursés.`
                : 'Ta réservation a été annulée.'
            );
          } catch (e: any) {
            Alert.alert('Erreur', e.message || "Impossible d'annuler pour le moment.");
          } finally {
            setCancellingId(null);
          }
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.terra} size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.terra} />}
    >
      {mesEvents.length > 0 && (
        <View style={{ gap: 10 }}>
          <Text style={styles.sectionTitle}>Événements à venir</Text>
          {mesEvents.map(ev => {
            const d = new Date(ev.date_heure);
            const debutJour = new Date(); debutJour.setHours(0, 0, 0, 0);
            const finJour = new Date(debutJour); finJour.setDate(finJour.getDate() + 1);
            const aujourdHui = d >= debutJour && d < finJour;
            const dateLabel = aujourdHui
              ? `Aujourd'hui à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
              : `${d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
            return (
              <TouchableOpacity
                key={ev.id}
                style={styles.card}
                activeOpacity={0.85}
                onPress={() => { mapNavigation.setPendingEvent(ev.id); navigation.navigate('Tabs', { screen: 'Events' }); }}
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.lieuNom} numberOfLines={2}>{ev.titre}</Text>
                  <Text style={[styles.statutBadge, { color: ev.statut === 'inscrit' ? colors.sage : colors.terra }]}>
                    {ev.statut === 'inscrit' ? 'Inscrit·e' : 'Enregistré'}
                  </Text>
                </View>
                <View style={styles.metaRow}>
                  <Ionicons name="calendar-outline" size={13} color={aujourdHui ? colors.terra : colors.textMuted} />
                  <Text style={[styles.metaText, aujourdHui && { color: colors.terra }]}>{dateLabel}</Text>
                </View>
                {!!(ev.adresse || ev.ville) && (
                  <View style={styles.metaRow}>
                    <Ionicons name="location-outline" size={13} color={colors.textMuted} />
                    <Text style={[styles.metaText, { textTransform: 'none' }]} numberOfLines={1}>{ev.adresse || ev.ville}</Text>
                  </View>
                )}
                <View style={styles.metaRow}>
                  <Ionicons name="notifications-outline" size={13} color={colors.textMuted} />
                  <Text style={[styles.metaText, { textTransform: 'none' }]}>
                    {ev.statut === 'inscrit' ? 'Rappels la veille et le jour J' : 'Rappels la veille à 18 h et 2 h avant'}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {abonnements.length > 0 && (
        <View style={{ gap: 10 }}>
          <Text style={styles.sectionTitle}>Mes abonnements</Text>
          {abonnements.map(abo => (
            <View key={abo.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.lieuNom}>{abo.lieux?.nom || 'Lieu'}</Text>
              </View>
              {!!abo.offers?.nom && <Text style={styles.prestaNom}>{abo.offers.nom}</Text>}
              <View style={styles.metaRow}>
                <Ionicons name="repeat-outline" size={13} color={colors.textMuted} />
                <Text style={styles.metaText}>Tous les {JOURS_LABELS[abo.jour_semaine]?.toLowerCase()} à {abo.heure_debut?.slice(0, 5)}</Text>
              </View>
              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  disabled={cancellingAbonnementId === abo.id}
                  onPress={() => handleCancelAbonnement(abo)}
                >
                  {cancellingAbonnementId === abo.id
                    ? <ActivityIndicator color="#C62828" size="small" />
                    : <Text style={styles.cancelBtnText}>Arrêter l'abonnement</Text>}
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {(mesEvents.length > 0 || abonnements.length > 0) && (
        <Text style={styles.sectionTitle}>Mes réservations</Text>
      )}
      {!reservations.length ? (
        <View style={styles.emptyBox}>
          <Ionicons name="calendar-outline" size={28} color={colors.textMuted} />
          <Text style={styles.emptyText}>Aucune réservation pour le moment.</Text>
        </View>
      ) : (
        reservations.map(resa => {
          const statutInfo = STATUT_LABELS[resa.statut] || { label: resa.statut, color: colors.textMuted };
          const estAnnulable = !['annulee', 'terminee'].includes(resa.statut);
          const estPayee = resa.statut_paiement === 'paye';
          const preview = estPayee && estAnnulable ? refundPreview(resa.date, resa.heure_debut) : null;
          const dateLabel = new Date(`${resa.date}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

          return (
            <View key={resa.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.lieuNom}>{resa.lieux?.nom || 'Lieu'}</Text>
                <Text style={[styles.statutBadge, { color: statutInfo.color }]}>{statutInfo.label}</Text>
              </View>
              {!!resa.prestations?.nom && <Text style={styles.prestaNom}>{resa.prestations.nom}</Text>}
              <View style={styles.metaRow}>
                <Ionicons name="calendar-outline" size={13} color={colors.textMuted} />
                <Text style={styles.metaText}>{dateLabel} à {resa.heure_debut?.slice(0, 5)}</Text>
              </View>
              <View style={styles.metaRow}>
                <Ionicons name="pricetag-outline" size={13} color={colors.textMuted} />
                <Text style={styles.metaText}>{Number(resa.montant_ht).toFixed(2)} €</Text>
              </View>
              {resa.statut === 'terminee' && resa.presence === 'absent' && (
                <Text style={[styles.statutBadge, { color: '#C62828', marginTop: 2 }]}>Absent</Text>
              )}

              {resa.statut === 'annulee' && resa.montant_rembourse != null && (
                <Text style={styles.refundedText}>{Number(resa.montant_rembourse).toFixed(2)} € remboursés</Text>
              )}
              {preview && (
                <Text style={styles.previewText}>Si annulation maintenant : {preview.label.toLowerCase()}</Text>
              )}

              {resa.statut === 'terminee' && !!comptesRendus[resa.id] && (
                <View style={styles.compteRenduBox}>
                  <Text style={styles.compteRenduTitle}>Compte rendu</Text>
                  {!!comptesRendus[resa.id].photo_url && (
                    <Image source={{ uri: comptesRendus[resa.id].photo_url! }} style={styles.compteRenduPhoto} resizeMode="cover" />
                  )}
                  {!!comptesRendus[resa.id].duree_minutes && (
                    <Text style={styles.metaText}>Durée : {comptesRendus[resa.id].duree_minutes} min</Text>
                  )}
                  {!!comptesRendus[resa.id].notes && (
                    <Text style={styles.compteRenduNotes}>{comptesRendus[resa.id].notes}</Text>
                  )}
                </View>
              )}

              <View style={styles.actionsRow}>
                {resa.statut === 'confirmee' && (
                  <TouchableOpacity style={styles.calendarBtn} onPress={() => addToCalendar(resa)}>
                    <Ionicons name="calendar-outline" size={13} color={colors.bordeaux} />
                    <Text style={styles.calendarBtnText}>Ajouter au calendrier</Text>
                  </TouchableOpacity>
                )}
                {estAnnulable && (
                  <TouchableOpacity
                    style={styles.cancelBtn}
                    disabled={cancellingId === resa.id}
                    onPress={() => handleCancel(resa)}
                  >
                    {cancellingId === resa.id
                      ? <ActivityIndicator color="#C62828" size="small" />
                      : <Text style={styles.cancelBtnText}>Annuler ce RDV</Text>}
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivoryLight },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ivoryLight },
  emptyBox: { alignItems: 'center', gap: 10, padding: 40 },
  emptyText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted },
  sectionTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 16, color: colors.bordeaux },
  compteRenduBox: {
    marginTop: 10, padding: 12, borderRadius: 10,
    backgroundColor: 'rgba(196,105,58,0.06)', gap: 6,
  },
  compteRenduTitle: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.terra, textTransform: 'uppercase', letterSpacing: 0.3 },
  compteRenduPhoto: { width: '100%', height: 160, borderRadius: 8 },
  compteRenduNotes: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMid, lineHeight: 18 },
  card: {
    backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    padding: 16, gap: 6,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  lieuNom: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 16, color: colors.bordeaux, flex: 1 },
  statutBadge: { fontFamily: 'DMSans_500Medium', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3 },
  prestaNom: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.terra },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  metaText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMid, textTransform: 'capitalize' },
  refundedText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.sage, marginTop: 4 },
  previewText: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 4 },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  calendarBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8,
    borderWidth: 1.5, borderColor: colors.border,
  },
  calendarBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.bordeaux },
  cancelBtn: {
    alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: 8, borderWidth: 1.5, borderColor: '#C62828',
  },
  cancelBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#C62828' },
});
