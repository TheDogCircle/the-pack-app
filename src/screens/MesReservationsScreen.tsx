import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useSession } from '../hooks/useSession';
import { colors } from '../lib/theme';

type Reservation = {
  id: string;
  date: string;
  heure_debut: string;
  statut: string;
  statut_paiement: string;
  montant_ht: number;
  montant_rembourse: number | null;
  lieux: { nom: string } | null;
  prestations: { nom: string } | null;
};

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
  const navigation = useNavigation();
  const { session } = useSession();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    const { data } = await supabase
      .from('reservations')
      .select('id, date, heure_debut, statut, statut_paiement, montant_ht, montant_rembourse, lieux(nom), prestations(nom)')
      .eq('user_id', session.user.id)
      .order('date', { ascending: false })
      .order('heure_debut', { ascending: false });
    setReservations((data as any) || []);
    setLoading(false);
    setRefreshing(false);
  }, [session?.user.id]);

  useEffect(() => { load(); }, [load]);

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

              {resa.statut === 'annulee' && resa.montant_rembourse != null && (
                <Text style={styles.refundedText}>{Number(resa.montant_rembourse).toFixed(2)} € remboursés</Text>
              )}
              {preview && (
                <Text style={styles.previewText}>Si annulation maintenant : {preview.label.toLowerCase()}</Text>
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
  cancelBtn: {
    marginTop: 10, alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: 8, borderWidth: 1.5, borderColor: '#C62828',
  },
  cancelBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#C62828' },
});
