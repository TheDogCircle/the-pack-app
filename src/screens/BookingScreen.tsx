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

type CartItem = { key: string; prestation: Prestation; date: Date; slot: string; chienId: string | null };
type Chien = { id: string; nom: string; race: string | null };

type Forfait = { id: string; nom: string; nb_seances: number; prix: number; prestation_id: string | null; validite_jours: number | null };
type ForfaitAchete = {
  id: string; forfait_id: string; nb_seances_total: number; nb_seances_utilisees: number;
  date_expiration: string | null; forfaits: { nom: string; prestation_id: string | null } | null;
};

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
  const [cart, setCart] = useState<CartItem[]>([]);
  const [forfaits, setForfaits] = useState<Forfait[]>([]);
  const [mesForfaits, setMesForfaits] = useState<ForfaitAchete[]>([]);
  const [purchasingForfaitId, setPurchasingForfaitId] = useState<string | null>(null);
  const [usingForfait, setUsingForfait] = useState(false);
  const [chiens, setChiens] = useState<Chien[]>([]);
  const [selectedChienId, setSelectedChienId] = useState<string | null>(null);
  const [showDevisForm, setShowDevisForm] = useState(false);
  const [devisMessage, setDevisMessage] = useState('');
  const [submittingDevis, setSubmittingDevis] = useState(false);

  const loadForfaits = useCallback(async () => {
    const [{ data: fs }, mesRes] = await Promise.all([
      supabase.from('forfaits').select('id,nom,nb_seances,prix,prestation_id,validite_jours').eq('lieu_id', lieuId).eq('actif', true),
      session
        ? supabase.from('forfaits_achetes').select('id,forfait_id,nb_seances_total,nb_seances_utilisees,date_expiration,forfaits(nom,prestation_id)').eq('lieu_id', lieuId).eq('user_id', session.user.id)
        : Promise.resolve({ data: [] }),
    ]);
    setForfaits(fs || []);
    setMesForfaits(((mesRes as any).data || []) as ForfaitAchete[]);
  }, [lieuId, session]);

  useEffect(() => {
    (async () => {
      const [{ data: prestas }, { data: dispos }, profilRes, chiensRes] = await Promise.all([
        supabase.from('prestations').select('id,nom,description,duree,prix').eq('lieu_id', lieuId).eq('actif', true).order('prix'),
        supabase.from('disponibilites').select('jour,heure_debut,heure_fin').eq('lieu_id', lieuId),
        session ? supabase.from('profils').select('prenom, telephone').eq('id', session.user.id).maybeSingle() : Promise.resolve({ data: null }),
        session ? supabase.from('chiens').select('id,nom,race').eq('user_id', session.user.id).order('created_at') : Promise.resolve({ data: [] }),
      ]);
      setPrestations(prestas || []);
      setSelectedPrestation((prestas && prestas[0]) || null);
      setDisponibilites(dispos || []);
      const profil = (profilRes as any)?.data;
      if (profil?.prenom) setPrenom(profil.prenom);
      if (profil?.telephone) setTel(profil.telephone);
      const dogs = (chiensRes as any).data || [];
      setChiens(dogs);
      if (dogs.length === 1) setSelectedChienId(dogs[0].id);
      await loadForfaits();
      setLoading(false);
    })();
  }, [lieuId]);

  const today = toDateStr(new Date());
  const creditsUtilisables = mesForfaits.filter(f => {
    if (f.nb_seances_utilisees >= f.nb_seances_total) return false;
    if (f.date_expiration && f.date_expiration < today) return false;
    return true;
  });
  const matchingCredit = selectedPrestation
    ? creditsUtilisables.find(f => !f.forfaits?.prestation_id || f.forfaits.prestation_id === selectedPrestation.id)
    : null;

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

  function addToCart() {
    if (!selectedPrestation || !selectedSlot) return;
    setCart(c => [...c, { key: `${Date.now()}-${Math.random()}`, prestation: selectedPrestation, date, slot: selectedSlot, chienId: selectedChienId }]);
    setSelectedSlot(null);
  }

  function removeFromCart(key: string) {
    setCart(c => c.filter(i => i.key !== key));
  }

  async function purchaseForfait(forfait: Forfait) {
    setPurchasingForfaitId(forfait.id);
    try {
      const { data, error } = await supabase.functions.invoke('purchase-forfait', { body: { forfait_id: forfait.id } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: 'The Pack La Meute',
        paymentIntentClientSecret: data.client_secret,
        defaultBillingDetails: { name: prenom.trim() || undefined },
      });
      if (initError) throw new Error(initError.message);

      const { error: presentError } = await presentPaymentSheet();
      if (presentError) {
        if (presentError.code !== 'Canceled') Alert.alert('Paiement non abouti', presentError.message);
        return;
      }

      Alert.alert('Forfait acheté !', `${forfait.nb_seances} séances créditées sur ton compte.`);
      // La ligne forfaits_achetes est creee par le webhook Stripe, avec un
      // leger delai apres la confirmation du paiement.
      setTimeout(loadForfaits, 2500);
    } catch (e: any) {
      Alert.alert('Erreur', e.message || "Impossible de finaliser l'achat pour le moment.");
    } finally {
      setPurchasingForfaitId(null);
    }
  }

  async function handleUseForfait() {
    if (!matchingCredit || !selectedPrestation || !selectedSlot || !prenom.trim()) {
      Alert.alert('Formulaire incomplet', 'Choisis une prestation, un créneau, et indique ton prénom.');
      return;
    }
    setUsingForfait(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-forfait-reservation', {
        body: {
          forfait_achete_id: matchingCredit.id,
          prestation_id: selectedPrestation.id,
          date: toDateStr(date),
          heure_debut: `${selectedSlot}:00`,
          client_prenom: prenom.trim(),
          client_tel: tel.trim() || undefined,
          chien_id: selectedChienId,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      Alert.alert(
        'Demande envoyée !',
        `Ta demande pour le ${date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} à ${selectedSlot} a été transmise au prestataire (séance de ton forfait, aucun paiement supplémentaire).`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Impossible de finaliser la réservation pour le moment.');
    } finally {
      setUsingForfait(false);
    }
  }

  async function handleSubmitDevis() {
    if (!prenom.trim()) {
      Alert.alert('Formulaire incomplet', 'Indique ton prénom.');
      return;
    }
    setSubmittingDevis(true);
    try {
      const { data, error } = await supabase.functions.invoke('submit-devis-request', {
        body: {
          lieu_id: lieuId,
          client_prenom: prenom.trim(),
          client_tel: tel.trim() || undefined,
          chien_id: selectedChienId,
          message: devisMessage.trim() || undefined,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      Alert.alert(
        'Demande envoyée !',
        'Le prestataire a été prévenu et te recontactera directement pour établir un devis.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Impossible d\'envoyer la demande pour le moment.');
    } finally {
      setSubmittingDevis(false);
    }
  }

  const currentAsItem: CartItem | null = selectedPrestation && selectedSlot
    ? { key: '__current__', prestation: selectedPrestation, date, slot: selectedSlot, chienId: selectedChienId }
    : null;
  const allItems = currentAsItem ? [...cart, currentAsItem] : cart;
  const totalPrix = allItems.reduce((sum, i) => sum + Number(i.prestation.prix), 0);

  async function handleReserve() {
    if (!allItems.length || !prenom.trim()) {
      Alert.alert('Formulaire incomplet', 'Choisis au moins une prestation et un créneau, et indique ton prénom.');
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-cart-reservations', {
        body: {
          lieu_id: lieuId,
          client_prenom: prenom.trim(),
          client_tel: tel.trim() || undefined,
          items: allItems.map(i => ({
            prestation_id: i.prestation.id,
            date: toDateStr(i.date),
            heure_debut: `${i.slot}:00`,
            chien_id: i.chienId,
          })),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: 'The Pack La Meute',
        paymentIntentClientSecret: data.first.client_secret,
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

      let finalizeFailed: { reservation_id: string; error: string }[] = [];
      if (data.pending_reservation_ids?.length) {
        const { data: finalizeData, error: finalizeError } = await supabase.functions.invoke('finalize-cart-payments', {
          body: { first_reservation_id: data.first.reservation_id, pending_reservation_ids: data.pending_reservation_ids },
        });
        if (!finalizeError && !finalizeData?.error) {
          finalizeFailed = finalizeData?.failed || [];
        }
      }

      const totalRequested = allItems.length;
      const preFailed = data.failed?.length || 0;
      const totalFailed = preFailed + finalizeFailed.length;
      const totalOk = totalRequested - totalFailed;

      const summary = totalFailed === 0
        ? `Tes ${totalRequested > 1 ? `${totalRequested} demandes ont` : 'demande a'} été transmises au prestataire. Ta carte est autorisée mais pas encore débitée — tu ne paies que s'il confirme chaque créneau.`
        : `${totalOk}/${totalRequested} demande(s) transmise(s) au prestataire. ${totalFailed} n'ont pas pu être envoyées (créneau indisponible entre-temps ou problème de paiement).`;

      Alert.alert('Demande envoyée !', summary, [{ text: 'OK', onPress: () => navigation.goBack() }]);
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

      {creditsUtilisables.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Tes forfaits</Text>
          <View style={{ gap: 8, marginBottom: 8 }}>
            {creditsUtilisables.map(f => (
              <View key={f.id} style={styles.creditItem}>
                <Ionicons name="ticket-outline" size={16} color={colors.terra} />
                <Text style={styles.creditItemText}>
                  {f.forfaits?.nom || 'Forfait'} — {f.nb_seances_total - f.nb_seances_utilisees} séance{f.nb_seances_total - f.nb_seances_utilisees > 1 ? 's' : ''} restante{f.nb_seances_total - f.nb_seances_utilisees > 1 ? 's' : ''}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}

      {forfaits.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Forfaits disponibles</Text>
          <View style={{ gap: 8, marginBottom: 8 }}>
            {forfaits.map(f => (
              <View key={f.id} style={styles.forfaitCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.prestaNom}>{f.nom}</Text>
                  <Text style={styles.prestaMeta}>{f.nb_seances} séances{f.validite_jours ? ` · valable ${f.validite_jours} jours` : ''}</Text>
                </View>
                <Text style={styles.prestaPrix}>{Number(f.prix).toFixed(0)} €</Text>
                <TouchableOpacity
                  style={styles.buyBtn}
                  disabled={purchasingForfaitId === f.id}
                  onPress={() => purchaseForfait(f)}
                >
                  {purchasingForfaitId === f.id
                    ? <ActivityIndicator size="small" color={colors.terra} />
                    : <Text style={styles.buyBtnText}>Acheter</Text>}
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </>
      )}

      {!prestations.length ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>Aucune prestation disponible à la réservation pour le moment.</Text>
        </View>
      ) : (
        <>
          {cart.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Panier ({cart.length})</Text>
              <View style={{ gap: 8, marginBottom: 8 }}>
                {cart.map(item => (
                  <View key={item.key} style={styles.cartItem}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cartItemNom}>{item.prestation.nom}</Text>
                      <Text style={styles.cartItemMeta}>
                        {item.date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} à {item.slot} · {Number(item.prestation.prix).toFixed(0)} €
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => removeFromCart(item.key)} style={styles.cartItemRemove}>
                      <Ionicons name="close" size={16} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </>
          )}

          <Text style={styles.sectionLabel}>{cart.length > 0 ? 'Ajouter une autre prestation' : 'Prestation'}</Text>
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
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              minimumDate={new Date()}
              onChange={(_, d) => { setShowDatePicker(false); if (d) setDate(d); }}
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

          {selectedSlot && matchingCredit && (
            <TouchableOpacity
              style={[styles.submitBtn, { marginTop: 12 }, usingForfait && styles.submitBtnDisabled]}
              disabled={usingForfait}
              onPress={handleUseForfait}
            >
              {usingForfait
                ? <ActivityIndicator color={colors.ivory} />
                : <Text style={styles.submitBtnText}>Utiliser mon forfait ({matchingCredit.nb_seances_total - matchingCredit.nb_seances_utilisees} restantes)</Text>}
            </TouchableOpacity>
          )}

          {selectedSlot && (
            <TouchableOpacity style={styles.addCartBtn} onPress={addToCart}>
              <Ionicons name="add-circle-outline" size={16} color={colors.terra} />
              <Text style={styles.addCartBtnText}>Ajouter au panier et réserver une autre prestation</Text>
            </TouchableOpacity>
          )}

          {chiens.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Ton chien</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
                {chiens.map(c => (
                  <TouchableOpacity
                    key={c.id}
                    style={[styles.dogChip, selectedChienId === c.id && styles.dogChipActive]}
                    onPress={() => setSelectedChienId(c.id)}
                  >
                    <Text style={[styles.dogChipText, selectedChienId === c.id && styles.dogChipTextActive]}>
                      {c.nom}{c.race ? ` · ${c.race}` : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <Text style={styles.sectionLabel}>Ton prénom</Text>
          <TextInput style={styles.input} value={prenom} onChangeText={setPrenom} placeholder="Prénom" placeholderTextColor={colors.textMuted} />

          <Text style={styles.sectionLabel}>Téléphone (optionnel)</Text>
          <TextInput style={styles.input} value={tel} onChangeText={setTel} placeholder="06…" placeholderTextColor={colors.textMuted} keyboardType="phone-pad" />

          {allItems.length > 0 && (
            <View style={styles.summaryBox}>
              <Text style={styles.summaryLabel}>
                {allItems.length > 1 ? `Total ${allItems.length} prestations (débité seulement si confirmées)` : 'Montant (débité seulement si le prestataire confirme)'}
              </Text>
              <Text style={styles.summaryPrix}>{totalPrix.toFixed(2)} €</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.submitBtn, (!allItems.length || submitting) && styles.submitBtnDisabled]}
            disabled={!allItems.length || submitting}
            onPress={handleReserve}
          >
            {submitting
              ? <ActivityIndicator color={colors.ivory} />
              : <Text style={styles.submitBtnText}>{allItems.length > 1 ? `Envoyer les ${allItems.length} demandes` : 'Envoyer la demande'}</Text>}
          </TouchableOpacity>

          <View style={styles.devisDivider}>
            <View style={styles.devisDividerLine} />
            <Text style={styles.devisDividerText}>ou</Text>
            <View style={styles.devisDividerLine} />
          </View>

          {!showDevisForm ? (
            <TouchableOpacity style={styles.devisToggleBtn} onPress={() => setShowDevisForm(true)}>
              <Ionicons name="call-outline" size={16} color={colors.bordeaux} />
              <Text style={styles.devisToggleBtnText}>Demander un devis (tarif à discuter par téléphone)</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.devisBox}>
              <Text style={styles.sectionLabel}>Décris ta demande</Text>
              <TextInput
                style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
                value={devisMessage}
                onChangeText={setDevisMessage}
                placeholder="Ex : promenades régulières en semaine, besoin d'un devis pour un forfait sur mesure…"
                placeholderTextColor={colors.textMuted}
                multiline
              />
              <TouchableOpacity
                style={[styles.submitBtn, { marginTop: 12 }, (!prenom.trim() || submittingDevis) && styles.submitBtnDisabled]}
                disabled={!prenom.trim() || submittingDevis}
                onPress={handleSubmitDevis}
              >
                {submittingDevis
                  ? <ActivityIndicator color={colors.ivory} />
                  : <Text style={styles.submitBtnText}>Envoyer la demande de devis</Text>}
              </TouchableOpacity>
            </View>
          )}
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
  addCartBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    marginTop: 12, paddingVertical: 8, paddingHorizontal: 4,
  },
  addCartBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.terra },
  cartItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.white, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12,
  },
  cartItemNom: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux },
  cartItemMeta: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 2 },
  cartItemRemove: { padding: 4 },
  creditItem: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(196,105,58,0.08)', borderRadius: 10, padding: 12,
  },
  creditItemText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux, flex: 1 },
  forfaitCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    backgroundColor: colors.white, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, padding: 14,
  },
  buyBtn: { backgroundColor: colors.terra, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  buyBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.ivory },
  dogChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.white,
  },
  dogChipActive: { borderColor: colors.terra, backgroundColor: 'rgba(196,105,58,0.08)' },
  dogChipText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.textMid },
  dogChipTextActive: { color: colors.terra },
  devisDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20, marginBottom: 4 },
  devisDividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  devisDividerText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted },
  devisToggleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 12, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border,
  },
  devisToggleBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
  devisBox: { marginTop: 12 },
  input: {
    backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.border, borderRadius: 10,
    padding: 12, fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux,
  },
  summaryBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 24, padding: 16, backgroundColor: 'rgba(196,105,58,0.08)', borderRadius: 12,
  },
  summaryLabel: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux, flex: 1, marginRight: 8 },
  summaryPrix: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 20, color: colors.terra },
  submitBtn: {
    marginTop: 16, backgroundColor: colors.terra, borderRadius: 12, paddingVertical: 15,
    alignItems: 'center', justifyContent: 'center',
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.ivory },
});
