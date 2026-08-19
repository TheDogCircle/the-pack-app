import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';

type Props = { children: React.ReactNode; label: string; onClose?: () => void };
type State = { error: Error | null };

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    supabase.from('push_debug_logs').insert({
      to_token: 'RENDER_CRASH',
      title: this.props.label,
      detail: JSON.stringify({ message: error.message, stack: String(error.stack).slice(0, 800), componentStack: info.componentStack?.slice(0, 500) }),
    }).then(() => {}, () => {});
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.wrap}>
          <Text style={styles.emoji}>🐾</Text>
          <Text style={styles.text}>Un souci est survenu ici. Réessaie dans un instant.</Text>
          {this.props.onClose && (
            <TouchableOpacity style={styles.btn} onPress={() => { this.setState({ error: null }); this.props.onClose?.(); }}>
              <Text style={styles.btnText}>Fermer</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  wrap: { padding: 30, alignItems: 'center', gap: 10 },
  emoji: { fontSize: 28 },
  text: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  btn: { marginTop: 6, backgroundColor: colors.terra, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 20 },
  btnText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.ivory },
});
