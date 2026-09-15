import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Image, ActivityIndicator, RefreshControl,
  TouchableOpacity, TextInput, Modal, KeyboardAvoidingView, Platform, Alert, Keyboard,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useRoute, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';

type ChienInfo = {
  id: string; nom: string; race: string | null; photo_url: string | null;
};

// Table separee de `chiens` (fix audit securite) : `chiens` a une policy SELECT
// permissive pour les abonnes (anniversaires / bougie du feed) -- RLS etant par ligne
// et non par colonne, des champs sensibles poses directement sur `chiens` seraient
// lisibles par n'importe quel abonne du proprietaire. chien_infos_privees a sa propre
// policy strictement owner-only (meme pattern que chien_carnet_entries).
type PrivateInfo = {
  chien_id: string;
  puce_identification: string | null;
  veterinaire_nom: string | null; veterinaire_telephone: string | null; veterinaire_adresse: string | null;
  veterinaire_lieu_id: string | null;
  sterilise: boolean; date_sterilisation: string | null;
};

type VetLieu = { id: string; nom: string; ville: string | null; adresse: string | null; tel: string | null };

type EntryType = 'vaccin' | 'vermifuge' | 'antiparasitaire' | 'rdv_veto' | 'pesee' | 'note';

type Entry = {
  id: string; type: EntryType; titre: string | null; date: string; date_rappel: string | null;
  date_echeance: string | null; heure_rdv: string | null;
  poids_kg: number | null; taille_cm: number | null; notes: string | null;
};

type Question = { id: string; question: string; posee: boolean };

const TYPE_META: Record<EntryType, { label: string; icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  vaccin:          { label: 'Vaccin',           icon: 'medkit-outline',         color: colors.terra },
  vermifuge:       { label: 'Vermifuge',        icon: 'leaf-outline',           color: colors.sage },
  antiparasitaire: { label: 'Antiparasitaire',  icon: 'bug-outline',            color: colors.sage },
  rdv_veto:        { label: 'Rendez-vous véto', icon: 'calendar-outline',       color: colors.bordeaux },
  pesee:           { label: 'Pesée',            icon: 'scale-outline',          color: colors.textMid },
  note:            { label: 'Note',             icon: 'document-text-outline',  color: colors.textMuted },
};

const TYPE_ORDER: EntryType[] = ['vaccin', 'rdv_veto', 'vermifuge', 'antiparasitaire', 'pesee', 'note'];
const REMINDER_TYPES: EntryType[] = ['vaccin', 'vermifuge', 'antiparasitaire', 'rdv_veto'];

// L'echeance (prochaine date prevue, ex : prochain rappel de vaccin) et le delai de
// prevenance choisis par l'utilisateur sont combines cote client pour produire la
// date_rappel stockee en base -- la colonne reste une simple date, pas de migration
// necessaire pour ce changement d'UX.
const RAPPEL_OFFSETS: { label: string; days: number }[] = [
  { label: 'Le jour même', days: 0 },
  { label: 'La veille', days: 1 },
  { label: '2 jours avant', days: 2 },
  { label: '3 jours avant', days: 3 },
  { label: '4 jours avant', days: 4 },
  { label: '5 jours avant', days: 5 },
  { label: '1 semaine avant', days: 7 },
];

// Libelle du champ "Date" contextualise par type -- "Date" seul ne disait pas si on
// enregistre un evenement passe (vaccin fait, derniere prise de vermifuge) ou a venir
// (rendez-vous).
const DATE_FIELD_LABEL: Record<EntryType, string> = {
  vaccin: 'Fait le',
  vermifuge: 'Dernière prise le',
  antiparasitaire: 'Dernière prise le',
  rdv_veto: 'Prochain rdv véto le',
  pesee: 'Date',
  note: 'Date',
};

// Alternative rapide au calendrier : la plupart des rappels (vaccin, vermifuge,
// antiparasitaire) se pensent en "dans X mois" plutot qu'en date precise -- calculer
// soi-meme cette date sur un calendrier est une friction inutile pour le cas courant.
// Le calendrier reste disponible juste en dessous pour une date exacte.
const DUREE_OPTIONS: { label: string; months: number }[] = [
  { label: '1 mois', months: 1 },
  { label: '2 mois', months: 2 },
  { label: '3 mois', months: 3 },
  { label: '6 mois', months: 6 },
  { label: '1 an', months: 12 },
];

function dateToIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isoToDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

function formatDateFr(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function daysUntil(iso: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(`${iso}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export default function CarnetSanteScreen() {
  const route = useRoute<any>();
  const chienId: string = route.params.chienId;
  const chienNomParam: string = route.params.chienNom || '';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [chien, setChien] = useState<ChienInfo | null>(null);
  const [privateInfo, setPrivateInfo] = useState<PrivateInfo | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [entryModal, setEntryModal] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [entryFilter, setEntryFilter] = useState<EntryType | 'all'>('all');
  const [filterModal, setFilterModal] = useState(false);
  const [entryType, setEntryType] = useState<EntryType>('vaccin');
  const [entryTitre, setEntryTitre] = useState('');
  const [entryDate, setEntryDate] = useState(new Date());
  const [showEntryDatePicker, setShowEntryDatePicker] = useState(false);
  const [entryHeureRdv, setEntryHeureRdv] = useState<Date | null>(null);
  const [showHeureRdvPicker, setShowHeureRdvPicker] = useState(false);
  const [entryHasRappel, setEntryHasRappel] = useState(false);
  const [entryEcheance, setEntryEcheance] = useState(new Date());
  const [showEcheancePicker, setShowEcheancePicker] = useState(false);
  const [entryRappelOffset, setEntryRappelOffset] = useState(3);
  const [entryPoids, setEntryPoids] = useState('');
  const [entryTaille, setEntryTaille] = useState('');
  const [entryNotes, setEntryNotes] = useState('');
  const [savingEntry, setSavingEntry] = useState(false);

  const [infoModal, setInfoModal] = useState(false);
  const [vetNom, setVetNom] = useState('');
  const [vetTel, setVetTel] = useState('');
  const [vetAdresse, setVetAdresse] = useState('');
  const [vetLieuId, setVetLieuId] = useState<string | null>(null);
  const [puce, setPuce] = useState('');
  const [sterilise, setSterilise] = useState(false);
  const [dateSterilisation, setDateSterilisation] = useState<Date | null>(null);
  const [showSterilisationPicker, setShowSterilisationPicker] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);

  const swipeRefs = useRef<Record<string, Swipeable | null>>({});

  const [vetPickerModal, setVetPickerModal] = useState(false);
  const [vetSearch, setVetSearch] = useState('');
  const [vetResults, setVetResults] = useState<VetLieu[]>([]);
  const [vetSearchLoading, setVetSearchLoading] = useState(false);

  const [newQuestion, setNewQuestion] = useState('');
  const [addingQuestion, setAddingQuestion] = useState(false);

  const load = useCallback(async () => {
    const [{ data: chienData }, { data: privateData }, { data: entriesData }, { data: questionsData }] = await Promise.all([
      supabase.from('chiens')
        .select('id, nom, race, photo_url')
        .eq('id', chienId).single(),
      supabase.from('chien_infos_privees')
        .select('chien_id, puce_identification, veterinaire_nom, veterinaire_telephone, veterinaire_adresse, veterinaire_lieu_id, sterilise, date_sterilisation')
        .eq('chien_id', chienId).maybeSingle(),
      supabase.from('chien_carnet_entries')
        .select('id, type, titre, date, date_rappel, date_echeance, heure_rdv, poids_kg, taille_cm, notes')
        .eq('chien_id', chienId).order('date', { ascending: false }),
      supabase.from('chien_questions_veto')
        .select('id, question, posee')
        .eq('chien_id', chienId).order('created_at', { ascending: false }),
    ]);
    if (chienData) setChien(chienData as ChienInfo);
    setPrivateInfo((privateData as PrivateInfo | null) || null);
    setEntries((entriesData || []) as Entry[]);
    setQuestions((questionsData || []) as Question[]);
    setLoading(false);
    setRefreshing(false);
  }, [chienId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function pickAndUploadPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const ext = asset.uri.split('.').pop() || 'jpg';
    // chienId en segment de dossier (pas dans le nom de fichier) : requis par la
    // policy de stockage chiens_photo_owner_only_insert/update, qui verifie la
    // propriete via storage.foldername(name)[2].
    const path = `chiens/${chienId}/photo.${ext}`;
    const formData = new FormData();
    formData.append('file', { uri: asset.uri, name: `photo.${ext}`, type: `image/${ext}` } as any);
    setUploadingPhoto(true);
    const { error } = await supabase.storage.from('avatars').upload(path, formData, { upsert: true });
    if (error) { Alert.alert('Erreur', error.message); setUploadingPhoto(false); return; }
    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    const photoUrl = `${data.publicUrl}?t=${Date.now()}`;
    await supabase.from('chiens').update({ photo_url: photoUrl }).eq('id', chienId);
    setChien(c => (c ? { ...c, photo_url: photoUrl } : c));
    setUploadingPhoto(false);
  }

  function openInfoModal() {
    setVetNom(privateInfo?.veterinaire_nom || '');
    setVetTel(privateInfo?.veterinaire_telephone || '');
    setVetAdresse(privateInfo?.veterinaire_adresse || '');
    setVetLieuId(privateInfo?.veterinaire_lieu_id || null);
    setPuce(privateInfo?.puce_identification || '');
    setSterilise(privateInfo?.sterilise || false);
    setDateSterilisation(privateInfo?.date_sterilisation ? isoToDate(privateInfo.date_sterilisation) : null);
    setInfoModal(true);
  }

  function openVetPicker() {
    setVetSearch('');
    setVetResults([]);
    setVetPickerModal(true);
  }

  async function searchVets(q: string) {
    setVetSearch(q);
    if (q.trim().length < 2) { setVetResults([]); return; }
    setVetSearchLoading(true);
    const { data } = await supabase.from('lieux')
      .select('id, nom, ville, adresse, tel')
      .eq('cat', 'veto').eq('actif', true)
      .ilike('nom', `%${q.trim()}%`)
      .order('nom', { ascending: true })
      .limit(30);
    setVetResults((data || []) as VetLieu[]);
    setVetSearchLoading(false);
  }

  function selectVetLieu(vet: VetLieu) {
    setVetNom(vet.nom);
    setVetTel(vet.tel || '');
    setVetAdresse([vet.adresse, vet.ville].filter(Boolean).join(', '));
    setVetLieuId(vet.id);
    setVetPickerModal(false);
  }

  function unlinkVetLieu() {
    setVetLieuId(null);
  }

  async function saveInfo() {
    setSavingInfo(true);
    const update = {
      chien_id: chienId,
      veterinaire_nom: vetNom.trim() || null,
      veterinaire_telephone: vetTel.trim() || null,
      veterinaire_adresse: vetAdresse.trim() || null,
      veterinaire_lieu_id: vetLieuId,
      puce_identification: puce.trim() || null,
      sterilise,
      date_sterilisation: sterilise && dateSterilisation ? dateToIso(dateSterilisation) : null,
    };
    const { error } = await supabase.from('chien_infos_privees').upsert(update);
    setSavingInfo(false);
    if (error) { Alert.alert('Erreur', error.message); return; }
    setPrivateInfo(update);
    setInfoModal(false);
  }

  function openEntryModal() {
    setEditingEntryId(null);
    setEntryType('vaccin');
    setEntryTitre('');
    setEntryDate(new Date());
    setEntryHasRappel(false);
    setEntryEcheance(new Date());
    setEntryRappelOffset(3);
    setEntryHeureRdv(null);
    setEntryPoids('');
    setEntryTaille('');
    setEntryNotes('');
    setEntryModal(true);
  }

  function openEditEntryModal(entry: Entry) {
    setEditingEntryId(entry.id);
    setEntryType(entry.type);
    setEntryTitre(entry.titre || '');
    setEntryDate(isoToDate(entry.date));
    setEntryHasRappel(!!entry.date_rappel);
    // date_echeance et date_rappel sont stockees separement : on peut reconstituer
    // fidelement l'echeance ET le delai choisis a l'origine (au lieu de retomber sur
    // "jour meme" par defaut comme avant que date_echeance n'existe).
    const echeance = entry.date_echeance || entry.date_rappel;
    setEntryEcheance(echeance ? isoToDate(echeance) : new Date());
    if (entry.date_echeance && entry.date_rappel) {
      const diffDays = Math.round((isoToDate(entry.date_echeance).getTime() - isoToDate(entry.date_rappel).getTime()) / 86_400_000);
      setEntryRappelOffset(diffDays);
    } else {
      setEntryRappelOffset(0);
    }
    // heure_rdv vient de Postgres au format "HH:MM:SS" -- reconstruit en Date pour le
    // picker (la date elle-meme n'a pas d'importance, seule l'heure sera lue au save).
    setEntryHeureRdv(entry.heure_rdv ? new Date(`2000-01-01T${entry.heure_rdv}`) : null);
    setEntryPoids(entry.poids_kg != null ? String(entry.poids_kg) : '');
    setEntryTaille(entry.taille_cm != null ? String(entry.taille_cm) : '');
    setEntryNotes(entry.notes || '');
    setEntryModal(true);
  }

  async function saveEntry() {
    setSavingEntry(true);
    let dateRappel: string | null = null;
    let dateEcheance: string | null = null;
    if (entryHasRappel && REMINDER_TYPES.includes(entryType)) {
      // Pour un rdv veto, la base du rappel est la date du rendez-vous lui-meme
      // (entryDate), pas une echeance separee -- cf. commentaire dans le JSX.
      const rappelBase = entryType === 'rdv_veto' ? entryDate : entryEcheance;
      dateEcheance = dateToIso(rappelBase);
      const rappel = new Date(rappelBase);
      rappel.setDate(rappel.getDate() - entryRappelOffset);
      dateRappel = dateToIso(rappel);
    }
    // Si la date de rappel change au fil d'une edition, il faut rouvrir la porte a un
    // nouvel envoi -- sinon un rappel deja envoye (rappel_envoye=true) resterait bloque
    // meme si l'utilisateur repousse la date a plus tard.
    const original = editingEntryId ? entries.find(e => e.id === editingEntryId) : null;
    const rappelChanged = original ? original.date_rappel !== dateRappel : false;
    const payload = {
      chien_id: chienId,
      type: entryType,
      titre: entryTitre.trim() || null,
      date: dateToIso(entryDate),
      date_rappel: dateRappel,
      date_echeance: dateEcheance,
      heure_rdv: entryType === 'rdv_veto' && entryHeureRdv
        ? `${String(entryHeureRdv.getHours()).padStart(2, '0')}:${String(entryHeureRdv.getMinutes()).padStart(2, '0')}`
        : null,
      poids_kg: entryType === 'pesee' && entryPoids ? parseFloat(entryPoids.replace(',', '.')) : null,
      taille_cm: entryType === 'pesee' && entryTaille ? parseFloat(entryTaille.replace(',', '.')) : null,
      notes: entryNotes.trim() || null,
      ...(rappelChanged ? { rappel_envoye: false } : {}),
    };
    const { error } = editingEntryId
      ? await supabase.from('chien_carnet_entries').update(payload).eq('id', editingEntryId)
      : await supabase.from('chien_carnet_entries').insert(payload);
    setSavingEntry(false);
    if (error) { Alert.alert('Erreur', error.message); return; }
    setEntryModal(false);
    load();
  }

  function deleteEntry(entry: Entry) {
    Alert.alert('Supprimer cette entrée ?', entry.titre || TYPE_META[entry.type].label, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer', style: 'destructive', onPress: async () => {
          await supabase.from('chien_carnet_entries').delete().eq('id', entry.id);
          load();
        },
      },
    ]);
  }

  async function addQuestion() {
    const q = newQuestion.trim();
    if (!q) return;
    setAddingQuestion(true);
    const { error } = await supabase.from('chien_questions_veto').insert({ chien_id: chienId, question: q });
    setAddingQuestion(false);
    if (error) { Alert.alert('Erreur', error.message); return; }
    setNewQuestion('');
    load();
  }

  async function toggleQuestion(question: Question) {
    const posee = !question.posee;
    setQuestions(qs => qs.map(q => (q.id === question.id ? { ...q, posee } : q)));
    await supabase.from('chien_questions_veto').update({ posee, resolved_at: posee ? new Date().toISOString() : null }).eq('id', question.id);
  }

  async function deleteQuestion(question: Question) {
    setQuestions(qs => qs.filter(q => q.id !== question.id));
    await supabase.from('chien_questions_veto').delete().eq('id', question.id);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.terra} size="large" />
      </View>
    );
  }

  const latestPesee = entries.find(e => e.type === 'pesee' && e.poids_kg != null);
  // rdv_veto a son propre encadre (voir ProfilScreen, "Prochain RDV veto") -- ne pas le
  // dupliquer ici, la liste "A venir" ne concerne plus que les soins periodiques.
  const upcoming = [...entries].filter(e => e.date_rappel && e.type !== 'rdv_veto').sort((a, b) => (a.date_rappel! < b.date_rappel! ? -1 : 1));
  const filteredEntries = entryFilter === 'all' ? entries : entries.filter(e => e.type === entryFilter);

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.terra} />}
      >
        <View style={styles.headerCard}>
          <TouchableOpacity onPress={pickAndUploadPhoto} disabled={uploadingPhoto} style={styles.photoWrap}>
            {chien?.photo_url ? (
              <Image source={{ uri: chien.photo_url }} style={styles.photo} />
            ) : (
              <View style={styles.photoFallback}><Ionicons name="paw" size={26} color={colors.terra} /></View>
            )}
            <View style={styles.photoEditBadge}>
              {uploadingPhoto ? <ActivityIndicator size="small" color={colors.ivory} /> : <Ionicons name="camera" size={12} color={colors.ivory} />}
            </View>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.dogName}>{chien?.nom || chienNomParam}</Text>
            <Text style={styles.dogMeta}>
              {[chien?.race, privateInfo?.sterilise ? 'Stérilisé(e)' : null].filter(Boolean).join(' · ') || 'Aucune info renseignée'}
            </Text>
            <TouchableOpacity onPress={openInfoModal} style={styles.infoLink}>
              <Ionicons name="create-outline" size={13} color={colors.terra} />
              <Text style={styles.infoLinkText}>Puce, vétérinaire, stérilisation</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.quickRow}>
          <View style={styles.quickCard}>
            <Text style={styles.quickLabel}>Poids actuel</Text>
            <Text style={styles.quickValue}>{latestPesee?.poids_kg != null ? `${latestPesee.poids_kg} kg` : '—'}</Text>
            {latestPesee && <Text style={styles.quickSub}>{formatDateFr(latestPesee.date)}</Text>}
          </View>
          <View style={styles.quickCard}>
            <Text style={styles.quickLabel}>Vétérinaire</Text>
            <Text style={styles.quickValue} numberOfLines={1}>{privateInfo?.veterinaire_nom || '—'}</Text>
            {privateInfo?.veterinaire_telephone ? <Text style={styles.quickSub}>{privateInfo.veterinaire_telephone}</Text> : null}
          </View>
        </View>

        {upcoming.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>À venir</Text>
            {upcoming.map(e => {
              const d = daysUntil(e.date_rappel!);
              return (
                <View key={e.id} style={styles.upcomingRow}>
                  <Ionicons name={TYPE_META[e.type].icon} size={16} color={TYPE_META[e.type].color} />
                  <Text style={styles.upcomingText}>{e.titre || TYPE_META[e.type].label}</Text>
                  <View style={[styles.upcomingBadge, d <= 0 && styles.upcomingBadgeUrgent]}>
                    <Text style={[styles.upcomingBadgeText, d <= 0 && styles.upcomingBadgeTextUrgent]}>
                      {d < 0 ? 'En retard' : d === 0 ? "Aujourd'hui" : d === 1 ? 'Demain' : `Dans ${d} j`}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Questions pour le vétérinaire</Text>
          <View style={styles.questionInputRow}>
            <TextInput
              style={styles.questionInput}
              value={newQuestion}
              onChangeText={setNewQuestion}
              placeholder="Ajouter une question…"
              placeholderTextColor={colors.textMuted}
              onSubmitEditing={addQuestion}
              returnKeyType="done"
            />
            <TouchableOpacity onPress={addQuestion} disabled={addingQuestion || !newQuestion.trim()} style={styles.questionAddBtn}>
              <Ionicons name="add" size={20} color={colors.ivory} />
            </TouchableOpacity>
          </View>
          {questions.length === 0 ? (
            <Text style={styles.emptyMini}>Aucune question pour l'instant.</Text>
          ) : questions.map(q => (
            <View key={q.id} style={styles.questionRow}>
              <TouchableOpacity onPress={() => toggleQuestion(q)} style={styles.questionCheck}>
                <Ionicons name={q.posee ? 'checkbox' : 'square-outline'} size={19} color={q.posee ? colors.sage : colors.textMuted} />
              </TouchableOpacity>
              <Text style={[styles.questionText, q.posee && styles.questionTextDone]}>{q.question}</Text>
              <TouchableOpacity onPress={() => deleteQuestion(q)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Ionicons name="close" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Carnet</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <TouchableOpacity style={styles.filterBtn} onPress={() => setFilterModal(true)}>
                <Text style={styles.filterBtnText}>{entryFilter === 'all' ? 'Tout' : TYPE_META[entryFilter].label}</Text>
                <Ionicons name="chevron-down" size={13} color={colors.terra} />
              </TouchableOpacity>
              <TouchableOpacity onPress={openEntryModal} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="add-circle-outline" size={22} color={colors.terra} />
              </TouchableOpacity>
            </View>
          </View>
          {filteredEntries.length === 0 ? (
            <Text style={styles.emptyMini}>
              {entries.length === 0 ? "Aucune entrée pour l'instant. Ajoute un vaccin, une pesée, un rendez-vous…" : 'Aucune entrée de ce type.'}
            </Text>
          ) : filteredEntries.map(e => (
            <Swipeable
              key={e.id}
              ref={ref => { swipeRefs.current[e.id] = ref; }}
              overshootRight={false}
              renderRightActions={() => (
                <View style={styles.entrySwipeActions}>
                  <TouchableOpacity
                    style={[styles.entrySwipeBtn, { backgroundColor: colors.sage }]}
                    onPress={() => { swipeRefs.current[e.id]?.close(); openEditEntryModal(e); }}
                  >
                    <Ionicons name="pencil" size={18} color={colors.ivory} />
                    <Text style={styles.entrySwipeBtnText}>Modifier</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.entrySwipeBtn, { backgroundColor: colors.terra }]}
                    onPress={() => { swipeRefs.current[e.id]?.close(); deleteEntry(e); }}
                  >
                    <Ionicons name="trash" size={18} color={colors.ivory} />
                    <Text style={styles.entrySwipeBtnText}>Supprimer</Text>
                  </TouchableOpacity>
                </View>
              )}
            >
              <View style={styles.entryRow}>
                <View style={[styles.entryIcon, { backgroundColor: `${TYPE_META[e.type].color}1A` }]}>
                  <Ionicons name={TYPE_META[e.type].icon} size={16} color={TYPE_META[e.type].color} />
                </View>
                <View style={{ flex: 1 }}>
                  {e.titre ? (
                    <Text style={[styles.entryCategory, { color: TYPE_META[e.type].color }]}>{TYPE_META[e.type].label}</Text>
                  ) : null}
                  <Text style={styles.entryTitle}>{e.titre || TYPE_META[e.type].label}</Text>
                  <Text style={styles.entrySub}>
                    {formatDateFr(e.date)}
                    {e.type === 'pesee' && e.poids_kg != null ? ` · ${e.poids_kg} kg${e.taille_cm ? ` · ${e.taille_cm} cm` : ''}` : ''}
                    {e.date_echeance && e.type !== 'rdv_veto' ? ` · prochain ${TYPE_META[e.type].label.toLowerCase()} le ${formatDateFr(e.date_echeance)}` : ''}
                    {e.date_rappel ? ` (rappel le ${formatDateFr(e.date_rappel)})` : ''}
                  </Text>
                  {e.notes ? <Text style={styles.entryNotes}>{e.notes}</Text> : null}
                </View>
              </View>
            </Swipeable>
          ))}
          {entries.length > 0 && <Text style={styles.entryHint}>Glisse une entrée vers la gauche pour la modifier ou la supprimer.</Text>}
        </View>
      </ScrollView>

      <Modal visible={filterModal} animationType="fade" transparent onRequestClose={() => setFilterModal(false)}>
        <TouchableOpacity style={styles.filterOverlay} activeOpacity={1} onPress={() => setFilterModal(false)}>
          <View style={styles.filterCard}>
            <TouchableOpacity
              style={styles.filterOption}
              onPress={() => { setEntryFilter('all'); setFilterModal(false); }}
            >
              <Text style={[styles.filterOptionText, entryFilter === 'all' && styles.filterOptionTextActive]}>Tout</Text>
              {entryFilter === 'all' && <Ionicons name="checkmark" size={16} color={colors.terra} />}
            </TouchableOpacity>
            {TYPE_ORDER.map(t => (
              <TouchableOpacity
                key={t}
                style={styles.filterOption}
                onPress={() => { setEntryFilter(t); setFilterModal(false); }}
              >
                <Ionicons name={TYPE_META[t].icon} size={15} color={TYPE_META[t].color} />
                <Text style={[styles.filterOptionText, entryFilter === t && styles.filterOptionTextActive]}>{TYPE_META[t].label}</Text>
                {entryFilter === t && <Ionicons name="checkmark" size={16} color={colors.terra} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={entryModal} animationType="slide" transparent onRequestClose={() => setEntryModal(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingEntryId ? "Modifier l'entrée" : 'Ajouter au carnet'}</Text>
              <TouchableOpacity onPress={() => setEntryModal(false)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
              <Text style={styles.fieldLabel}>Type</Text>
              <View style={styles.typeGrid}>
                {TYPE_ORDER.map(t => {
                  const active = entryType === t;
                  return (
                    <TouchableOpacity
                      key={t}
                      style={[styles.typeChip, active && { backgroundColor: TYPE_META[t].color, borderColor: TYPE_META[t].color }]}
                      onPress={() => setEntryType(t)}
                    >
                      <Ionicons name={TYPE_META[t].icon} size={14} color={active ? colors.ivory : TYPE_META[t].color} />
                      <Text style={[styles.typeChipText, active && { color: colors.ivory }]}>{TYPE_META[t].label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>Titre (optionnel)</Text>
              <TextInput style={styles.fieldInput} value={entryTitre} onChangeText={setEntryTitre} placeholder={`Ex : ${TYPE_META[entryType].label}`} placeholderTextColor={colors.textMuted} returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()} />

              <Text style={styles.fieldLabel}>{DATE_FIELD_LABEL[entryType]}</Text>
              <TouchableOpacity style={styles.dateBtn} onPress={() => setShowEntryDatePicker(true)}>
                <Ionicons name="calendar-outline" size={16} color={colors.bordeaux} />
                <Text style={styles.dateBtnText}>{entryDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
              </TouchableOpacity>
              {showEntryDatePicker && (
                <DateTimePicker
                  value={entryDate} mode="date"
                  display={Platform.OS === 'ios' ? 'inline' : 'default'}
                  onChange={(_, d) => { setShowEntryDatePicker(Platform.OS === 'ios'); if (d) setEntryDate(d); }}
                />
              )}

              {entryType === 'rdv_veto' && (
                <>
                  <Text style={styles.fieldLabel}>Heure (optionnel)</Text>
                  <TouchableOpacity style={styles.dateBtn} onPress={() => setShowHeureRdvPicker(true)}>
                    <Ionicons name="time-outline" size={16} color={colors.bordeaux} />
                    <Text style={styles.dateBtnText}>
                      {entryHeureRdv ? entryHeureRdv.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'Non précisée'}
                    </Text>
                  </TouchableOpacity>
                  {showHeureRdvPicker && (
                    <DateTimePicker
                      value={entryHeureRdv || new Date()} mode="time"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      onChange={(_, d) => { setShowHeureRdvPicker(Platform.OS === 'ios'); if (d) setEntryHeureRdv(d); }}
                    />
                  )}
                </>
              )}

              {REMINDER_TYPES.includes(entryType) && (() => {
                // Pour un rdv veto, la date du rendez-vous EST deja le champ "Date" ci-dessus
                // -- lui refaire choisir une "echeance" separee n'avait pas de sens et c'est
                // ce qui rendait la case a cocher incomprehensible. On reutilise directement
                // entryDate comme base du rappel, et on ne demande plus qu'un delai avant.
                const isRdv = entryType === 'rdv_veto';
                const rappelBase = isRdv ? entryDate : entryEcheance;
                return (
                <>
                  <TouchableOpacity style={styles.checkboxRow} onPress={() => setEntryHasRappel(v => !v)}>
                    <Ionicons name={entryHasRappel ? 'checkbox' : 'square-outline'} size={20} color={entryHasRappel ? colors.sage : colors.textMuted} />
                    <Text style={styles.checkboxLabel}>{isRdv ? 'Me rappeler avant ce rendez-vous' : 'Me rappeler de refaire ça'}</Text>
                  </TouchableOpacity>
                  {!entryHasRappel && (
                    <Text style={styles.rappelHint}>
                      {isRdv ? "Tu seras prévenu(e) avant la date du rendez-vous indiquée ci-dessus." : "Utile pour un vaccin, un vermifuge… qu'il faudra refaire dans quelques semaines ou mois."}
                    </Text>
                  )}

                  {entryHasRappel && (
                    <>
                      {!isRdv && (
                        <>
                          <Text style={styles.fieldLabel}>Prochain {TYPE_META[entryType].label.toLowerCase()} prévu le</Text>
                          <View style={styles.typeGrid}>
                            {DUREE_OPTIONS.map(o => (
                              <TouchableOpacity
                                key={o.months}
                                style={styles.typeChip}
                                onPress={() => {
                                  const d = new Date();
                                  d.setMonth(d.getMonth() + o.months);
                                  setEntryEcheance(d);
                                }}
                              >
                                <Text style={styles.typeChipText}>Dans {o.label}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                          <Text style={styles.rappelHint}>Ou choisis une date précise :</Text>
                          <TouchableOpacity style={styles.dateBtn} onPress={() => setShowEcheancePicker(true)}>
                            <Ionicons name="calendar-outline" size={16} color={colors.bordeaux} />
                            <Text style={styles.dateBtnText}>{entryEcheance.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
                          </TouchableOpacity>
                          {showEcheancePicker && (
                            <DateTimePicker
                              value={entryEcheance} mode="date"
                              display={Platform.OS === 'ios' ? 'inline' : 'default'}
                              minimumDate={new Date()}
                              onChange={(_, d) => { setShowEcheancePicker(Platform.OS === 'ios'); if (d) setEntryEcheance(d); }}
                            />
                          )}
                        </>
                      )}

                      <Text style={styles.fieldLabel}>Me prévenir</Text>
                      <View style={styles.typeGrid}>
                        {RAPPEL_OFFSETS.map(o => {
                          const active = entryRappelOffset === o.days;
                          return (
                            <TouchableOpacity
                              key={o.days}
                              style={[styles.typeChip, active && { backgroundColor: colors.terra, borderColor: colors.terra }]}
                              onPress={() => setEntryRappelOffset(o.days)}
                            >
                              <Text style={[styles.typeChipText, active && { color: colors.ivory }]}>{o.label}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      <Text style={styles.rappelPreview}>
                        Apparaîtra dans "À venir" à partir du {new Date(rappelBase.getTime() - entryRappelOffset * 86_400_000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}.
                      </Text>
                    </>
                  )}
                </>
                );
              })()}

              {entryType === 'pesee' && (
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Poids (kg)</Text>
                    <TextInput style={styles.fieldInput} value={entryPoids} onChangeText={setEntryPoids} placeholder="12.5" placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Taille (cm)</Text>
                    <TextInput style={styles.fieldInput} value={entryTaille} onChangeText={setEntryTaille} placeholder="45" placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" />
                  </View>
                </View>
              )}

              <Text style={styles.fieldLabel}>Notes (optionnel)</Text>
              <TextInput style={[styles.fieldInput, styles.fieldTextarea]} value={entryNotes} onChangeText={setEntryNotes} placeholder="Détails, dosage, observations…" placeholderTextColor={colors.textMuted} multiline />

              <TouchableOpacity style={styles.saveBtn} onPress={saveEntry} disabled={savingEntry}>
                {savingEntry ? <ActivityIndicator color={colors.ivory} size="small" /> : <Text style={styles.saveBtnText}>{editingEntryId ? 'Enregistrer' : 'Ajouter'}</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={infoModal} animationType="slide" transparent onRequestClose={() => setInfoModal(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Infos & vétérinaire</Text>
              <TouchableOpacity onPress={() => setInfoModal(false)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
              <Text style={styles.fieldLabel}>Puce d'identification</Text>
              <TextInput style={styles.fieldInput} value={puce} onChangeText={setPuce} placeholder="N° de puce" placeholderTextColor={colors.textMuted} returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()} />

              <View style={styles.vetFieldHeader}>
                <Text style={[styles.fieldLabel, { marginTop: 0 }]}>Vétérinaire</Text>
                <TouchableOpacity onPress={openVetPicker} style={styles.vetPickLink}>
                  <Ionicons name="map-outline" size={13} color={colors.terra} />
                  <Text style={styles.vetPickLinkText}>Choisir sur la carte</Text>
                </TouchableOpacity>
              </View>

              {vetLieuId ? (
                <View style={styles.vetLinkedBadge}>
                  <Ionicons name="link" size={12} color={colors.sage} />
                  <Text style={styles.vetLinkedBadgeText}>Lié à une fiche de la carte</Text>
                  <TouchableOpacity onPress={unlinkVetLieu}><Text style={styles.vetUnlinkText}>Dissocier</Text></TouchableOpacity>
                </View>
              ) : null}

              <TextInput style={styles.fieldInput} value={vetNom} onChangeText={t => { setVetNom(t); setVetLieuId(null); }} placeholder="Dr…" placeholderTextColor={colors.textMuted} returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()} />

              <Text style={styles.fieldLabel}>Téléphone</Text>
              <TextInput style={styles.fieldInput} value={vetTel} onChangeText={t => { setVetTel(t); setVetLieuId(null); }} placeholder="06…" placeholderTextColor={colors.textMuted} keyboardType="phone-pad" returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()} />

              <Text style={styles.fieldLabel}>Adresse</Text>
              <TextInput style={styles.fieldInput} value={vetAdresse} onChangeText={t => { setVetAdresse(t); setVetLieuId(null); }} placeholder="Adresse du cabinet" placeholderTextColor={colors.textMuted} returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()} />

              <TouchableOpacity style={styles.checkboxRow} onPress={() => setSterilise(!sterilise)}>
                <Ionicons name={sterilise ? 'checkbox' : 'square-outline'} size={20} color={sterilise ? colors.sage : colors.textMuted} />
                <Text style={styles.checkboxLabel}>Chien stérilisé</Text>
              </TouchableOpacity>

              {sterilise && (
                <>
                  <Text style={styles.fieldLabel}>Date de stérilisation</Text>
                  <TouchableOpacity style={styles.dateBtn} onPress={() => setShowSterilisationPicker(true)}>
                    <Ionicons name="calendar-outline" size={16} color={colors.bordeaux} />
                    <Text style={styles.dateBtnText}>
                      {dateSterilisation ? dateSterilisation.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Choisir une date'}
                    </Text>
                  </TouchableOpacity>
                  {showSterilisationPicker && (
                    <DateTimePicker
                      value={dateSterilisation || new Date()} mode="date"
                      display={Platform.OS === 'ios' ? 'inline' : 'default'}
                      maximumDate={new Date()}
                      onChange={(_, d) => { setShowSterilisationPicker(Platform.OS === 'ios'); if (d) setDateSterilisation(d); }}
                    />
                  )}
                </>
              )}

              <TouchableOpacity style={styles.saveBtn} onPress={saveInfo} disabled={savingInfo}>
                {savingInfo ? <ActivityIndicator color={colors.ivory} size="small" /> : <Text style={styles.saveBtnText}>Enregistrer</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={vetPickerModal} animationType="slide" transparent onRequestClose={() => setVetPickerModal(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Choisir un vétérinaire</Text>
              <TouchableOpacity onPress={() => setVetPickerModal(false)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <View style={styles.vetSearchWrap}>
              <Ionicons name="search" size={16} color={colors.textMuted} />
              <TextInput
                style={styles.vetSearchInput}
                value={vetSearch}
                onChangeText={searchVets}
                placeholder="Nom du cabinet vétérinaire…"
                placeholderTextColor={colors.textMuted}
                autoFocus
              />
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
              {vetSearchLoading ? (
                <ActivityIndicator style={{ padding: 24 }} color={colors.terra} />
              ) : vetSearch.trim().length < 2 ? (
                <Text style={styles.emptyMini} numberOfLines={2}>{'\n'}Tape au moins 2 lettres pour chercher parmi les fiches vétérinaires de la carte.</Text>
              ) : vetResults.length === 0 ? (
                <Text style={styles.emptyMini}>{'\n'}Aucun vétérinaire trouvé sur la carte pour cette recherche.</Text>
              ) : vetResults.map(v => (
                <TouchableOpacity key={v.id} style={styles.vetResultRow} onPress={() => selectVetLieu(v)}>
                  <View style={styles.vetResultIcon}><Ionicons name="medkit-outline" size={16} color={colors.terra} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.vetResultNom}>{v.nom}</Text>
                    {v.ville ? <Text style={styles.vetResultVille}>{v.ville}</Text> : null}
                  </View>
                  <Ionicons name="chevron-forward" size={15} color={colors.textMuted} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivoryLight },
  content: { padding: 16, paddingBottom: 40, gap: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ivoryLight },

  headerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border,
    padding: 16,
  },
  photoWrap: { position: 'relative' },
  photo: { width: 64, height: 64, borderRadius: 32 },
  photoFallback: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: colors.ivoryPale,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  photoEditBadge: {
    position: 'absolute', bottom: -2, right: -2, width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.terra, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.white,
  },
  dogName: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 19, color: colors.bordeaux },
  dogMeta: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, marginTop: 2 },
  infoLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  infoLinkText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.terra },

  quickRow: { flexDirection: 'row', gap: 10 },
  quickCard: {
    flex: 1, backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    padding: 14,
  },
  quickLabel: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  quickValue: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 17, color: colors.bordeaux, marginTop: 4 },
  quickSub: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 2 },

  section: {
    backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border,
    padding: 16,
  },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 15, color: colors.bordeaux, marginBottom: 10 },
  emptyMini: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted },

  upcomingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  upcomingText: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMid },
  upcomingBadge: { backgroundColor: colors.ivoryPale, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1, borderColor: colors.border },
  upcomingBadgeUrgent: { backgroundColor: colors.terra, borderColor: colors.terra },
  upcomingBadgeText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.textMid },
  upcomingBadgeTextUrgent: { color: colors.white },

  questionInputRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  questionInput: {
    flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux,
    borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
    backgroundColor: colors.ivoryPale,
  },
  questionAddBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: colors.terra, alignItems: 'center', justifyContent: 'center' },
  questionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  questionCheck: {},
  questionText: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMid },
  questionTextDone: { color: colors.textMuted, textDecorationLine: 'line-through' },

  entryRow: { flexDirection: 'row', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border },
  entryIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  entryCategory: { fontFamily: 'DMSans_500Medium', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 1 },
  entryTitle: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
  entrySub: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, marginTop: 2 },
  entryNotes: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMid, marginTop: 4, fontStyle: 'italic' },
  entryHint: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 8, textAlign: 'center' },

  filterBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  filterBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.terra },
  filterOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'flex-end', paddingTop: 140, paddingRight: 16 },
  filterCard: { backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingVertical: 6, minWidth: 190, elevation: 4, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  filterOption: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 11 },
  filterOptionText: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.textMid },
  filterOptionTextActive: { fontFamily: 'DMSans_500Medium', color: colors.bordeaux },

  entrySwipeActions: { flexDirection: 'row', alignItems: 'stretch' },
  entrySwipeBtn: { width: 72, alignItems: 'center', justifyContent: 'center', gap: 3 },
  entrySwipeBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 10, color: colors.ivory },

  rappelHint: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, marginTop: -4, marginBottom: 4 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.ivoryPale, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%', overflow: 'hidden' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.white,
  },
  modalTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.bordeaux },
  modalContent: { padding: 16, gap: 4, paddingBottom: 32 },

  fieldLabel: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.textMuted, marginTop: 12, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldInput: {
    fontFamily: 'DMSans_400Regular', fontSize: 15, color: colors.bordeaux,
    borderWidth: 1.5, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11, backgroundColor: colors.white,
  },
  fieldTextarea: { minHeight: 70, textAlignVertical: 'top' },
  dateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1.5, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11, backgroundColor: colors.white,
  },
  dateBtnText: { fontFamily: 'DMSans_400Regular', fontSize: 15, color: colors.bordeaux },
  rappelPreview: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, marginTop: 8, fontStyle: 'italic' },

  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderColor: colors.border, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.white,
  },
  typeChipText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.textMid },

  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  checkboxLabel: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.textMid },

  saveBtn: { backgroundColor: colors.terra, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  saveBtnText: { fontFamily: 'DMSans_600SemiBold', fontSize: 15, color: colors.ivory },

  vetFieldHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  vetPickLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  vetPickLinkText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.terra },
  vetLinkedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8,
    backgroundColor: 'rgba(46,125,107,0.08)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
  },
  vetLinkedBadgeText: { flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.sage },
  vetUnlinkText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.textMuted, textDecorationLine: 'underline' },

  vetSearchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.white, marginHorizontal: 16, marginVertical: 12,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  vetSearchInput: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux },
  vetResultRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border,
  },
  vetResultIcon: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(196,105,58,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  vetResultNom: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
  vetResultVille: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, marginTop: 1 },
});
