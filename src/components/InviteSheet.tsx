import React, { useRef, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, Share, Linking, Platform, Image, ActivityIndicator, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { supabase } from '../lib/supabase';
import { track } from '../lib/tracking';
import { colors } from '../lib/theme';

const LIEN_IOS = 'https://apps.apple.com/app/id6780366952';
const LIEN_ANDROID = 'https://play.google.com/store/apps/details?id=fr.thepackclub.app';

export type Invitant = {
  code: string;
  username: string | null;
  prenom: string | null;
  nomChien: string | null;
  avatarUrl: string | null;
};

export function messageInvitation(i: Invitant) {
  const pseudo = i.username ? ` (ou mon pseudo @${i.username})` : '';
  return (
    `🐾 Rejoins-moi sur The Pack La Meute !\n` +
    `Inscris-toi avec mon code parrain ${i.code}${pseudo} pour rejoindre ma meute.\n\n` +
    `📲 iPhone : ${LIEN_IOS}\n` +
    `🤖 Android : ${LIEN_ANDROID}`
  );
}

// Pour ouvrir l'invitation hors de la carte "Ma meute" (ex. apres une balade)
export async function chargerInvitant(): Promise<Invitant | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const [{ data: res }, { data: p }] = await Promise.all([
    supabase.rpc('mon_parrainage'),
    supabase.from('profils').select('prenom,nom_chien,avatar_url').eq('id', session.user.id).maybeSingle(),
  ]);
  if (!res?.code) return null;
  return {
    code: res.code,
    username: res.username ?? null,
    prenom: p?.prenom ?? null,
    nomChien: p?.nom_chien ?? null,
    avatarUrl: p?.avatar_url ?? null,
  };
}

type Canal = 'whatsapp' | 'instagram' | 'sms' | 'autre';

export default function InviteSheet({ visible, onClose, invitant }: {
  visible: boolean;
  onClose: () => void;
  invitant: Invitant;
}) {
  const storyRef = useRef<View>(null);
  const [capture, setCapture] = useState(false);
  const message = messageInvitation(invitant);

  async function partagerTexte() {
    try { await Share.share({ message }); } catch {}
  }

  async function envoyer(canal: Canal) {
    track('parrainage_partage', { canal });
    const texte = encodeURIComponent(message);
    try {
      if (canal === 'whatsapp') {
        await Linking.openURL(`whatsapp://send?text=${texte}`);
      } else if (canal === 'sms') {
        await Linking.openURL(Platform.OS === 'ios' ? `sms:&body=${texte}` : `sms:?body=${texte}`);
      } else if (canal === 'instagram') {
        // Instagram n'accepte pas de texte pre-rempli : on partage une image
        // story 9:16 avec le code, a publier en story ou envoyer en message.
        if (!storyRef.current) return;
        setCapture(true);
        const uri = await captureRef(storyRef, { format: 'png', quality: 1, width: 1080, height: 1920 });
        setCapture(false);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Partager mon invitation' });
        } else {
          await Share.share({ url: uri, message });
        }
      } else {
        await partagerTexte();
      }
    } catch {
      setCapture(false);
      // App absente (WhatsApp non installe...) : feuille de partage native
      await partagerTexte();
    }
  }

  const CANAUX: { key: Canal; label: string; icon: keyof typeof Ionicons.glyphMap; color: string }[] = [
    { key: 'whatsapp', label: 'WhatsApp', icon: 'logo-whatsapp', color: '#25D366' },
    { key: 'instagram', label: 'Instagram', icon: 'logo-instagram', color: '#C13584' },
    { key: 'sms', label: 'SMS', icon: 'chatbubble-ellipses', color: colors.sage },
    { key: 'autre', label: 'Autres apps', icon: 'share-outline', color: colors.bordeaux },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title}>Invite tes amis dans ta meute</Text>
          <Text style={styles.sub}>
            Ils saisissent ton code <Text style={styles.code}>{invitant.code}</Text> à l'inscription et rejoignent ta meute.
          </Text>

          <View style={styles.grid}>
            {CANAUX.map(c => (
              <TouchableOpacity key={c.key} style={styles.canal} onPress={() => envoyer(c.key)} disabled={capture} activeOpacity={0.8}>
                <View style={[styles.canalIcon, { backgroundColor: c.color }]}>
                  {c.key === 'instagram' && capture
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Ionicons name={c.icon} size={24} color="#fff" />}
                </View>
                <Text style={styles.canalLabel}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.apercu}>
            <Text style={styles.apercuText} numberOfLines={4}>{message}</Text>
          </View>

          <TouchableOpacity style={styles.fermer} onPress={onClose}>
            <Text style={styles.fermerText}>Fermer</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>

      {/* Story 9:16 hors ecran, capturee pour Instagram */}
      <View ref={storyRef} collapsable={false} style={styles.story}>
        <Text style={styles.storyBrand}>THE PACK LA MEUTE</Text>
        <View style={styles.storyLine} />
        <Text style={styles.storyTitle}>Rejoins{'\n'}ma meute</Text>
        <View style={styles.storyAvatarRing}>
          <View style={styles.storyAvatar}>
            {invitant.avatarUrl
              ? <Image source={{ uri: invitant.avatarUrl }} style={styles.storyAvatarImg} />
              : <Text style={styles.storyAvatarLetter}>🐾</Text>}
          </View>
        </View>
        <Text style={styles.storyName}>
          {[invitant.prenom, invitant.nomChien].filter(Boolean).join(' & ') || 'The Pack'}
        </Text>
        {invitant.username ? <Text style={styles.storyUsername}>@{invitant.username}</Text> : null}
        <View style={styles.storyFlex} />
        <Text style={styles.storyCodeLabel}>Mon code parrain</Text>
        <View style={styles.storyCodeBox}>
          <Text style={styles.storyCode}>{invitant.code}</Text>
        </View>
        <Text style={styles.storyHint}>à saisir à l'inscription</Text>
        <View style={[styles.storyLine, { opacity: 0.3, marginTop: 26, marginBottom: 16 }]} />
        <Text style={styles.storyCta}>Lieux dog-friendly · Balades · Événements</Text>
        <Text style={styles.storyUrl}>Dispo sur l'App Store et Google Play</Text>
        <View style={{ height: 40 }} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.ivoryPale, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 34,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 14 },
  title: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 20, color: colors.bordeaux },
  sub: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMid, marginTop: 6, lineHeight: 19 },
  code: { fontFamily: 'DMSans_500Medium', color: colors.terra },
  grid: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20 },
  canal: { alignItems: 'center', width: '24%' },
  canalIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  canalLabel: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.bordeaux, marginTop: 6 },
  apercu: {
    backgroundColor: colors.white, borderRadius: 12, padding: 12, marginTop: 20,
    borderWidth: 1, borderColor: colors.border,
  },
  apercuText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, lineHeight: 17 },
  fermer: { alignItems: 'center', paddingVertical: 12, marginTop: 8 },
  fermerText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.textMuted },

  story: {
    position: 'absolute', left: -9999, top: 0,
    width: 360, height: 640,
    backgroundColor: '#3D1A1A',
    alignItems: 'center', paddingTop: 44, paddingHorizontal: 24,
  },
  storyBrand: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: 'rgba(232,168,130,0.85)', letterSpacing: 2.5 },
  storyLine: { width: 260, height: 1, backgroundColor: 'rgba(196,105,58,0.5)', marginTop: 10 },
  storyTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 46, lineHeight: 52, color: '#F5EFE0', textAlign: 'center', marginTop: 22 },
  storyAvatarRing: {
    marginTop: 28, width: 116, height: 116, borderRadius: 58,
    borderWidth: 2, borderColor: 'rgba(196,105,58,0.8)', alignItems: 'center', justifyContent: 'center',
  },
  storyAvatar: {
    width: 104, height: 104, borderRadius: 52, overflow: 'hidden',
    backgroundColor: '#522222', alignItems: 'center', justifyContent: 'center',
  },
  storyAvatarImg: { width: 104, height: 104 },
  storyAvatarLetter: { fontSize: 40 },
  storyName: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 24, color: '#F5EFE0', marginTop: 16, textAlign: 'center' },
  storyUsername: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: 'rgba(232,168,130,0.9)', marginTop: 3 },
  storyFlex: { flex: 1 },
  storyCodeLabel: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: 'rgba(245,239,224,0.6)' },
  storyCodeBox: {
    marginTop: 8, paddingHorizontal: 26, paddingVertical: 12, borderRadius: 14,
    backgroundColor: '#C4693A',
  },
  storyCode: { fontFamily: 'DMSans_500Medium', fontSize: 30, color: '#F5EFE0', letterSpacing: 3 },
  storyHint: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: 'rgba(245,239,224,0.5)', marginTop: 8 },
  storyCta: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: '#F5EFE0' },
  storyUrl: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: 'rgba(196,105,58,0.9)', marginTop: 5 },
});
