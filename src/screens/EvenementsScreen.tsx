import React, { useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, Image, ScrollView,
  Modal, TextInput, Switch, Platform, Alert, KeyboardAvoidingView,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { useSession } from '../hooks/useSession';
import AuthGate from '../components/AuthGate';

type Evenement = {
  id: string; titre: string; description: string | null;
  date_heure: string; adresse: string | null; ville: string;
  lat: number | null; lng: number | null;
  max_participants: number | null; payant: boolean; prix: number | null;
  image_url: string | null;
  profils: { prenom: string | null; username: string | null; avatar_url: string | null } | null;
  nb_inscrits?: number; je_suis_inscrit?: boolean;
  created_by?: string;
};

type Filter = 'avenir' | 'inscrits' | 'semaine';

function fmtDate(d: Date) {
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}
function fmtHeure(d: Date) {
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export default function EvenementsScreen() {
  const navigation = useNavigation<any>();
  const { session, loading: sessionLoading } = useSession();

  const [evenements, setEvenements] = useState<Evenement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('avenir');
  const [myUserId, setMyUserId] = useState<string | null>(null);

  const [selectedEvent, setSelectedEvent] = useState<Evenement | null>(null);
  const [inscriptionLoading, setInscriptionLoading] = useState(false);

  // Création
  const [createModal, setCreateModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [titre, setTitre] = useState('');
  const [description, setDescription] = useState('');
  const [ville, setVille] = useState('');
  const [adresse, setAdresse] = useState('');
  const [maxPart, setMaxPart] = useState('');
  const [payant, setPayant] = useState(false);
  const [prix, setPrix] = useState('');
  const [eventDate, setEventDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(10, 0, 0, 0); return d; });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  useEffect(() => {
    if (session?.user?.id) setMyUserId(session.user.id);
    load();
  }, [session?.user?.id, filter]);

  async function load() {
    setLoading(true);
    const now = new Date().toISOString();
    const endWeek = new Date(Date.now() + 7 * 86400000).toISOString();

    let q = supabase.from('evenements')
      .select('*, profils(prenom, username, avatar_url)')
      .eq('valide', true).eq('actif', true)
      .gte('date_heure', now)
      .order('date_heure', { ascending: true });

    if (filter === 'semaine') q = q.lte('date_heure', endWeek);

    const { data } = await q;
    const events = data || [];

    try {
      if (session?.user?.id && events.length > 0) {
        const ids = events.map((e: any) => e.id);
        const [{ data: parts }, ...counts] = await Promise.all([
          supabase.from('participations').select('event_id').eq('user_id', session.user.id).in('event_id', ids),
          ...ids.map((id: string) =>
            supabase.from('participations').select('*', { count: 'exact', head: true }).eq('event_id', id)
          ),
        ]);
        const inscritIds = new Set((parts || []).map((p: any) => p.event_id));
        const mapped: Evenement[] = events.map((e: any, i: number) => ({
          ...e,
          nb_inscrits: (counts[i] as any).count || 0,
          je_suis_inscrit: inscritIds.has(e.id),
        }));
        if (filter === 'inscrits') {
          setEvenements(mapped.filter(e => e.je_suis_inscrit));
        } else {
          setEvenements(mapped);
        }
      } else {
        setEvenements(filter === 'inscrits' ? [] : events);
      }
    } catch {
      setEvenements(filter === 'inscrits' ? [] : events);
    }
    setLoading(false);
  }

  async function toggleInscription(eventId: string, join: boolean) {
    if (!myUserId) return;
    setInscriptionLoading(true);
    if (join) {
      await supabase.from('participations').insert({ event_id: eventId, user_id: myUserId });
    } else {
      await supabase.from('participations').delete().eq('event_id', eventId).eq('user_id', myUserId);
    }
    setInscriptionLoading(false);
    const update = (e: Evenement) => e.id !== eventId ? e : {
      ...e, je_suis_inscrit: join, nb_inscrits: (e.nb_inscrits || 0) + (join ? 1 : -1),
    };
    setEvenements(prev => prev.map(update));
    if (selectedEvent?.id === eventId) setSelectedEvent(prev => prev ? update(prev) : prev);
  }

  function resetForm() {
    setTitre(''); setDescription(''); setVille(''); setAdresse('');
    setMaxPart(''); setPayant(false); setPrix('');
    const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(10, 0, 0, 0);
    setEventDate(d);
  }

  async function submitEvent() {
    if (!titre.trim() || !ville.trim()) {
      Alert.alert('Champs requis', 'Le titre et la ville sont obligatoires.');
      return;
    }
    if (!myUserId) return;
    setSaving(true);

    let eventLat: number | null = null;
    let eventLng: number | null = null;
    try {
      const q = [adresse.trim(), ville.trim()].filter(Boolean).join(', ');
      const geoResp = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`,
        { headers: { 'User-Agent': 'ThePackApp/1.0 (thepackclub.fr)' } }
      );
      const geoData = await geoResp.json();
      if (geoData?.[0]) { eventLat = parseFloat(geoData[0].lat); eventLng = parseFloat(geoData[0].lon); }
    } catch {}

    const { error } = await supabase.from('evenements').insert({
      titre: titre.trim(),
      description: description.trim() || null,
      date_heure: eventDate.toISOString(),
      ville: ville.trim(),
      adresse: adresse.trim() || null,
      max_participants: maxPart ? parseInt(maxPart) : null,
      payant,
      prix: payant && prix ? parseFloat(prix) : null,
      valide: false,
      actif: true,
      lat: eventLat,
      lng: eventLng,
    });
    setSaving(false);
    if (error) { Alert.alert('Erreur', error.message); return; }
    setCreateModal(false);
    resetForm();
    Alert.alert('Événement soumis', 'Il sera visible après validation par l\'équipe The Pack.');
  }

  if (sessionLoading) return <ActivityIndicator style={{ flex: 1 }} color={colors.terra} />;
  if (!session) return <AuthGate navigation={navigation} message="Connecte-toi pour voir et créer des événements dog-friendly." />;

  const FILTERS: { key: Filter; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
    { key: 'avenir',  label: 'À venir',       icon: 'calendar-outline' },
    { key: 'semaine', label: 'Cette semaine',  icon: 'today-outline' },
    { key: 'inscrits',label: 'Mes inscrits',  icon: 'checkmark-circle-outline' },
  ];

  return (
    <View style={styles.container}>
      {/* Filtres */}
      <View style={styles.tabsWrap}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[styles.tab, filter === f.key && styles.tabActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.tabText, filter === f.key && styles.tabTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Liste */}
      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={colors.terra} />
      ) : (
        <FlatList
          data={evenements}
          keyExtractor={e => e.id}
          contentContainerStyle={[styles.list, evenements.length === 0 && { flex: 1 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.terra} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="calendar-outline" size={44} color={colors.border} />
              <Text style={styles.emptyTitle}>
                {filter === 'inscrits' ? 'Aucun événement inscrit' : 'Aucun événement à venir'}
              </Text>
              <Text style={styles.emptyText}>
                {filter === 'inscrits' ? 'Parcours les événements et inscris-toi !' : 'Sois le premier à en créer un !'}
              </Text>
            </View>
          }
          renderItem={({ item: e }) => {
            const date = new Date(e.date_heure);
            const diffDays = Math.ceil((date.getTime() - Date.now()) / 86400000);
            return (
              <TouchableOpacity style={styles.card} onPress={() => setSelectedEvent(e)} activeOpacity={0.85}>
                {e.image_url ? (
                  <Image source={{ uri: e.image_url }} style={styles.cardImg} />
                ) : (
                  <View style={styles.cardImgPlaceholder}>
                    <Ionicons name="calendar-outline" size={30} color={colors.bordeaux + '30'} />
                  </View>
                )}
                <View style={styles.cardBody}>
                  {/* Badges */}
                  <View style={styles.badgeRow}>
                    {diffDays <= 3 && (
                      <View style={styles.urgencyBadge}>
                        <Text style={styles.urgencyText}>{diffDays === 0 ? "Auj." : diffDays === 1 ? 'Demain' : `J-${diffDays}`}</Text>
                      </View>
                    )}
                    {e.payant
                      ? <View style={styles.paidBadge}><Text style={styles.paidText}>{e.prix ? `${e.prix} €` : 'Payant'}</Text></View>
                      : <View style={styles.freeBadge}><Text style={styles.freeText}>Gratuit</Text></View>}
                  </View>
                  <Text style={styles.cardTitle} numberOfLines={2}>{e.titre}</Text>
                  <View style={styles.infoRow}>
                    <Ionicons name="calendar-outline" size={12} color={colors.textMuted} />
                    <Text style={styles.infoText}>{fmtDate(date)} à {fmtHeure(date)}</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Ionicons name="location-outline" size={12} color={colors.textMuted} />
                    <Text style={styles.infoText} numberOfLines={1}>{e.ville}{e.adresse ? ` — ${e.adresse}` : ''}</Text>
                  </View>
                  <View style={styles.cardFooter}>
                    <Text style={styles.orgaText}>@{e.profils?.username || 'anonyme'}</Text>
                    {e.nb_inscrits !== undefined && (
                      <View style={styles.participantsRow}>
                        <Ionicons name="people-outline" size={12} color={colors.textMuted} />
                        <Text style={styles.participantsText}>{e.nb_inscrits}{e.max_participants ? `/${e.max_participants}` : ''}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* FAB créer */}
      <TouchableOpacity style={styles.fab} onPress={() => setCreateModal(true)} activeOpacity={0.85}>
        <Ionicons name="add" size={26} color={colors.ivory} />
      </TouchableOpacity>

      {/* ── Modal détail événement ── */}
      <Modal visible={!!selectedEvent} animationType="slide" transparent onRequestClose={() => setSelectedEvent(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <TouchableOpacity style={styles.modalClose} onPress={() => setSelectedEvent(null)}>
              <Ionicons name="close" size={22} color={colors.textMid} />
            </TouchableOpacity>
            {selectedEvent && (() => {
              const date = new Date(selectedEvent.date_heure);
              const isFull = !!(selectedEvent.max_participants && (selectedEvent.nb_inscrits || 0) >= selectedEvent.max_participants && !selectedEvent.je_suis_inscrit);
              return (
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
                  {selectedEvent.image_url
                    ? <Image source={{ uri: selectedEvent.image_url }} style={styles.modalImg} />
                    : <View style={styles.modalImgPlaceholder}><Ionicons name="calendar-outline" size={40} color={colors.bordeaux + '30'} /></View>}
                  <View style={styles.modalContent}>
                    <Text style={styles.modalTitle}>{selectedEvent.titre}</Text>
                    <View style={styles.modalBadges}>
                      {selectedEvent.payant
                        ? <View style={styles.paidBadge}><Text style={styles.paidText}>{selectedEvent.prix ? `${selectedEvent.prix} €` : 'Payant'}</Text></View>
                        : <View style={styles.freeBadge}><Text style={styles.freeText}>✓ Gratuit</Text></View>}
                      {selectedEvent.nb_inscrits !== undefined && (
                        <View style={styles.countBadge}>
                          <Text style={styles.countText}>{selectedEvent.nb_inscrits}{selectedEvent.max_participants ? `/${selectedEvent.max_participants}` : ''} inscrits</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.modalInfoRow}>
                      <Ionicons name="calendar-outline" size={16} color={colors.textMuted} />
                      <View>
                        <Text style={styles.modalInfoMain}>{date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</Text>
                        <Text style={styles.modalInfoSub}>à {fmtHeure(date)}</Text>
                      </View>
                    </View>
                    <View style={styles.modalInfoRow}>
                      <Ionicons name="location-outline" size={16} color={colors.textMuted} />
                      <View>
                        <Text style={styles.modalInfoMain}>{selectedEvent.ville}</Text>
                        {selectedEvent.adresse ? <Text style={styles.modalInfoSub}>{selectedEvent.adresse}</Text> : null}
                      </View>
                    </View>
                    <View style={[styles.modalInfoRow, { marginBottom: 16 }]}>
                      <Ionicons name="person-outline" size={16} color={colors.textMuted} />
                      <Text style={styles.modalInfoSub}>Organisé par @{selectedEvent.profils?.username || 'anonyme'}</Text>
                    </View>
                    {selectedEvent.description ? <Text style={styles.modalDesc}>{selectedEvent.description}</Text> : null}

                    {isFull ? (
                      <View style={styles.fullBadge}><Text style={styles.fullText}>Complet — plus de places disponibles</Text></View>
                    ) : selectedEvent.je_suis_inscrit ? (
                      <TouchableOpacity style={styles.cancelBtn} onPress={() => toggleInscription(selectedEvent.id, false)} disabled={inscriptionLoading}>
                        <Ionicons name="checkmark-circle" size={18} color="#e65100" />
                        <Text style={styles.cancelBtnText}>Inscrit · Annuler mon inscription</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity style={styles.joinBtn} onPress={() => toggleInscription(selectedEvent.id, true)} disabled={inscriptionLoading}>
                        <Text style={styles.joinBtnText}>
                          S'inscrire{selectedEvent.payant && selectedEvent.prix ? ` — ${selectedEvent.prix} €` : ''}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </ScrollView>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* ── Modal créer événement ── */}
      <Modal visible={createModal} animationType="slide" transparent onRequestClose={() => { setCreateModal(false); resetForm(); }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalSheet, { maxHeight: '95%' }]}>
              <View style={styles.createHeader}>
                <Text style={styles.createTitle}>Créer un événement</Text>
                <TouchableOpacity onPress={() => { setCreateModal(false); resetForm(); }}>
                  <Ionicons name="close" size={22} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              <ScrollView contentContainerStyle={styles.createForm} keyboardShouldPersistTaps="handled">
                <Text style={styles.fieldLabel}>Titre *</Text>
                <TextInput style={styles.input} value={titre} onChangeText={setTitre} placeholder="Ex : Balade en forêt de Vincennes" placeholderTextColor={colors.textMuted} />

                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput style={[styles.input, styles.inputMulti]} value={description} onChangeText={setDescription} placeholder="Décris l'événement…" placeholderTextColor={colors.textMuted} multiline />

                <Text style={styles.fieldLabel}>Date</Text>
                <TouchableOpacity style={styles.dateBtn} onPress={() => setShowDatePicker(true)}>
                  <Ionicons name="calendar-outline" size={16} color={colors.bordeaux} />
                  <Text style={styles.dateBtnText}>{eventDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</Text>
                </TouchableOpacity>
                {showDatePicker && (
                  <DateTimePicker
                    value={eventDate} mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    minimumDate={new Date()}
                    onChange={(_, d) => { setShowDatePicker(Platform.OS === 'ios'); if (d) setEventDate(prev => { const n = new Date(prev); n.setFullYear(d.getFullYear(), d.getMonth(), d.getDate()); return n; }); }}
                  />
                )}

                <Text style={styles.fieldLabel}>Heure</Text>
                <TouchableOpacity style={styles.dateBtn} onPress={() => setShowTimePicker(true)}>
                  <Ionicons name="time-outline" size={16} color={colors.bordeaux} />
                  <Text style={styles.dateBtnText}>{fmtHeure(eventDate)}</Text>
                </TouchableOpacity>
                {showTimePicker && (
                  <DateTimePicker
                    value={eventDate} mode="time"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={(_, d) => { setShowTimePicker(Platform.OS === 'ios'); if (d) setEventDate(prev => { const n = new Date(prev); n.setHours(d.getHours(), d.getMinutes()); return n; }); }}
                  />
                )}

                <Text style={styles.fieldLabel}>Ville *</Text>
                <TextInput style={styles.input} value={ville} onChangeText={setVille} placeholder="Ex : Paris" placeholderTextColor={colors.textMuted} />

                <Text style={styles.fieldLabel}>Adresse (optionnel)</Text>
                <TextInput style={styles.input} value={adresse} onChangeText={setAdresse} placeholder="Ex : Bois de Vincennes, entrée Nord" placeholderTextColor={colors.textMuted} />

                <Text style={styles.fieldLabel}>Nombre max de participants (optionnel)</Text>
                <TextInput style={styles.input} value={maxPart} onChangeText={setMaxPart} placeholder="Ex : 20" placeholderTextColor={colors.textMuted} keyboardType="numeric" />

                <View style={styles.switchRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Événement payant</Text>
                    <Text style={styles.fieldSub}>Précise le tarif d'entrée</Text>
                  </View>
                  <Switch value={payant} onValueChange={setPayant} trackColor={{ false: colors.border, true: colors.terra }} thumbColor={colors.ivory} />
                </View>
                {payant && (
                  <>
                    <Text style={styles.fieldLabel}>Prix (€)</Text>
                    <TextInput style={styles.input} value={prix} onChangeText={setPrix} placeholder="Ex : 5" placeholderTextColor={colors.textMuted} keyboardType="numeric" />
                  </>
                )}

                <View style={styles.submitNote}>
                  <Ionicons name="information-circle-outline" size={14} color={colors.textMuted} />
                  <Text style={styles.submitNoteText}>L'événement sera visible après validation par l'équipe The Pack.</Text>
                </View>

                <TouchableOpacity style={styles.submitBtn} onPress={submitEvent} disabled={saving}>
                  {saving ? <ActivityIndicator color={colors.ivory} /> : <Text style={styles.submitBtnText}>Soumettre l'événement</Text>}
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivoryPale },

  tabsWrap: {
    flexDirection: 'row', backgroundColor: colors.white,
    borderRadius: 12, padding: 4, borderWidth: 1, borderColor: colors.border,
    marginHorizontal: 16, marginVertical: 12,
  },
  tab: { flex: 1, paddingVertical: 9, paddingHorizontal: 4, borderRadius: 8, alignItems: 'center' },
  tabActive: { backgroundColor: colors.bordeaux },
  tabText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.textMuted },
  tabTextActive: { color: colors.ivory },

  list: { padding: 14, gap: 14, paddingBottom: 100 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 48 },
  emptyTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.bordeaux },
  emptyText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted, textAlign: 'center' },

  // Card
  card: {
    backgroundColor: colors.white, borderRadius: 16, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  cardImg: { width: '100%', height: 160, resizeMode: 'cover' },
  cardImgPlaceholder: { width: '100%', height: 90, backgroundColor: colors.bordeaux + '08', alignItems: 'center', justifyContent: 'center' },
  cardBody: { padding: 14 },
  badgeRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  cardTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 16, color: colors.bordeaux, lineHeight: 22, marginBottom: 8 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  infoText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, flex: 1 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  orgaText: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.terra },
  participantsRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  participantsText: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },

  urgencyBadge: { backgroundColor: '#fff3e0', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  urgencyText: { fontFamily: 'DMSans_500Medium', fontSize: 10, color: '#e65100' },
  paidBadge: { backgroundColor: '#fce4ec', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  paidText: { fontFamily: 'DMSans_500Medium', fontSize: 10, color: '#c62828' },
  freeBadge: { backgroundColor: '#e8f5e9', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  freeText: { fontFamily: 'DMSans_500Medium', fontSize: 10, color: '#2e7d32' },
  countBadge: { backgroundColor: colors.ivoryPale, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  countText: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },

  // FAB
  fab: {
    position: 'absolute', bottom: 28, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.bordeaux, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.bordeaux, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 8,
  },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.white, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '90%' },
  modalClose: { position: 'absolute', top: 14, right: 16, zIndex: 10, padding: 4 },
  modalImg: { width: '100%', height: 210, resizeMode: 'cover' },
  modalImgPlaceholder: { width: '100%', height: 100, backgroundColor: colors.bordeaux + '08', alignItems: 'center', justifyContent: 'center' },
  modalContent: { padding: 20 },
  modalTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 21, color: colors.bordeaux, lineHeight: 28, marginBottom: 12 },
  modalBadges: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 16 },
  modalInfoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  modalInfoMain: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.textMid },
  modalInfoSub: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted },
  modalDesc: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.textMid, lineHeight: 22, marginBottom: 20 },
  joinBtn: { backgroundColor: colors.bordeaux, borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8 },
  joinBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.ivory },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#fff3e0', borderRadius: 14, padding: 15, marginTop: 8, borderWidth: 1, borderColor: '#ffcc80' },
  cancelBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: '#e65100' },
  fullBadge: { backgroundColor: colors.ivoryPale, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8 },
  fullText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted },

  // Create form
  createHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: colors.border },
  createTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.bordeaux },
  createForm: { padding: 20, gap: 6, paddingBottom: 40 },
  fieldLabel: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 10, marginBottom: 4 },
  fieldSub: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, marginBottom: 2 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12,
    fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux, backgroundColor: colors.ivoryPale,
  },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },
  dateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, backgroundColor: colors.ivoryPale,
  },
  dateBtnText: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  submitNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 16, backgroundColor: colors.ivoryLight, padding: 12, borderRadius: 10 },
  submitNoteText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, flex: 1, lineHeight: 17 },
  submitBtn: { backgroundColor: colors.bordeaux, borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 12 },
  submitBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.ivory },
});
