import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';

export type NpsPending = { contexte: string; pro_account_type: string | null; pro_account_id: string | null };

export default function NpsPromptModal({ pending, onDone }: { pending: NpsPending; onDone: () => void }) {
  const [score, setScore] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  async function markHandled() {
    // Sans ca, nps_prompt_pending() continue de renvoyer cette meme ligne
    // nps_prompts_sent (responded_at jamais mis a jour) -- la question
    // reapparaissait a chaque relance de l'app, meme apres y avoir repondu.
    await supabase.rpc('mark_nps_prompt_responded', {
      p_contexte: pending.contexte,
      p_pro_account_type: pending.pro_account_type,
      p_pro_account_id: pending.pro_account_id,
    });
  }

  async function submit(n: number) {
    setScore(n);
    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('nps_responses').insert({
      user_id: pending.pro_account_id ? null : (user?.id ?? null),
      pro_account_type: pending.pro_account_type,
      pro_account_id: pending.pro_account_id,
      score: n,
      contexte: pending.contexte,
    });
    await markHandled();
    setSubmitting(false);
    setTimeout(onDone, 900);
  }

  function dismiss() {
    setDismissed(true);
    markHandled();
    onDone();
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      {dismissed ? null : (
        <View style={styles.overlay}>
          <View style={styles.card}>
            {score !== null ? (
              <Text style={styles.thanks}>Merci pour ton retour ! 🐾</Text>
            ) : (
              <>
                <Text style={styles.title}>Quelle note donnerais-tu à The Pack ?</Text>
                <Text style={styles.sub}>De 0 (pas du tout) à 10 (totalement) — recommanderais-tu The Pack à un proche ?</Text>
                <View style={styles.scoreGrid}>
                  {Array.from({ length: 11 }, (_, n) => n).map(n => (
                    <TouchableOpacity key={n} style={styles.scoreBtn} disabled={submitting} onPress={() => submit(n)}>
                      {submitting ? <ActivityIndicator size="small" color={colors.terra} /> : <Text style={styles.scoreText}>{n}</Text>}
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity onPress={dismiss}>
                  <Text style={styles.later}>Plus tard</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(20,10,8,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: colors.white, borderRadius: 18, padding: 22, width: '100%', maxWidth: 380 },
  title: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 17, color: colors.bordeaux, textAlign: 'center', marginBottom: 6 },
  sub: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, textAlign: 'center', marginBottom: 16 },
  scoreGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  scoreBtn: {
    width: 36, height: 36, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  scoreText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
  later: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: 16 },
  thanks: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 16, color: colors.bordeaux, textAlign: 'center', paddingVertical: 20 },
});
