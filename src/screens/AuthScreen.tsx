import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Alert, ActivityIndicator, Image,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { useSession } from '../hooks/useSession';

WebBrowser.maybeCompleteAuthSession();

export default function AuthScreen() {
  const navigation = useNavigation<any>();
  const { session } = useSession();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  useEffect(() => {
    if (session && navigation.canGoBack()) navigation.goBack();
  }, [session]);

  useEffect(() => {
    if (Platform.OS === 'ios') {
      AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => {});
    }
  }, []);

  async function pickAvatar() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (result.canceled || !result.assets[0]) return;
    setAvatarUri(result.assets[0].uri);
  }

  async function handleSubmit() {
    if (!email || !password) {
      Alert.alert('Champs manquants', "Remplis l'email et le mot de passe.");
      return;
    }
    setLoading(true);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) Alert.alert('Erreur', error.message);
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) { Alert.alert('Erreur', error.message); return; }
        // L'upload ne peut se faire que si l'inscription renvoie une session immediate
        // (pas de confirmation par email requise) : sans session, il n'y a pas de token
        // a presenter au storage authentifie. Si une confirmation est requise, la photo
        // est simplement ignoree -- l'utilisateur pourra toujours l'ajouter depuis son
        // profil apres sa premiere connexion.
        if (data.session && avatarUri) {
          try {
            const ext = avatarUri.split('.').pop() || 'jpg';
            const path = `avatars/${data.session.user.id}.${ext}`;
            const formData = new FormData();
            formData.append('file', { uri: avatarUri, name: path, type: `image/${ext}` } as any);
            const { error: upErr } = await supabase.storage.from('avatars').upload(path, formData, { upsert: true });
            if (!upErr) {
              const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
              await supabase.from('profils').update({ avatar_url: urlData.publicUrl }).eq('id', data.session.user.id);
            }
          } catch (e) { /* photo optionnelle : ne bloque jamais la creation de compte */ }
        }
        if (!data.session) Alert.alert('Vérifie ta boîte mail', "Un lien de confirmation t'a été envoyé.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setGoogleLoading(true);
    try {
      const redirectUri = 'thepack://auth/callback';
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectUri, skipBrowserRedirect: true },
      });
      if (error || !data?.url) {
        Alert.alert('Erreur', "Impossible d'ouvrir Google.");
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUri);
      if (result.type === 'success' && result.url) {
        const params = new URLSearchParams(result.url.split('#')[1] ?? result.url.split('?')[1] ?? '');
        const access_token = params.get('access_token');
        const refresh_token = params.get('refresh_token') ?? '';
        if (access_token) {
          const { error: sessErr } = await supabase.auth.setSession({ access_token, refresh_token });
          if (sessErr) Alert.alert('Erreur Google', sessErr.message);
        } else {
          Alert.alert('Erreur Google', 'Aucun token reçu. Réessaie.');
        }
      }
    } finally {
      setGoogleLoading(false);
    }
  }

  async function handleApple() {
    setAppleLoading(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) {
        Alert.alert('Erreur Apple', 'Aucun token reçu.');
        return;
      }
      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
      });
      if (error) Alert.alert('Erreur Apple', error.message);
    } catch (e: any) {
      if (e.code !== 'ERR_REQUEST_CANCELED') {
        Alert.alert('Erreur', e.message);
      }
    } finally {
      setAppleLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>The Pack</Text>
        <Text style={styles.tagline}>La Meute dog-friendly</Text>

        <View style={styles.card}>
          <View style={styles.tabs}>
            <TouchableOpacity
              style={[styles.tab, mode === 'login' && styles.tabActive]}
              onPress={() => setMode('login')}
            >
              <Text style={[styles.tabText, mode === 'login' && styles.tabTextActive]}>Connexion</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, mode === 'signup' && styles.tabActive]}
              onPress={() => setMode('signup')}
            >
              <Text style={[styles.tabText, mode === 'signup' && styles.tabTextActive]}>Inscription</Text>
            </TouchableOpacity>
          </View>

          {mode === 'signup' && (
            <TouchableOpacity style={styles.avatarPicker} onPress={pickAvatar}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatarImg} />
              ) : (
                <Text style={styles.avatarPlaceholder}>📷</Text>
              )}
              <Text style={styles.avatarLabel}>{avatarUri ? 'Changer la photo' : 'Ajouter une photo (optionnel)'}</Text>
            </TouchableOpacity>
          )}

          {appleAvailable && (
            <TouchableOpacity
              style={[styles.btnApple, appleLoading && styles.btnDisabled]}
              onPress={handleApple}
              disabled={appleLoading}
            >
              {appleLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Text style={styles.appleIcon}></Text>
                  <Text style={styles.btnAppleText}>Continuer avec Apple</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.btnGoogle, googleLoading && styles.btnDisabled]}
            onPress={handleGoogle}
            disabled={googleLoading}
          >
            {googleLoading ? (
              <ActivityIndicator color={colors.bordeaux} />
            ) : (
              <>
                <Text style={styles.googleIcon}>G</Text>
                <Text style={styles.btnGoogleText}>Continuer avec Google</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>ou</Text>
            <View style={styles.dividerLine} />
          </View>

          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={colors.textMuted}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
          <TextInput
            style={styles.input}
            placeholder="Mot de passe"
            placeholderTextColor={colors.textMuted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          />

          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color={colors.ivory} />
              : <Text style={styles.btnText}>
                  {mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
                </Text>
            }
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bordeaux },
  inner: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  logo: {
    fontFamily: 'PlayfairDisplay_500Medium',
    fontSize: 42,
    color: colors.ivory,
    textAlign: 'center',
    letterSpacing: 3,
    marginBottom: 8,
  },
  tagline: {
    fontFamily: 'DMSans_300Light',
    fontSize: 14,
    color: colors.terraPale,
    textAlign: 'center',
    fontStyle: 'italic',
    marginBottom: 40,
  },
  card: {
    backgroundColor: colors.ivoryPale,
    borderRadius: 20,
    padding: 20,
    gap: 12,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.ivoryLight,
    borderRadius: 10,
    padding: 4,
    marginBottom: 4,
  },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  tabActive: { backgroundColor: colors.bordeaux },
  tabText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.textMuted },
  tabTextActive: { color: colors.ivory },
  avatarPicker: { alignItems: 'center', marginBottom: 4 },
  avatarImg: { width: 76, height: 76, borderRadius: 38 },
  avatarPlaceholder: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: colors.ivoryLight,
    borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed',
    textAlign: 'center', textAlignVertical: 'center', fontSize: 24, lineHeight: 76,
  },
  avatarLabel: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.terra, marginTop: 8 },
  btnApple: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#000', borderRadius: 12, padding: 14, gap: 10, height: 50,
  },
  appleIcon: { fontSize: 18, color: '#fff', lineHeight: 22 },
  btnAppleText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: '#fff' },
  btnGoogle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.white, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: colors.border, gap: 10,
  },
  googleIcon: { fontFamily: 'DMSans_500Medium', fontSize: 16, color: '#4285F4', fontWeight: '700' },
  btnGoogleText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 2 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted },
  input: {
    fontFamily: 'DMSans_400Regular', backgroundColor: colors.white,
    borderRadius: 10, padding: 14, fontSize: 15, color: colors.bordeaux,
    borderWidth: 1, borderColor: colors.border,
  },
  btn: { backgroundColor: colors.terra, borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 4 },
  btnDisabled: { opacity: 0.6 },
  btnText: { fontFamily: 'DMSans_500Medium', color: colors.ivory, fontSize: 15, fontWeight: '600' },
});
