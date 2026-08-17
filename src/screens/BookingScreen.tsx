import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useStripe } from '@stripe/stripe-react-native';
import { supabase } from '../lib/supabase';
import { useSession } from '../hooks/useSession';
import { colors } from '../lib/theme';
import { computeSlots, Disponibilite, ReservationSlot } from '../utils/availability';
import type { RootStackParamList } from '../navigation';

type Prestation = { id: string; nom: string; description: string | null; duree: number; prix: number };
type BookingRoute = RouteProp<RootStackParamList, 'Booking'>;

function toDateStr(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function BookingScreen() {
  const route = useRoute<BookingRoute>();
  const navigation = useNavigation();
  const { session } = useSession();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const { lieuId, lieuNom } = route.params;

  const [loading, setLoading] = useState(true);
  const [prestations, setPrestations] = useState<Prestation[]>([]);
  const [selectedPrestation, setSelectedPrestation] = useState<Prestation | null>(null);
  const [disponibilites, setDisponibilites] = useState<Disponibilite[]>([]);
  const [date, setDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [reservations, setReservations] = useState<ReservationSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [prenom, setPrenom] = useState('');
  const [tel, setTel] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: prestas }, { data: dispos }, profilRes] = await Promise.all([
        supabase.from('prestations').select('id,nom,description,duree,prix').eq('lieu_id', lieuId).eq('actif', true).order('prix'),
        supabase.from('disponibilites').select('jour,heure_debut,heure_fin').eq('lieu_id', lieuId),
        session ? supabase.from('profils').select('prenom, telephone').eq('id', session.user.id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      setPrestations(prestas || []);
      setSelectedPrestation((prestas && prestas[0]) || null);
      setDisponibilites(dispos || []);
      const profil = (profilRes as any)?.data;
      if (profil?.prenom) setPrenom(profil.prenom);
      if (profil?.telephone) setTel(profil.telephone);
      setLoading(false);
    })();
  }, [lieuId]);

  const loadReservationsForDate = useCallback(async (d: Date) => {
    setSlotsLoading(true);
    setSelectedSlot(null);
    const dateStr = toDateStr(d);
    const { data } = await supabase
      .from('reservations')
      .select('date, heure_debut')
      .eq('lieu_id', lieuId)
      .in('statut', ['en_attente', 'confirmee'])
      .eq('date', dateStr);
    setReservations(data || []);
    setSlotsLoading(false);
  }, [lieuId]);

  useEffect(() => { loadReservationsForDate(date); }, [date, loadReservationsForDate]);

  const slots = selectedPrestation
    ? computeSlots(toDateStr(date), selectedPrestation.duree, disponibilites, reservations)
    : [];

  async function handleReserve() {
    if (!selectedPrestation || !selectedSlot || !prenom.trim()) {
      Alert.alert('Formulaire incomplet', 'Choisis une prestation, un créneau, et indique ton prénom.');
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-payment-intent', {
        body: {
          lieu_id: lieuId,
          prestation_id: selectedPrestation.id,
          date: toDateStr(date),
          heure_debut: `${selectedSlot}:00`,
          client_prenom: prenom.trim(),
          client_tel: tel.trim() || undefined,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: 'The Pack Club',
        paymentIntentClientSecret: data.client_secret,
        defaultBillingDetails: { name: prenom.trim() },
      });
      if (initError) throw new Error(initError.message);

      const { error: presentError } = await presentPaymentSheet();
      if (presentError) {
        if (presentError.code !== 'Canceled') {
          Alert.alert('Paiement non abouti', presentError.message);
        }
        return;
      }

      Alert.alert(
        'Réservation confirmée !',
        `Ton RDV du ${date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} à ${selectedSlot} est payé et confirmé.`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Impossible de finaliser la réservation pour le moment.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.terra} size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.lieuNom}>{lieuNom}</Text>

      {!prestations.length ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>Aucune prestation disponible à la réservation pour le moment.</Text>
        </View>
      ) : (
        <>
          <Text style={styles.sectionLabel}>Prestation</Text>
          <View style={{ gap: 8 }}>
            {prestations.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={[styles.prestaCard, selectedPrestation?.id === p.id && styles.prestaCardActive]}
                onPress={() => { setSelectedPrestation(p); setSelectedSlot(null); }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.prestaNom}>{p.nom}</Text>
                  {!!p.description && <Text style={styles.prestaDesc}>{p.description}</Text>}
                  <Text style={styles.prestaMeta}>{p.duree} min</Text>
                </View>
                <Text style={styles.prestaPrix}>{Number(p.prix).toFixed(0)} €</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sectionLabel}>Date</Text>
          <TouchableOpacity style={styles.dateBtn} onPress={() => setShowDatePicker(true)}>
            <Ionicons name="calendar-outline" size={16} color={colors.bordeaux} />
            <Text style={styles.dateBtnText}>
              {date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </Text>
          </TouchableOpacity>
          {showDatePicker && (
            <DateTimePicker
              value={date}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              minimumDate={new Date()}
              onChange={(_, d) => { setShowDatePicker(Platform.OS === 'ios'); if (d) setDate(d); }}
            />
          )}

          <Text style={styles.sectionLabel}>Créneau</Text>
          {slotsLoading ? (
            <ActivityIndicator color={colors.terra} style={{ marginVertical: 12 }} />
          ) : !slots.length ? (
            <Text style={styles.emptyText}>Fermé ce jour-là.</Text>
          ) : (
            <View style={styles.slotsWrap}>
              {slots.map(({ slot, pris }) => (
                <TouchableOpacity
                  key={slot}
                  disabled={pris}
                  style={[styles.slotBtn, pris && styles.slotBtnDisabled, selectedSlot === slot && styles.slotBtnActive]}
                  onPress={() => setSelectedSlot(slot)}
                >
                  <Text style={[styles.slotText, pris && styles.slotTextDisabled, selectedSlot === slot && styles.slotTextActive]}>
                    {slot}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={styles.sectionLabel}>Ton prénom</Text>
          <TextInput style={styles.input} value={prenom} onChangeText={setPrenom} placeholder="Prénom" placeholderTextColor={colors.textMuted} />

          <Text style={styles.sectionLabel}>Téléphone (optionnel)</Text>
          <TextInput style={styles.input} value={tel} onChangeText={setTel} placeholder="06…" placeholderTextColor={colors.textMuted} keyboardType="phone-pad" />

          {selectedPrestation && (
            <View style={styles.summaryBox}>
              <Text style={styles.summaryLabel}>Total à payer</Text>
              <Text style={styles.summaryPrix}>{Number(selectedPrestation.prix).toFixed(2)} €</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.submitBtn, (!selectedSlot || submitting) && styles.submitBtnDisabled]}
            disabled={!selectedSlot || submitting}
            onPress={handleReserve}
          >
            {submitting ? <ActivityIndicator color={colors.ivory} /> : <Text style={styles.submitBtnText}>Réserver et payer</Text>}
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivoryLight },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ivoryLight },
  lieuNom: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 20, color: colors.bordeaux, marginBottom: 16 },
  sectionLabel: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.textMuted, marginTop: 20, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 },
  emptyBox: { padding: 20, backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  emptyText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted, lineHeight: 19 },
  prestaCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.white, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, padding: 14,
  },
  prestaCardActive: { borderColor: colors.terra, backgroundColor: 'rgba(196,105,58,0.06)' },
  prestaNom: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
  prestaDesc: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, marginTop: 2 },
  prestaMeta: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 4 },
  prestaPrix: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.terra, marginLeft: 12 },
  dateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, padding: 12,
  },
  dateBtnText: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux, textTransform: 'capitalize' },
  slotsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slotBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.white },
  slotBtnActive: { borderColor: colors.terra, backgroundColor: colors.terra },
  slotBtnDisabled: { backgroundColor: colors.border, borderColor: colors.border },
  slotText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.bordeaux },
  slotTextActive: { color: colors.ivory, fontFamily: 'DMSans_500Medium' },
  slotTextDisabled: { color: colors.textMuted, textDecorationLine: 'line-through' },
  input: {
    backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.border, borderRadius: 10,
    padding: 12, fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux,
  },
  summaryBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 24, padding: 16, backgroundColor: 'rgba(196,105,58,0.08)', borderRadius: 12,
  },
  summaryLabel: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
  summaryPrix: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 20, color: colors.terra },
  submitBtn: {
    marginTop: 16, backgroundColor: colors.terra, borderRadius: 12, paddingVertical: 15,
    alignItems: 'center', justifyContent: 'center',
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.ivory },
});
