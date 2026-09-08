import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Image, ActivityIndicator, RefreshControl,
  TouchableOpacity, TextInput, Modal, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useRoute, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
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
  sterilise: boolean; date_sterilisation: string | null;
};

type EntryType = 'vaccin' | 'vermifuge' | 'antiparasitaire' | 'rdv_veto' | 'pesee' | 'note';

type Entry = {
  id: string; type: EntryType; titre: string | null; date: string; date_rappel: string | null;
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

// Meme convention que SettingsScreen (formatDate) : formatage JJ/MM/AAAA au fil de la
// saisie, redefini ici plutot que partage car SettingsScreen ne l'exporte pas.
function formatDateInput(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function parseFrDateToIso(text: string): string | null {
  const m = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

function isoToFrDate(iso: string): string {
  const [yyyy, mm, dd] = iso.split('-');
  return `${dd}/${mm}/${yyyy}`;
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
  const [entryType, setEntryType] = useState<EntryType>('vaccin');
  const [entryTitre, setEntryTitre] = useState('');
  const [entryDate, setEntryDate] = useState('');
  const [entryDateRappel, setEntryDateRappel] = useState('');
  const [entryPoids, setEntryPoids] = useState('');
  const [entryTaille, setEntryTaille] = useState('');
  const [entryNotes, setEntryNotes] = useState('');
  const [savingEntry, setSavingEntry] = useState(false);

  const [infoModal, setInfoModal] = useState(false);
  const [vetNom, setVetNom] = useState('');
  const [vetTel, setVetTel] = useState('');
  const [vetAdresse, setVetAdresse] = useState('');
  const [puce, setPuce] = useState('');
  const [sterilise, setSterilise] = useState(false);
  const [dateSterilisation, setDateSterilisation] = useState('');
  const [savingInfo, setSavingInfo] = useState(false);

  const [newQuestion, setNewQuestion] = useState('');
  const [addingQuestion, setAddingQuestion] = useState(false);

  const load = useCallback(async () => {
    const [{ data: chienData }, { data: privateData }, { data: entriesData }, { data: questionsData }] = await Promise.all([
      supabase.from('chiens')
        .select('id, nom, race, photo_url')
        .eq('id', chienId).single(),
      supabase.from('chien_infos_privees')
        .select('chien_id, puce_identification, veterinaire_nom, veterinaire_telephone, veterinaire_adresse, sterilise, date_sterilisation')
        .eq('chien_id', chienId).maybeSingle(),
      supabase.from('chien_carnet_entries')
        .select('id, type, titre, date, date_rappel, poids_kg, taille_cm, notes')
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
    setPuce(privateInfo?.puce_identification || '');
    setSterilise(privateInfo?.sterilise || false);
    setDateSterilisation(privateInfo?.date_sterilisation ? isoToFrDate(privateInfo.date_sterilisation) : '');
    setInfoModal(true);
  }

  async function saveInfo() {
    if (sterilise && dateSterilisation && !parseFrDateToIso(dateSterilisation)) {
      Alert.alert('Date invalide', 'Utilise le format JJ/MM/AAAA.');
      return;
    }
    setSavingInfo(true);
    const update = {
      chien_id: chienId,
      veterinaire_nom: vetNom.trim() || null,
      veterinaire_telephone: vetTel.trim() || null,
      veterinaire_adresse: vetAdresse.trim() || null,
      puce_identification: puce.trim() || null,
      sterilise,
      date_sterilisation: sterilise ? parseFrDateToIso(dateSterilisation) : null,
    };
    const { error } = await supabase.from('chien_infos_privees').upsert(update);
    setSavingInfo(false);
    if (error) { Alert.alert('Erreur', error.message); return; }
    setPrivateInfo(update);
    setInfoModal(false);
  }

  function openEntryModal() {
    setEntryType('vaccin');
    setEntryTitre('');
    setEntryDate(isoToFrDate(new Date().toISOString().slice(0, 10)));
    setEntryDateRappel('');
    setEntryPoids('');
    setEntryTaille('');
    setEntryNotes('');
    setEntryModal(true);
  }

  async function saveEntry() {
    const dateIso = parseFrDateToIso(entryDate);
    if (!dateIso) { Alert.alert('Date invalide', 'Utilise le format JJ/MM/AAAA.'); return; }
    if (entryDateRappel && !parseFrDateToIso(entryDateRappel)) { Alert.alert('Date de rappel invalide', 'Utilise le format JJ/MM/AAAA.'); return; }
    setSavingEntry(true);
    const payload = {
      chien_id: chienId,
      type: entryType,
      titre: entryTitre.trim() || null,
      date: dateIso,
      date_rappel: entryDateRappel ? parseFrDateToIso(entryDateRappel) : null,
      poids_kg: entryType === 'pesee' && entryPoids ? parseFloat(entryPoids.replace(',', '.')) : null,
      taille_cm: entryType === 'pesee' && entryTaille ? parseFloat(entryTaille.replace(',', '.')) : null,
      notes: entryNotes.trim() || null,
    };
    const { error } = await supabase.from('chien_carnet_entries').insert(payload);
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
  const upcoming = [...entries].filter(e => e.date_rappel).sort((a, b) => (a.date_rappel! < b.date_rappel! ? -1 : 1));

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
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
            <TouchableOpacity onPress={openEntryModal} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="add-circle-outline" size={22} color={colors.terra} />
            </TouchableOpacity>
          </View>
          {entries.length === 0 ? (
            <Text style={styles.emptyMini}>Aucune entrée pour l'instant. Ajoute un vaccin, une pesée, un rendez-vous…</Text>
          ) : entries.map(e => (
            <TouchableOpacity key={e.id} onLongPress={() => deleteEntry(e)} style={styles.entryRow} activeOpacity={0.8}>
              <View style={[styles.entryIcon, { backgroundColor: `${TYPE_META[e.type].color}1A` }]}>
                <Ionicons name={TYPE_META[e.type].icon} size={16} color={TYPE_META[e.type].color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.entryTitle}>{e.titre || TYPE_META[e.type].label}</Text>
                <Text style={styles.entrySub}>
                  {formatDateFr(e.date)}
                  {e.type === 'pesee' && e.poids_kg != null ? ` · ${e.poids_kg} kg${e.taille_cm ? ` · ${e.taille_cm} cm` : ''}` : ''}
                  {e.date_rappel ? ` · rappel le ${formatDateFr(e.date_rappel)}` : ''}
                </Text>
                {e.notes ? <Text style={styles.entryNotes}>{e.notes}</Text> : null}
              </View>
            </TouchableOpacity>
          ))}
          {entries.length > 0 && <Text style={styles.entryHint}>Appui long pour supprimer une entrée.</Text>}
        </View>
      </ScrollView>

      <Modal visible={entryModal} animationType="slide" transparent onRequestClose={() => setEntryModal(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Ajouter au carnet</Text>
              <TouchableOpacity onPress={() => setEntryModal(false)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
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
              <TextInput style={styles.fieldInput} value={entryTitre} onChangeText={setEntryTitre} placeholder={`Ex : ${TYPE_META[entryType].label}`} placeholderTextColor={colors.textMuted} />

              <Text style={styles.fieldLabel}>Date</Text>
              <TextInput style={styles.fieldInput} value={entryDate} onChangeText={t => setEntryDate(formatDateInput(t))} placeholder="JJ/MM/AAAA" placeholderTextColor={colors.textMuted} keyboardType="number-pad" maxLength={10} />

              {REMINDER_TYPES.includes(entryType) && (
                <>
                  <Text style={styles.fieldLabel}>Date de rappel (optionnel)</Text>
                  <TextInput style={styles.fieldInput} value={entryDateRappel} onChangeText={t => setEntryDateRappel(formatDateInput(t))} placeholder="JJ/MM/AAAA" placeholderTextColor={colors.textMuted} keyboardType="number-pad" maxLength={10} />
                </>
              )}

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
                {savingEntry ? <ActivityIndicator color={colors.ivory} size="small" /> : <Text style={styles.saveBtnText}>Ajouter</Text>}
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
            <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabel}>Puce d'identification</Text>
              <TextInput style={styles.fieldInput} value={puce} onChangeText={setPuce} placeholder="N° de puce" placeholderTextColor={colors.textMuted} />

              <Text style={styles.fieldLabel}>Nom du vétérinaire</Text>
              <TextInput style={styles.fieldInput} value={vetNom} onChangeText={setVetNom} placeholder="Dr…" placeholderTextColor={colors.textMuted} />

              <Text style={styles.fieldLabel}>Téléphone</Text>
              <TextInput style={styles.fieldInput} value={vetTel} onChangeText={setVetTel} placeholder="06…" placeholderTextColor={colors.textMuted} keyboardType="phone-pad" />

              <Text style={styles.fieldLabel}>Adresse</Text>
              <TextInput style={styles.fieldInput} value={vetAdresse} onChangeText={setVetAdresse} placeholder="Adresse du cabinet" placeholderTextColor={colors.textMuted} />

              <TouchableOpacity style={styles.checkboxRow} onPress={() => setSterilise(!sterilise)}>
                <Ionicons name={sterilise ? 'checkbox' : 'square-outline'} size={20} color={sterilise ? colors.sage : colors.textMuted} />
                <Text style={styles.checkboxLabel}>Chien stérilisé</Text>
              </TouchableOpacity>

              {sterilise && (
                <>
                  <Text style={styles.fieldLabel}>Date de stérilisation</Text>
                  <TextInput style={styles.fieldInput} value={dateSterilisation} onChangeText={t => setDateSterilisation(formatDateInput(t))} placeholder="JJ/MM/AAAA" placeholderTextColor={colors.textMuted} keyboardType="number-pad" maxLength={10} />
                </>
              )}

              <TouchableOpacity style={styles.saveBtn} onPress={saveInfo} disabled={savingInfo}>
                {savingInfo ? <ActivityIndicator color={colors.ivory} size="small" /> : <Text style={styles.saveBtnText}>Enregistrer</Text>}
              </TouchableOpacity>
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
  entryTitle: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
  entrySub: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, marginTop: 2 },
  entryNotes: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMid, marginTop: 4, fontStyle: 'italic' },
  entryHint: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 8, textAlign: 'center' },

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
});
