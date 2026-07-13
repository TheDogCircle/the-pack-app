import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
  Modal, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { useSession } from '../hooks/useSession';

const RACES = [
  'Akita Inu','Alaskan Malamute','Basenji','Basset Hound','Beagle','Berger Allemand',
  'Berger Australien','Berger Belge Malinois','Berger des Pyrénées','Bichon Frisé',
  'Bobtail (Old English Sheepdog)','Border Collie','Boston Terrier','Bouledogue Anglais',
  'Bouledogue Français','Boxer','Braque de Weimar','Braque Français','Bull Terrier',
  'Cairn Terrier','Caniche (Toy / Nain / Moyen / Grand)','Carlin (Pug)','Cavalier King Charles',
  'Chihuahua','Chow Chow','Cocker Américain','Cocker Anglais','Colley (Lassie)','Dalmatien',
  'Doberman','Dogue Allemand (Great Dane)','Dogue de Bordeaux','Épagneul Breton',
  'Fox Terrier','Golden Retriever','Husky Sibérien','Jack Russell Terrier',
  'Labrador Retriever','Leonberg','Lévrier (Greyhound / Whippet)','Lhasa Apso',
  'Maltais','Montagne des Pyrénées','Pékinois','Rottweiler','Saint-Bernard','Samoyède',
  'Setter Irlandais','Shiba Inu','Shih Tzu','Spitz Nain (Poméranien)','Teckel',
  'Terre-Neuve','Westie (West Highland White Terrier)','Yorkshire Terrier','Autres',
];

export default function OnboardingScreen() {
  const navigation = useNavigation<any>();
  const { session } = useSession();

  const [step, setStep] = useState<1 | 2>(1);
  const [prenom, setPrenom] = useState('');
  const [ville, setVille] = useState('');
  const [nomChien, setNomChien] = useState('');
  const [raceChien, setRaceChien] = useState('');
  const [raceModal, setRaceModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prenomError, setPrenomError] = useState(false);

  function goStep2() {
    if (!prenom.trim()) { setPrenomError(true); return; }
    setPrenomError(false);
    setStep(2);
  }

  async function finish() {
    if (!session) return;
    setSaving(true);
    await supabase.from('profils').upsert({
      id: session.user.id,
      prenom: prenom.trim() || null,
      ville: ville.trim() || null,
      nom_chien: nomChien.trim() || null,
      race_chien: raceChien || null,
    });
    setSaving(false);
    navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">

        {/* Progress */}
        <View style={styles.progress}>
          <View style={[styles.progressDot, styles.progressDotActive]} />
          <View style={styles.progressLine} />
          <View style={[styles.progressDot, step === 2 && styles.progressDotActive]} />
        </View>

        {step === 1 && (
          <>
            <Text style={styles.paw}>🐾</Text>
            <Text style={styles.title}>Bienvenue dans{'\n'}The Pack Club !</Text>
            <Text style={styles.sub}>Dis-nous comment tu t'appelles pour personnaliser ton expérience.</Text>

            <View style={styles.card}>
              <Text style={styles.label}>Ton prénom *</Text>
              <TextInput
                style={[styles.input, prenomError && styles.inputError]}
                placeholder="Ex : Marie"
                placeholderTextColor={colors.textMuted}
                value={prenom}
                onChangeText={t => { setPrenom(t); setPrenomError(false); }}
                autoCapitalize="words"
                autoFocus
                returnKeyType="next"
              />
              {prenomError && <Text style={styles.errorText}>Le prénom est requis</Text>}

              <Text style={[styles.label, { marginTop: 16 }]}>Ta ville</Text>
              <TextInput
                style={styles.input}
                placeholder="Ex : Paris"
                placeholderTextColor={colors.textMuted}
                value={ville}
                onChangeText={setVille}
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={goStep2}
              />
            </View>

            <TouchableOpacity style={styles.btn} onPress={goStep2}>
              <Text style={styles.btnText}>Suivant →</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 2 && (
          <>
            <Text style={styles.paw}>🐕</Text>
            <Text style={styles.title}>Ton chien</Text>
            <Text style={styles.sub}>Ces informations apparaîtront sur ton profil et aideront la communauté à te retrouver.</Text>

            <View style={styles.card}>
              <Text style={styles.label}>Nom de ton chien</Text>
              <TextInput
                style={styles.input}
                placeholder="Ex : Albus"
                placeholderTextColor={colors.textMuted}
                value={nomChien}
                onChangeText={setNomChien}
                autoCapitalize="words"
                autoFocus
              />

              <Text style={[styles.label, { marginTop: 16 }]}>Race</Text>
              <TouchableOpacity style={styles.racePicker} onPress={() => setRaceModal(true)}>
                <Text style={[styles.racePickerText, !raceChien && { color: colors.textMuted }]}>
                  {raceChien || 'Choisir une race…'}
                </Text>
                <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.btn, saving && styles.btnDisabled]}
              onPress={finish}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color={colors.ivory} />
                : <Text style={styles.btnText}>C'est parti ! 🎉</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={styles.skipBtn} onPress={finish}>
              <Text style={styles.skipText}>Passer cette étape</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      {/* Race picker modal */}
      <Modal visible={raceModal} animationType="slide" transparent>
        <View style={styles.raceOverlay}>
          <View style={styles.raceCard}>
            <View style={styles.raceHeader}>
              <Text style={styles.raceTitle}>Choisir une race</Text>
              <TouchableOpacity onPress={() => setRaceModal(false)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={RACES}
              keyExtractor={r => r}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.raceItem, raceChien === item && styles.raceItemActive]}
                  onPress={() => { setRaceChien(item); setRaceModal(false); }}
                >
                  <Text style={[styles.raceItemText, raceChien === item && styles.raceItemTextActive]}>{item}</Text>
                  {raceChien === item && <Ionicons name="checkmark" size={16} color={colors.terra} />}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bordeaux },
  inner: { flexGrow: 1, padding: 28, paddingTop: 64 },

  progress: { flexDirection: 'row', alignItems: 'center', marginBottom: 40, alignSelf: 'center' },
  progressDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: 'rgba(245,239,224,0.2)',
  },
  progressDotActive: { backgroundColor: colors.terraPale },
  progressLine: { width: 40, height: 1, backgroundColor: 'rgba(245,239,224,0.15)', marginHorizontal: 8 },

  paw: { fontSize: 42, textAlign: 'center', marginBottom: 16 },
  title: {
    fontFamily: 'PlayfairDisplay_500Medium', fontSize: 30,
    color: colors.ivory, textAlign: 'center', marginBottom: 12, lineHeight: 38,
  },
  sub: {
    fontFamily: 'DMSans_300Light', fontSize: 15,
    color: 'rgba(245,239,224,0.6)', textAlign: 'center', lineHeight: 22,
    marginBottom: 32,
  },

  card: {
    backgroundColor: colors.ivoryPale, borderRadius: 18, padding: 20,
    marginBottom: 20,
  },
  label: {
    fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 8,
  },
  input: {
    fontFamily: 'DMSans_400Regular', fontSize: 15,
    backgroundColor: 'white', borderRadius: 10, padding: 14,
    color: colors.bordeaux, borderWidth: 1.5, borderColor: colors.border,
  },
  inputError: { borderColor: '#C43A3A' },
  errorText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#C43A3A', marginTop: 6 },

  racePicker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'white', borderRadius: 10, padding: 14,
    borderWidth: 1.5, borderColor: colors.border,
  },
  racePickerText: { fontFamily: 'DMSans_400Regular', fontSize: 15, color: colors.bordeaux, flex: 1 },

  btn: {
    backgroundColor: colors.terra, borderRadius: 14,
    padding: 16, alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.ivory },

  skipBtn: { alignItems: 'center', marginTop: 16, padding: 8 },
  skipText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: 'rgba(245,239,224,0.35)' },

  raceOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  raceCard: {
    backgroundColor: colors.ivoryPale, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '80%', paddingBottom: 32,
  },
  raceHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 20, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  raceTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.bordeaux },
  raceItem: {
    paddingVertical: 14, paddingHorizontal: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderBottomWidth: 1, borderBottomColor: colors.border + '55',
  },
  raceItemActive: { backgroundColor: colors.terra + '0D' },
  raceItemText: { fontFamily: 'DMSans_400Regular', fontSize: 15, color: colors.bordeaux },
  raceItemTextActive: { fontFamily: 'DMSans_500Medium', color: colors.terra },
});
