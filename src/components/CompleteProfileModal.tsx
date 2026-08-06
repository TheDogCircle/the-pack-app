import React, { useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';

export type MissingFields = { nom: boolean; dateNaissance: boolean; nomChien: boolean };

function formatDate(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export default function CompleteProfileModal({
  visible, userId, missing, onSaved, onDismiss,
}: {
  visible: boolean;
  userId: string;
  missing: MissingFields;
  onSaved: () => void;
  onDismiss: () => void;
}) {
  const [nom, setNom] = useState('');
  const [dateNaissance, setDateNaissance] = useState('');
  const [nomChien, setNomChien] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    const updates: Record<string, string> = {};
    if (missing.nom && nom.trim()) updates.nom = nom.trim();
    if (missing.dateNaissance && dateNaissance.trim()) updates.date_naissance_humain = dateNaissance.trim();
    if (missing.nomChien && nomChien.trim()) updates.nom_chien = nomChien.trim();
    if (!Object.keys(updates).length) { onDismiss(); return; }
    setSaving(true);
    const { error } = await supabase.from('profils').update(updates).eq('id', userId);
    setSaving(false);
    if (!error) onSaved();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.card}>
            <Text style={styles.paw}>🐾</Text>
            <Text style={styles.title}>Complète ton profil</Text>
            <Text style={styles.sub}>Il nous manque quelques infos pour t'offrir la meilleure expérience.</Text>

            {missing.nom && (
              <View style={styles.field}>
                <Text style={styles.label}>Nom</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Ex : Dupont"
                  placeholderTextColor={colors.textMuted}
                  value={nom}
                  onChangeText={setNom}
                  autoCapitalize="words"
                />
              </View>
            )}
            {missing.dateNaissance && (
              <View style={styles.field}>
                <Text style={styles.label}>Ton anniversaire</Text>
                <TextInput
                  style={styles.input}
                  placeholder="JJ/MM/AAAA"
                  placeholderTextColor={colors.textMuted}
                  value={dateNaissance}
                  onChangeText={t => setDateNaissance(formatDate(t))}
                  keyboardType="numeric"
                  maxLength={10}
                />
              </View>
            )}
            {missing.nomChien && (
              <View style={styles.field}>
                <Text style={styles.label}>Nom du chien</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Ex : Albus"
                  placeholderTextColor={colors.textMuted}
                  value={nomChien}
                  onChangeText={setNomChien}
                  autoCapitalize="words"
                />
              </View>
            )}

            <TouchableOpacity style={[styles.btn, saving && styles.btnDisabled]} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator color={colors.ivory} /> : <Text style={styles.btnText}>Enregistrer</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.skip} onPress={onDismiss}>
              <Text style={styles.skipText}>Plus tard</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: colors.ivoryPale, borderRadius: 20, padding: 24 },
  paw: { fontSize: 32, textAlign: 'center', marginBottom: 8 },
  title: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 20, color: colors.bordeaux, textAlign: 'center', marginBottom: 6 },
  sub: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 19, marginBottom: 20 },
  field: { marginBottom: 14 },
  label: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 8 },
  input: { fontFamily: 'DMSans_400Regular', fontSize: 15, backgroundColor: 'white', borderRadius: 10, padding: 14, color: colors.bordeaux, borderWidth: 1.5, borderColor: colors.border },
  btn: { backgroundColor: colors.terra, borderRadius: 14, padding: 15, alignItems: 'center', marginTop: 6 },
  btnDisabled: { opacity: 0.6 },
  btnText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.ivory },
  skip: { alignItems: 'center', paddingTop: 14 },
  skipText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted },
});
