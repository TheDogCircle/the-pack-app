import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, Image, TextInput, Alert,
  Modal, Keyboard, Platform, Dimensions, ScrollView, KeyboardAvoidingView,
  Share, Linking,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Contacts from 'expo-contacts';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, uploadToR2 } from '../lib/supabase';
import { sendPushNotification } from '../lib/notifications';
import { mapNavigation } from '../lib/mapNavigation';
import { normalizePhone } from '../lib/phone';
import { getRegion, REGIONS, normalizeText } from '../utils/villeRegion';
import { colors } from '../lib/theme';
import { useSession } from '../hooks/useSession';
import AuthGate from '../components/AuthGate';
import ErrorBoundary from '../components/ErrorBoundary';
import { AmbassadeurBadge, ExplorateurBadge } from '../components/AmbassadeurBadge';
import MessagerieScreen from './MessagerieScreen';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ─── Types ────────────────────────────────────────────────────────────────────

type CommunityPost = {
  id: string;
  user_id: string;
  type?: string;
  image_url: string | null;
  images?: string[];
  caption: string | null;
  lieu_id: string | null;
  auto_generated: boolean;
  created_at: string;
  balade_id?: string | null;
  balades?: { distance_km: number | null; duree_secondes: number | null } | null;
  profils: { prenom: string; avatar_url: string | null; ambassadeur?: boolean | null } | null;
  lieux: { id: string; nom: string; cat: string; ville: string } | null;
  community_post_likes: { user_id: string }[];
  community_post_comments: { id: string }[];
  fromMap?: boolean;
  nom_chien?: string | null;
  realPhotoId?: string | null;
  photoGroupIds?: string[];
};

type Comment = {
  id: string;
  content: string;
  created_at: string;
  user_id: string;
  profils: { prenom: string; avatar_url: string | null } | null;
};

type LieuResult = { id: string; nom: string; cat: string; ville: string };

type MembreItem = {
  id: string;
  user: {
    id: string;
    prenom: string;
    avatar_url: string | null;
    ambassadeur?: boolean | null;
    explorateur?: boolean | null;
  };
  ville: string | null;
  nomChien: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(date: string): string {
  const m = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
  if (m < 1) return 'À l\'instant';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}j`;
  return new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function fmtDureeFeed(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtAllureFeed(totalSec: number, km: number): string {
  if (!km || km <= 0) return '';
  const secPerKm = totalSec / km;
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}'${String(s).padStart(2, '0')}/km`;
}

function PostAvatar({ prenom, avatarUrl }: { prenom: string; avatarUrl: string | null }) {
  return avatarUrl ? (
    <Image source={{ uri: avatarUrl }} style={styles.postAvatarImg} />
  ) : (
    <View style={styles.postAvatarFallback}>
      <Text style={styles.postAvatarLetter}>{(prenom || '?')[0].toUpperCase()}</Text>
    </View>
  );
}

// ─── PostCard ─────────────────────────────────────────────────────────────────

type PostCardProps = {
  post: CommunityPost;
  myUserId: string;
  onLike: (postId: string) => void;
  onCommentPress: (post: CommunityPost) => void;
  onLieuPress: (lieuId: string) => void;
  onDeletePress: (post: CommunityPost) => void;
};

function PostCard({ post, myUserId, onLike, onCommentPress, onLieuPress, onDeletePress }: PostCardProps) {
  const likedByMe = post.community_post_likes.some(l => l.user_id === myUserId);
  const likeCount = post.community_post_likes.length;
  const commentCount = post.community_post_comments.length;
  const author = post.profils?.prenom || 'Membre';
  const [imgIndex, setImgIndex] = useState(0);
  const images = post.images && post.images.length > 0 ? post.images : (post.image_url ? [post.image_url] : []);
  const isCarousel = images.length > 1;

  return (
    <View style={styles.postCard}>
      <View style={styles.postHeader}>
        <PostAvatar prenom={author} avatarUrl={post.profils?.avatar_url ?? null} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={styles.postAuthor}>{author}</Text>
            {post.profils?.ambassadeur ? <AmbassadeurBadge /> : null}
          </View>
          <Text style={styles.postTime}>{timeAgo(post.created_at)}</Text>
        </View>
        {isCarousel && (
          <View style={styles.carouselCounter}>
            <Text style={styles.carouselCounterText}>{imgIndex + 1}/{images.length}</Text>
          </View>
        )}
        {post.user_id === myUserId && (
          <TouchableOpacity style={styles.postMenuBtn} onPress={() => onDeletePress(post)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <View>
        {isCarousel ? (
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={e => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
              setImgIndex(idx);
            }}
          >
            {images.map((uri, i) => (
              <Image key={i} source={{ uri }} style={styles.postImage} resizeMode="cover" />
            ))}
          </ScrollView>
        ) : (
          <Image source={{ uri: images[0] }} style={styles.postImage} resizeMode="cover" />
        )}
        {post.fromMap && (
          <View style={styles.fromMapBadge}>
            <Ionicons name="map-outline" size={11} color="#fff" />
            <Text style={styles.fromMapBadgeText}>Carte</Text>
          </View>
        )}
      </View>
      {isCarousel && (
        <View style={styles.carouselDots}>
          {images.map((_, i) => (
            <View key={i} style={[styles.carouselDot, i === imgIndex && styles.carouselDotActive]} />
          ))}
        </View>
      )}

      <View style={styles.postActions}>
        <TouchableOpacity style={styles.postActionBtn} onPress={() => onLike(post.id)}>
          <Ionicons
            name={likedByMe ? 'heart' : 'heart-outline'}
            size={22}
            color={likedByMe ? '#E05070' : colors.bordeaux}
          />
          {likeCount > 0 && (
            <Text style={[styles.postActionCount, likedByMe && { color: '#E05070' }]}>
              {likeCount}
            </Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.postActionBtn} onPress={() => onCommentPress(post)}>
          <Ionicons name="chatbubble-outline" size={20} color={colors.bordeaux} />
          {commentCount > 0 && <Text style={styles.postActionCount}>{commentCount}</Text>}
        </TouchableOpacity>
      </View>

      {post.lieux && (
        <TouchableOpacity style={styles.lieuTag} onPress={() => onLieuPress(post.lieux!.id)}>
          <Ionicons name="location-outline" size={12} color={colors.terra} />
          <Text style={styles.lieuTagText} numberOfLines={1}>
            {post.lieux.nom}{post.lieux.ville ? `, ${post.lieux.ville}` : ''}
          </Text>
        </TouchableOpacity>
      )}

      {post.caption ? (
        <Text style={styles.postCaption}>
          <Text style={styles.postCaptionBold}>{author} </Text>
          {post.caption}
        </Text>
      ) : post.fromMap && post.nom_chien ? (
        <Text style={styles.postCaption}>
          <Text style={styles.postCaptionBold}>{author} </Text>
          avec {post.nom_chien}
        </Text>
      ) : null}
    </View>
  );
}

// ─── NouveauLieuCard ──────────────────────────────────────────────────────────

function NouveauLieuCard({ post, onLieuPress }: { post: CommunityPost; onLieuPress: (id: string) => void }) {
  const author = post.profils?.prenom || 'Un membre';
  const lieu = post.lieux;

  return (
    <View style={[styles.postCard, styles.lieuCard]}>
      <View style={styles.postHeader}>
        <PostAvatar prenom={author} avatarUrl={post.profils?.avatar_url ?? null} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={styles.postAuthor}>{author}</Text>
            {post.profils?.ambassadeur ? <AmbassadeurBadge /> : null}
          </View>
          <Text style={styles.postTime}>{timeAgo(post.created_at)}</Text>
        </View>
      </View>

      <TouchableOpacity
        style={styles.nouveauLieuBody}
        onPress={() => lieu && onLieuPress(lieu.id)}
        activeOpacity={lieu ? 0.8 : 1}
      >
        <View style={styles.nouveauLieuIconWrap}>
          <Ionicons name="location" size={26} color={colors.terra} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.nouveauLieuLabel}>a ajouté un lieu dog-friendly</Text>
          {lieu ? (
            <>
              <Text style={styles.nouveauLieuNom}>{lieu.nom}</Text>
              <Text style={styles.nouveauLieuMeta}>{lieu.cat} · {lieu.ville}</Text>
            </>
          ) : null}
        </View>
        {lieu ? <Ionicons name="chevron-forward" size={16} color={colors.textMuted} /> : null}
      </TouchableOpacity>
    </View>
  );
}

// ─── BaladeCard ───────────────────────────────────────────────────────────────

function BaladeCard({ post, myUserId, onLike, onCommentPress, onBaladePress, onDeletePress }: {
  post: CommunityPost;
  myUserId: string;
  onLike: (postId: string) => void;
  onCommentPress: (post: CommunityPost) => void;
  onBaladePress: (post: CommunityPost) => void;
  onDeletePress: (post: CommunityPost) => void;
}) {
  const likedByMe = post.community_post_likes.some(l => l.user_id === myUserId);
  const likeCount = post.community_post_likes.length;
  const commentCount = post.community_post_comments.length;
  const author = post.profils?.prenom || 'Un membre';
  const nom = (post.caption || '').split(' · ')[0] || 'Balade';
  const [imgIndex, setImgIndex] = useState(0);
  const images = post.images && post.images.length > 0 ? post.images : (post.image_url ? [post.image_url] : []);
  const isCarousel = images.length > 1;
  const dist = post.balades?.distance_km ?? null;
  const dureeSec = post.balades?.duree_secondes ?? null;
  const allure = dist && dureeSec ? fmtAllureFeed(dureeSec, dist) : null;

  return (
    <View style={[styles.postCard, styles.baladeCard]}>
      <View style={styles.postHeader}>
        <PostAvatar prenom={author} avatarUrl={post.profils?.avatar_url ?? null} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={styles.postAuthor}>{author}</Text>
            {post.profils?.ambassadeur ? <AmbassadeurBadge /> : null}
          </View>
          <Text style={styles.postTime}>a partagé une balade · {timeAgo(post.created_at)}</Text>
        </View>
        {isCarousel && (
          <View style={styles.carouselCounter}>
            <Text style={styles.carouselCounterText}>{imgIndex + 1}/{images.length}</Text>
          </View>
        )}
        {post.user_id === myUserId && (
          <TouchableOpacity style={styles.postMenuBtn} onPress={() => onDeletePress(post)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity onPress={() => onBaladePress(post)} activeOpacity={0.85}>
        <Text style={styles.baladeCardTitle}>{nom}</Text>

        {(dist || dureeSec) && (
          <View style={styles.baladeStravaStats}>
            <View style={styles.baladeStravaStatItem}>
              <Text style={styles.baladeStravaStatValue}>{dist ? `${dist} km` : '—'}</Text>
              <Text style={styles.baladeStravaStatLabel}>Distance</Text>
            </View>
            <View style={styles.baladeStravaStatItem}>
              <Text style={styles.baladeStravaStatValue}>{allure || '—'}</Text>
              <Text style={styles.baladeStravaStatLabel}>Allure</Text>
            </View>
            <View style={styles.baladeStravaStatItem}>
              <Text style={styles.baladeStravaStatValue}>{dureeSec ? fmtDureeFeed(dureeSec) : '—'}</Text>
              <Text style={styles.baladeStravaStatLabel}>Durée</Text>
            </View>
          </View>
        )}

        {images.length > 0 ? (
          isCarousel ? (
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={e => {
                const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
                setImgIndex(idx);
              }}
            >
              {images.map((uri, i) => (
                <Image key={i} source={{ uri }} style={styles.postImage} resizeMode="cover" />
              ))}
            </ScrollView>
          ) : (
            <Image source={{ uri: images[0] }} style={styles.postImage} resizeMode="cover" />
          )
        ) : null}
      </TouchableOpacity>
      {isCarousel && (
        <View style={styles.carouselDots}>
          {images.map((_, i) => (
            <View key={i} style={[styles.carouselDot, i === imgIndex && styles.carouselDotActive]} />
          ))}
        </View>
      )}

      <View style={styles.postActions}>
        <TouchableOpacity style={styles.postActionBtn} onPress={() => onLike(post.id)}>
          <Ionicons
            name={likedByMe ? 'heart' : 'heart-outline'}
            size={22}
            color={likedByMe ? '#E05070' : colors.bordeaux}
          />
          {likeCount > 0 && (
            <Text style={[styles.postActionCount, likedByMe && { color: '#E05070' }]}>
              {likeCount}
            </Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.postActionBtn} onPress={() => onCommentPress(post)}>
          <Ionicons name="chatbubble-outline" size={20} color={colors.bordeaux} />
          {commentCount > 0 && <Text style={styles.postActionCount}>{commentCount}</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── CommentsModal ────────────────────────────────────────────────────────────

function CommentsModal({
  post, visible, onClose, myUserId,
}: {
  post: CommunityPost | null;
  visible: boolean;
  onClose: () => void;
  myUserId: string;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [kbHeight, setKbHeight] = useState(0);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible && post) fetchComments(post.id);
    else setComments([]);
  }, [visible, post?.id]);

  // Modal en presentationStyle="pageSheet" : KeyboardAvoidingView calcule mal
  // sa hauteur disponible dans ce contexte (le sheet ne couvre pas tout
  // l'écran), d'où le clavier qui recouvrait le champ. On suit le clavier
  // manuellement à la place, fiable quel que soit le presentationStyle.
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, e => setKbHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  async function fetchComments(postId: string) {
    setLoadingComments(true);
    let data: any[] | null = null;
    if (post?.fromMap && post.realPhotoId) {
      const { data: d } = await supabase
        .from('photo_comments')
        .select('id, content, created_at, user_id')
        .eq('photo_id', post.realPhotoId)
        .order('created_at', { ascending: true });
      data = d;
    } else {
      const { data: d } = await supabase
        .from('community_post_comments')
        .select('id, content, created_at, user_id')
        .eq('post_id', postId)
        .order('created_at', { ascending: true });
      data = d;
    }
    const userIds = [...new Set((data || []).map((c: any) => c.user_id))];
    let profileMap: Record<string, any> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profils').select('id, prenom, avatar_url').in('id', userIds);
      profileMap = Object.fromEntries((profiles || []).map((p: any) => [p.id, p]));
    }
    setComments((data || []).map((c: any) => ({ ...c, profils: profileMap[c.user_id] || null })));
    setLoadingComments(false);
  }

  async function sendComment() {
    if (!text.trim() || !post || !myUserId) return;
    setSending(true);
    let error: any = null;
    if (post.fromMap && post.realPhotoId) {
      const { error: e } = await supabase.from('photo_comments').insert({
        photo_id: post.realPhotoId, user_id: myUserId, content: text.trim(),
      });
      error = e;
    } else {
      const { error: e } = await supabase.from('community_post_comments').insert({
        post_id: post.id, user_id: myUserId, content: text.trim(),
      });
      error = e;
    }
    if (error) { Alert.alert('Erreur', error.message); setSending(false); return; }
    setText('');
    await fetchComments(post.id);
    setSending(false);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.commentsOverlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={[styles.commentsSheet, { maxHeight: SCREEN_HEIGHT * 0.75, marginBottom: kbHeight }]}>
          <View style={styles.commentsHandle} />
          <View style={styles.commentsHeader}>
            <Text style={styles.commentsTitle}>Commentaires</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={24} color={colors.bordeaux} />
            </TouchableOpacity>
          </View>

          {loadingComments ? (
            <ActivityIndicator color={colors.terra} style={{ paddingVertical: 30 }} />
          ) : (
            <FlatList
              data={comments}
              keyExtractor={c => c.id}
              style={{ flexShrink: 1 }}
              contentContainerStyle={styles.commentsList}
              ListEmptyComponent={
                <Text style={styles.commentsEmpty}>Aucun commentaire. Sois le premier !</Text>
              }
              renderItem={({ item: c }) => (
                <View style={styles.commentRow}>
                  <PostAvatar prenom={c.profils?.prenom || '?'} avatarUrl={c.profils?.avatar_url ?? null} />
                  <View style={styles.commentBubble}>
                    <Text style={styles.commentAuthor}>{c.profils?.prenom || 'Membre'}</Text>
                    <Text style={styles.commentContent}>{c.content}</Text>
                  </View>
                </View>
              )}
            />
          )}

          <View style={[styles.commentInputRow, { paddingBottom: kbHeight > 0 ? 12 : Math.max(insets.bottom, 12) }]}>
            <TextInput
              style={styles.commentTextInput}
              placeholder="Ajouter un commentaire…"
              placeholderTextColor={colors.textMuted}
              value={text}
              onChangeText={setText}
              multiline
            />
            <TouchableOpacity onPress={sendComment} disabled={!text.trim() || sending}>
              {sending ? (
                <ActivityIndicator color={colors.terra} size="small" />
              ) : (
                <Ionicons name="send" size={20} color={text.trim() ? colors.terra : colors.textMuted} />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── NewPostModal ─────────────────────────────────────────────────────────────

async function notifyFollowersNewPost(userId: string, postId: string) {
  const [{ data: followers }, { data: me }] = await Promise.all([
    supabase.from('follows').select('follower_id').eq('following_id', userId).eq('statut', 'accepte'),
    supabase.from('profils').select('prenom').eq('id', userId).single(),
  ]);
  if (!followers?.length) return;
  const { data: recipients } = await supabase.from('profils')
    .select('push_token')
    .in('id', followers.map(f => f.follower_id))
    .not('push_token', 'is', null)
    .or('notif_new_post.is.null,notif_new_post.eq.true');
  if (!recipients?.length) return;
  const prenom = me?.prenom || 'Quelqu\'un que tu suis';
  for (const r of recipients) {
    if (r.push_token) sendPushNotification(r.push_token, 'Nouvelle photo', `${prenom} a publié une nouvelle photo`, { type: 'new_post', postId });
  }
}

function NewPostModal({
  visible, onClose, myUserId, onPosted, navigation,
}: {
  visible: boolean;
  onClose: () => void;
  myUserId: string;
  onPosted: () => void;
  navigation: any;
}) {
  const [imageUris, setImageUris] = useState<string[]>([]);
  const [caption, setCaption] = useState('');
  const [lieuSearch, setLieuSearch] = useState('');
  const [lieuResults, setLieuResults] = useState<LieuResult[]>([]);
  const [lieuSearched, setLieuSearched] = useState(false);
  const [selectedLieu, setSelectedLieu] = useState<LieuResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MAX_PHOTOS = 5;

  function reset() {
    setImageUris([]);
    setCaption('');
    setLieuSearch('');
    setLieuResults([]);
    setLieuSearched(false);
    setSelectedLieu(null);
    setUploading(false);
  }

  function pickImage() {
    const remaining = MAX_PHOTOS - imageUris.length;
    if (remaining <= 0) return;
    Alert.alert('Ajouter une photo', '', [
      {
        text: 'Prendre une photo',
        onPress: async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) {
            Alert.alert('Permission refusée', 'Autorise l\'accès à la caméra dans les Réglages.');
            return;
          }
          const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'], quality: 0.8, allowsEditing: true, aspect: [4, 3],
          });
          if (!result.canceled && result.assets[0]) {
            setImageUris(prev => [...prev, result.assets[0].uri].slice(0, MAX_PHOTOS));
          }
        },
      },
      {
        text: 'Choisir depuis la galerie',
        onPress: async () => {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) {
            Alert.alert('Permission refusée', 'Autorise l\'accès à ta galerie dans les Réglages.');
            return;
          }
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'], quality: 0.8,
            allowsMultipleSelection: true, selectionLimit: remaining,
            preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
          });
          if (!result.canceled) {
            setImageUris(prev => [...prev, ...result.assets.map(a => a.uri)].slice(0, MAX_PHOTOS));
          }
        },
      },
      { text: 'Annuler', style: 'cancel' },
    ]);
  }

  function onLieuSearchChange(q: string) {
    setLieuSearch(q);
    setLieuSearched(false);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.length < 2) { setLieuResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      const { data } = await supabase
        .from('lieux').select('id, nom, cat, ville').eq('actif', true).ilike('nom', `%${q}%`).limit(5);
      setLieuResults(data || []);
      setLieuSearched(true);
    }, 300);
  }

  async function publish() {
    if (!imageUris.length) return;
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const uri of imageUris) {
        const ext = uri.split('.').pop()?.toLowerCase() || 'jpg';
        const r2Key = `lieu-photos/community/${myUserId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        urls.push(await uploadToR2(uri, r2Key));
      }
      const { data: newPost, error: dbErr } = await supabase.from('community_posts').insert({
        user_id: myUserId,
        image_url: urls[0],
        images: urls.length > 1 ? urls : null,
        caption: caption.trim() || null,
        lieu_id: selectedLieu?.id || null,
        auto_generated: false,
      }).select('id').single();
      if (dbErr) throw new Error(dbErr.message);
      supabase.from('profils').select('points').eq('id', myUserId).single().then(({ data }) => {
        if (data) supabase.from('profils').update({ points: (data.points || 0) + 2 }).eq('id', myUserId);
      });
      if (newPost?.id) notifyFollowersNewPost(myUserId, newPost.id);
      reset();
      onClose();
      onPosted();
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Impossible de publier.');
      setUploading(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => { reset(); onClose(); }}
    >
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.newPostModal}
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.newPostHeader}>
            <TouchableOpacity onPress={() => { reset(); onClose(); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={24} color={colors.bordeaux} />
            </TouchableOpacity>
            <Text style={styles.newPostTitle}>Nouveau post</Text>
            <TouchableOpacity
              style={[styles.publishBtn, (!imageUris.length || uploading) && styles.publishBtnDisabled]}
              onPress={publish}
              disabled={!imageUris.length || uploading}
            >
              {uploading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.publishBtnText}>Publier</Text>
              )}
            </TouchableOpacity>
          </View>

          {imageUris.length === 0 ? (
            <TouchableOpacity style={styles.imagePicker} onPress={pickImage} activeOpacity={0.8}>
              <View style={styles.imagePickerEmpty}>
                <Ionicons name="camera-outline" size={40} color={colors.textMuted} />
                <Text style={styles.imagePickerHint}>Appuyer pour ajouter des photos (5 max)</Text>
              </View>
            </TouchableOpacity>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.imageThumbsRow}>
              {imageUris.map((uri, idx) => (
                <View key={idx} style={styles.imageThumb}>
                  <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  <TouchableOpacity style={styles.imageThumbRemove} onPress={() => setImageUris(prev => prev.filter((_, i) => i !== idx))}>
                    <Ionicons name="close-circle" size={20} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
              {imageUris.length < MAX_PHOTOS && (
                <TouchableOpacity style={[styles.imageThumb, styles.imageThumbAdd]} onPress={pickImage}>
                  <Ionicons name="add" size={26} color={colors.bordeaux} />
                  <Text style={styles.imagePickerHint}>{imageUris.length}/{MAX_PHOTOS}</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          )}

          <View style={styles.newPostSection}>
            <TextInput
              style={styles.captionInput}
              placeholder="Ajouter une légende (optionnel)…"
              placeholderTextColor={colors.textMuted}
              value={caption}
              onChangeText={setCaption}
              multiline
              maxLength={500}
            />
          </View>

          <View style={styles.newPostSection}>
            <View style={styles.lieuSearchRow}>
              <Ionicons name="location-outline" size={16} color={colors.terra} />
              {selectedLieu ? (
                <View style={styles.selectedLieuChip}>
                  <Text style={styles.selectedLieuText} numberOfLines={1}>
                    {selectedLieu.nom}, {selectedLieu.ville}
                  </Text>
                  <TouchableOpacity
                    onPress={() => { setSelectedLieu(null); setLieuSearch(''); }}
                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  >
                    <Ionicons name="close-circle" size={16} color={colors.terra} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TextInput
                  style={styles.lieuSearchInput}
                  placeholder="Taguer un lieu (optionnel)…"
                  placeholderTextColor={colors.textMuted}
                  value={lieuSearch}
                  onChangeText={onLieuSearchChange}
                />
              )}
            </View>
            {!selectedLieu && lieuResults.length > 0 && (
              <View style={styles.lieuResultsList}>
                {lieuResults.map(l => (
                  <TouchableOpacity
                    key={l.id}
                    style={styles.lieuResultRow}
                    onPress={() => {
                      setSelectedLieu(l);
                      setLieuSearch('');
                      setLieuResults([]);
                      setLieuSearched(false);
                      Keyboard.dismiss();
                    }}
                  >
                    <Text style={styles.lieuResultName}>{l.nom}</Text>
                    <Text style={styles.lieuResultVille}>{l.ville}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {!selectedLieu && lieuSearched && lieuResults.length === 0 && lieuSearch.length >= 2 && (
              <TouchableOpacity
                style={styles.lieuSuggestRow}
                onPress={() => {
                  mapNavigation.setPendingPropose(lieuSearch);
                  reset();
                  onClose();
                  navigation.navigate('Carte');
                }}
              >
                <Ionicons name="add-circle-outline" size={16} color={colors.terra} />
                <Text style={styles.lieuSuggestText}>
                  « {lieuSearch} » n'est pas encore sur la carte —{' '}
                  <Text style={{ fontFamily: 'DMSans_600SemiBold' }}>Suggérer ce lieu</Text>
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── FeedScreen ───────────────────────────────────────────────────────────────

export default function FeedScreen() {
  const navigation = useNavigation<any>();
  const { session, loading: sessionLoading } = useSession();
  const [tab, setTab] = useState<'feed' | 'messages' | 'membres'>('feed');
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [pendingConvId, setPendingConvId] = useState<string | null>(null);

  const [pendingPostId, setPendingPostId] = useState<string | null>(null);

  // Notification "message" tapee : bascule sur l'onglet Chat et ouvre la conversation
  // Notification "photo_like" tapee : bascule sur l'onglet Feed et ouvre la photo/le post
  useFocusEffect(useCallback(() => {
    const cid = mapNavigation.consumeConversation();
    supabase.from('push_debug_logs').insert({
      to_token: 'FEED_FOCUS', title: 'FeedScreen useFocusEffect',
      detail: JSON.stringify({ consumedConversationId: cid }),
    }).then(() => {}, () => {});
    if (cid) { setTab('messages'); setPendingConvId(cid); }
    const pid = mapNavigation.consumePost();
    if (pid) { setTab('feed'); setPendingPostId(pid); }
  }, []));

  // Feed
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedRefreshing, setFeedRefreshing] = useState(false);
  const [commentPost, setCommentPost] = useState<CommunityPost | null>(null);

  // Ouvre le post une fois le feed charge
  useEffect(() => {
    if (!pendingPostId || !posts.length) return;
    const found = posts.find(p => p.id === pendingPostId);
    if (found) { setCommentPost(found); setPendingPostId(null); }
  }, [pendingPostId, posts]);
  const [newPostVisible, setNewPostVisible] = useState(false);

  // Membres
  const [membres, setMembres] = useState<MembreItem[]>([]);
  const [membresLoading, setMembresLoading] = useState(false);
  const [membresRefreshing, setMembresRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState<string | null>(null);
  const [regionPickerVisible, setRegionPickerVisible] = useState(false);
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [mutuals, setMutuals] = useState<Record<string, number>>({});

  // Suggestions d'amis (façon "Suggestions pour toi" Instagram)
  const [suggestions, setSuggestions] = useState<MembreItem[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [dismissedSuggestionIds, setDismissedSuggestionIds] = useState<Set<string>>(new Set());
  const [suggestionsCollapsed, setSuggestionsCollapsed] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('suggestions_collapsed').then(v => { if (v === '1') setSuggestionsCollapsed(true); });
  }, []);

  function toggleSuggestionsCollapsed() {
    setSuggestionsCollapsed(prev => {
      const next = !prev;
      AsyncStorage.setItem('suggestions_collapsed', next ? '1' : '0').catch(() => {});
      return next;
    });
  }

  // Amis trouves via les contacts du telephone
  const [contactMatches, setContactMatches] = useState<MembreItem[]>([]);
  const [contactMatchesLoading, setContactMatchesLoading] = useState(false);
  const [contactMatchesModalVisible, setContactMatchesModalVisible] = useState(false);
  const [contactMatchesSearched, setContactMatchesSearched] = useState(false);
  const [inviteCandidates, setInviteCandidates] = useState<{ name: string; phone: string }[]>([]);
  const [inviteSearch, setInviteSearch] = useState('');

  useEffect(() => {
    if (session?.user?.id) setMyUserId(session.user.id);
  }, [session?.user?.id]);

  useEffect(() => {
    if (tab === 'feed') { loadFeed(); loadSuggestions(); }
    else if (tab === 'membres') loadMembres();
  }, [tab, session?.user?.id]);

  // ── Suggestions d'amis ──

  async function loadSuggestions() {
    const myId = session?.user?.id;
    if (!myId) return;
    setSuggestionsLoading(true);
    const [{ data: myProfil }, { data: myFollowsData }] = await Promise.all([
      supabase.from('profils').select('ville').eq('id', myId).maybeSingle(),
      supabase.from('follows').select('following_id').eq('follower_id', myId).eq('statut', 'accepte'),
    ]);
    const myVille = (myProfil?.ville || '').toLowerCase().trim();
    const myFollowingSet = new Set((myFollowsData || []).map((f: any) => f.following_id));

    const { data: candidates } = await supabase
      .from('profils').select('id,prenom,avatar_url,ville,nom_chien,ambassadeur')
      .neq('id', myId).range(0, 300);
    const pool = (candidates || []).filter((c: any) => !myFollowingSet.has(c.id));
    if (!pool.length) { setSuggestions([]); setSuggestionsLoading(false); return; }

    const poolIds = pool.map((c: any) => c.id);
    const { data: poolFollowsData } = await supabase.from('follows')
      .select('follower_id,following_id').in('follower_id', poolIds).eq('statut', 'accepte');
    const mutualMap: Record<string, number> = {};
    (poolFollowsData || []).forEach((f: any) => {
      if (myFollowingSet.has(f.following_id)) mutualMap[f.follower_id] = (mutualMap[f.follower_id] || 0) + 1;
    });

    const ranked = pool
      .map((c: any) => ({
        c,
        score: (mutualMap[c.id] || 0) * 10 + ((c.ville || '').toLowerCase().trim() === myVille && myVille ? 1 : 0),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 15)
      .map(({ c }) => ({
        id: c.id,
        user: { id: c.id, prenom: c.prenom || 'Membre', avatar_url: c.avatar_url, ambassadeur: c.ambassadeur || null, explorateur: false },
        ville: c.ville || null,
        nomChien: c.nom_chien || null,
      }));

    setMutuals(prev => ({ ...prev, ...mutualMap }));
    setSuggestions(ranked);
    setSuggestionsLoading(false);
  }

  function dismissSuggestion(id: string) {
    setDismissedSuggestionIds(prev => new Set([...prev, id]));
  }

  const visibleSuggestions = suggestions.filter(s => !dismissedSuggestionIds.has(s.id) && !following.has(s.id));

  // ── Amis via les contacts du téléphone ──

  async function findFriendsFromContacts() {
    const dbg = (title: string, detail: any) => {
      supabase.from('push_debug_logs').insert({
        to_token: 'CONTACTS_DEBUG', title, detail: typeof detail === 'string' ? detail : JSON.stringify(detail),
      }).then(() => {}, () => {});
    };
    dbg('start', { at: new Date().toISOString() });
    const { status } = await Contacts.requestPermissionsAsync();
    dbg('permission', { status });
    if (status !== 'granted') {
      Alert.alert('Permission requise', "Autorise l'accès à tes contacts dans les réglages pour retrouver tes amis.");
      return;
    }
    setContactMatchesLoading(true);
    try {
      const t0 = Date.now();
      const { data: contactsData } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers] });
      dbg('contacts_fetched', { count: contactsData.length, ms: Date.now() - t0 });
      const phones = new Set<string>();
      const phoneToContact = new Map<string, { name: string; phone: string }>();
      const t1 = Date.now();
      for (const c of contactsData) {
        for (const p of c.phoneNumbers || []) {
          const n = p.number ? normalizePhone(p.number) : null;
          if (!n) continue;
          phones.add(n);
          if (!phoneToContact.has(n)) {
            phoneToContact.set(n, { name: c.name || 'Contact', phone: p.number! });
          }
        }
      }
      dbg('contacts_processed', { uniquePhones: phones.size, ms: Date.now() - t1 });
      if (!phones.size) {
        setContactMatches([]);
        setInviteCandidates([]);
        setContactMatchesSearched(true);
        setContactMatchesModalVisible(true);
        return;
      }
      const t2 = Date.now();
      const { data, error } = await supabase.functions.invoke('match-contacts', {
        body: { phones: Array.from(phones) },
      });
      dbg('match_contacts_response', { ms: Date.now() - t2, error: error?.message, matches: data?.matches?.length, matchedPhones: data?.matchedPhones?.length });
      if (error) throw error;
      const matches: MembreItem[] = (data?.matches || []).map((m: any) => ({
        id: m.id,
        user: { id: m.id, prenom: m.prenom || 'Membre', avatar_url: m.avatar_url, ambassadeur: null, explorateur: false },
        ville: m.ville || null,
        nomChien: null,
      }));
      const matchedPhones = new Set<string>(data?.matchedPhones || []);
      const invites = Array.from(phoneToContact.entries())
        .filter(([norm]) => !matchedPhones.has(norm))
        .map(([, c]) => c)
        .sort((a, b) => {
          // Pas de localeCompare : autre methode dependante des donnees ICU
          // absentes de ce build Hermes, meme categorie de plantage que normalize().
          const an = a.name.toLowerCase(), bn = b.name.toLowerCase();
          return an < bn ? -1 : an > bn ? 1 : 0;
        });
      dbg('done', { matches: matches.length, invites: invites.length });
      setContactMatches(matches);
      setInviteCandidates(invites);
      setInviteSearch('');
      setContactMatchesSearched(true);
      setContactMatchesModalVisible(true);
    } catch (e: any) {
      dbg('caught_error', { message: e?.message, stack: String(e?.stack).slice(0, 500) });
      Alert.alert('Erreur', e.message || "Impossible de retrouver tes contacts pour le moment.");
    } finally {
      setContactMatchesLoading(false);
    }
  }

  const visibleContactMatches = contactMatches.filter(m => !following.has(m.id));
  // Cherche sur l'ensemble des contacts, mais n'affiche qu'un lot raisonnable par defaut
  // (rendu ScrollView non-virtualise) — le champ de recherche donne acces au reste sans
  // avoir a tout afficher d'un coup, ce qui rendait l'ouverture du modal lente sur les
  // gros carnets de contacts.
  const filteredInviteCandidates = useMemo(() => (
    inviteSearch.length === 0
      ? inviteCandidates
      : inviteCandidates.filter(c => normalizeText(c.name).includes(normalizeText(inviteSearch)))
  ), [inviteCandidates, inviteSearch]);
  const INVITE_DISPLAY_LIMIT = 150;
  const displayedInviteCandidates = inviteSearch.length === 0
    ? filteredInviteCandidates.slice(0, INVITE_DISPLAY_LIMIT)
    : filteredInviteCandidates;

  async function inviteContact(contact: { name: string; phone: string }) {
    const message = "Salut ! Je t'invite à rejoindre The Pack Club 🐾 la carte et la communauté des amoureux de chiens. Télécharge l'appli ici : https://thepackclub.fr";
    const digits = contact.phone.replace(/[^\d+]/g, '');
    const smsUrl = `sms:${digits}${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(message)}`;
    try {
      const can = await Linking.canOpenURL(smsUrl);
      if (can) { await Linking.openURL(smsUrl); return; }
    } catch {}
    try {
      await Share.share({ message: `${message}` });
    } catch {}
  }

  // ── Feed ──

  async function loadFeed() {
    setFeedLoading(true);

    const myId = session?.user?.id || null;
    const COMMUNITY_POST_FIELDS = 'id, type, image_url, images, caption, lieu_id, auto_generated, created_at, user_id, visibilite, balade_id, balades (distance_km, duree_secondes), community_post_likes (user_id), community_post_comments (id)';

    const [communityPhotoRes, communityLieuRes, restrictedBaladeRes, followingRes, photosRes] = await Promise.all([
      supabase
        .from('community_posts')
        .select(COMMUNITY_POST_FIELDS)
        .eq('hidden', false)
        .neq('type', 'nouveau_lieu')
        .or('type.neq.balade,visibilite.eq.public')
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('community_posts')
        .select(COMMUNITY_POST_FIELDS)
        .eq('hidden', false)
        .eq('type', 'nouveau_lieu')
        .order('created_at', { ascending: false })
        .limit(20),
      myId
        ? supabase
            .from('community_posts')
            .select(COMMUNITY_POST_FIELDS)
            .eq('hidden', false)
            .eq('type', 'balade')
            .neq('visibilite', 'public')
            .order('created_at', { ascending: false })
            .limit(30)
        : Promise.resolve({ data: [] as any[] }),
      myId
        ? supabase.from('follows').select('following_id').eq('follower_id', myId).eq('statut', 'accepte')
        : Promise.resolve({ data: [] as any[] }),
      supabase
        .from('photos')
        .select('id, url, created_at, lieu_id, user_id, nom_chien, group_id')
        .eq('validee', true)
        .not('lieu_id', 'is', null)
        .not('url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(30),
    ]);

    if (communityPhotoRes.error && communityLieuRes.error && photosRes.error) { setFeedLoading(false); return; }

    const followingIds = new Set(((followingRes as any).data || []).map((f: any) => f.following_id));
    const visibleRestrictedBalades = ((restrictedBaladeRes as any).data || []).filter((p: any) =>
      p.user_id === myId || followingIds.has(p.user_id)
    );

    const communityData: any[] = [...(communityPhotoRes.data || []), ...(communityLieuRes.data || []), ...visibleRestrictedBalades];
    const photosData: any[] = (photosRes.data || []).filter((p: any) =>
      !communityData.some((cp: any) => cp.image_url === p.url)
    );

    const allUserIds = [...new Set([
      ...communityData.map((p: any) => p.user_id),
      ...photosData.map((p: any) => p.user_id),
    ])] as string[];
    const allLieuIds = [...new Set([
      ...communityData.filter((p: any) => p.lieu_id).map((p: any) => p.lieu_id),
      ...photosData.map((p: any) => p.lieu_id),
    ])] as string[];

    const [profilesRes, lieuxRes] = await Promise.all([
      allUserIds.length > 0
        ? supabase.from('profils').select('id, prenom, avatar_url, ambassadeur').in('id', allUserIds)
        : Promise.resolve({ data: [] as any[] }),
      allLieuIds.length > 0
        ? supabase.from('lieux').select('id, nom, cat, ville').in('id', allLieuIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const profileMap = Object.fromEntries((profilesRes.data || []).map((p: any) => [p.id, p]));
    const lieuMap = Object.fromEntries((lieuxRes.data || []).map((l: any) => [l.id, l]));

    const communityPosts: CommunityPost[] = communityData.map((p: any) => ({
      ...p,
      profils: profileMap[p.user_id] || null,
      lieux: p.lieu_id ? (lieuMap[p.lieu_id] || null) : null,
    }));

    const realPhotoIds = photosData.map((p: any) => p.id);
    let photoLikesMap: Record<string, { user_id: string }[]> = {};
    let photoCommentsCountMap: Record<string, number> = {};
    if (realPhotoIds.length > 0) {
      try {
        const [{ data: allPhotoLikes }, { data: allPhotoComments }] = await Promise.all([
          supabase.from('photo_likes').select('photo_id, user_id').in('photo_id', realPhotoIds),
          supabase.from('photo_comments').select('photo_id').in('photo_id', realPhotoIds),
        ]);
        (allPhotoLikes || []).forEach((l: any) => {
          if (!photoLikesMap[l.photo_id]) photoLikesMap[l.photo_id] = [];
          photoLikesMap[l.photo_id].push({ user_id: l.user_id });
        });
        (allPhotoComments || []).forEach((c: any) => {
          photoCommentsCountMap[c.photo_id] = (photoCommentsCountMap[c.photo_id] || 0) + 1;
        });
      } catch (_) {}
    }

    // Grouper les photos par group_id (upload multiple = carrousel)
    const photoGroups = new Map<string, any[]>();
    photosData.forEach((p: any) => {
      const key = p.group_id || `solo-${p.id}`;
      if (!photoGroups.has(key)) photoGroups.set(key, []);
      photoGroups.get(key)!.push(p);
    });

    const mapPosts: CommunityPost[] = Array.from(photoGroups.values()).map(group => {
      const first = group[0];
      const allUrls = group.map((p: any) => p.url);
      return {
        id: `map-${first.id}`,
        user_id: first.user_id,
        image_url: first.url,
        images: allUrls,
        caption: null,
        lieu_id: first.lieu_id,
        auto_generated: false,
        created_at: first.created_at,
        profils: profileMap[first.user_id] || null,
        lieux: lieuMap[first.lieu_id] || null,
        community_post_likes: photoLikesMap[first.id] || [],
        community_post_comments: Array.from({ length: photoCommentsCountMap[first.id] || 0 }, (_, i) => ({ id: String(i) })),
        fromMap: true,
        nom_chien: first.nom_chien || null,
        realPhotoId: first.id,
        photoGroupIds: group.map((p: any) => p.id),
      };
    });

    const merged = [...communityPosts, ...mapPosts].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    setPosts(merged);
    setFeedLoading(false);
  }

  async function notifyPhotoLike(ownerId: string, postId: string) {
    if (!myUserId || ownerId === myUserId) return;
    const [{ data: owner }, { data: me }] = await Promise.all([
      supabase.from('profils').select('push_token,notif_photo_like').eq('id', ownerId).single(),
      supabase.from('profils').select('prenom').eq('id', myUserId).single(),
    ]);
    if (!owner?.push_token || owner.notif_photo_like === false) return;
    sendPushNotification(owner.push_token, 'Nouveau like', `${me?.prenom || 'Quelqu\'un'} a aimé une de tes photos`, { type: 'photo_like', postId });
  }

  function toggleLike(postId: string) {
    if (!myUserId) {
      Alert.alert('Connexion requise', 'Connecte-toi pour liker une photo.');
      return;
    }
    const post = posts.find(p => p.id === postId);
    if (!post) return;
    const liked = post.community_post_likes.some(l => l.user_id === myUserId);
    setPosts(prev => prev.map(p => {
      if (p.id !== postId) return p;
      const newLikes = liked
        ? p.community_post_likes.filter(l => l.user_id !== myUserId)
        : [...p.community_post_likes, { user_id: myUserId! }];
      return { ...p, community_post_likes: newLikes };
    }));
    if (post.fromMap && post.realPhotoId) {
      const photoId = post.realPhotoId;
      if (liked) {
        supabase.from('photo_likes').delete()
          .eq('photo_id', photoId).eq('user_id', myUserId).then(() => {});
      } else {
        supabase.from('photo_likes').insert({ photo_id: photoId, user_id: myUserId }).then(() => {});
        notifyPhotoLike(post.user_id, post.id);
      }
    } else {
      if (liked) {
        supabase.from('community_post_likes').delete()
          .eq('post_id', postId).eq('user_id', myUserId).then(() => {});
      } else {
        supabase.from('community_post_likes').insert({ post_id: postId, user_id: myUserId }).then(() => {});
        notifyPhotoLike(post.user_id, post.id);
      }
    }
  }

  function deletePost(post: CommunityPost) {
    if (!myUserId || post.user_id !== myUserId) return;
    Alert.alert(
      'Supprimer cette publication ?',
      'Cette action est définitive.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer', style: 'destructive',
          onPress: async () => {
            try {
              if (post.fromMap) {
                const ids = post.photoGroupIds?.length ? post.photoGroupIds : (post.realPhotoId ? [post.realPhotoId] : []);
                if (ids.length) await supabase.from('photos').delete().in('id', ids);
              } else {
                await supabase.from('community_posts').delete().eq('id', post.id);
                if (post.balade_id) await supabase.from('balades').delete().eq('id', post.balade_id);
              }
              setPosts(prev => prev.filter(p => p.id !== post.id));
            } catch (e: any) {
              Alert.alert('Erreur', e.message || "Impossible de supprimer cette publication pour le moment.");
            }
          },
        },
      ],
    );
  }

  function openLieu(lieuId: string) {
    mapNavigation.setPendingLieu(lieuId);
    navigation.navigate('Carte' as any);
  }

  async function openBalade(post: CommunityPost) {
    if (post.balade_id) {
      mapNavigation.setPendingBalade(post.balade_id);
      navigation.navigate('Carte' as any);
      return;
    }
    // Anciens posts publiés avant l'ajout de balade_id : repli sur un matching approximatif
    const nom = (post.caption || '').split(' · ')[0].trim();
    if (!nom || !post.user_id) return;
    const { data } = await supabase
      .from('balades')
      .select('id')
      .eq('user_id', post.user_id)
      .ilike('nom', nom)
      .limit(1);
    const baladeId = Array.isArray(data) ? data[0]?.id : null;
    if (baladeId) {
      mapNavigation.setPendingBalade(baladeId);
      navigation.navigate('Carte' as any);
    }
  }

  // ── Membres ──

  async function loadMembres() {
    setMembresLoading(true);
    const { data: { session: s } } = await supabase.auth.getSession();
    if (!s) { setMembresLoading(false); return; }
    const myId = s.user.id;
    setMyUserId(myId);

    const [{ data: membresData }, { data: myFollowsData }, { data: explorateurRows }] = await Promise.all([
      supabase.from('profils').select('id,prenom,avatar_url,ville,nom_chien,ambassadeur').neq('id', myId).range(0, 999),
      supabase.from('follows').select('following_id').eq('follower_id', myId).eq('statut', 'accepte'),
      supabase.from('explorateurs').select('user_id').eq('statut', 'actif').not('user_id', 'is', null),
    ]);
    const expIds = new Set((explorateurRows || []).map((e: any) => e.user_id));
    if (!membresData?.length) { setMembres([]); setMembresLoading(false); return; }

    const myFollowingSet = new Set((myFollowsData || []).map((f: any) => f.following_id));
    const memberIds = membresData.map((m: any) => m.id);
    const { data: memberFollowsData } = await supabase.from('follows')
      .select('follower_id,following_id').in('follower_id', memberIds).eq('statut', 'accepte');

    const mutualMap: Record<string, number> = {};
    (memberFollowsData || []).forEach((f: any) => {
      if (myFollowingSet.has(f.following_id)) mutualMap[f.follower_id] = (mutualMap[f.follower_id] || 0) + 1;
    });

    setFollowing(new Set(memberIds.filter((id: string) => myFollowingSet.has(id))));
    setMutuals(mutualMap);
    setMembres(membresData.map((p: any) => ({
      id: p.id,
      user: { id: p.id, prenom: p.prenom || 'Membre', avatar_url: p.avatar_url, ambassadeur: p.ambassadeur || null, explorateur: expIds.has(p.id) },
      ville: p.ville || null,
      nomChien: p.nom_chien || null,
    })));
    setMembresLoading(false);
  }

  async function toggleFollow(memberId: string) {
    if (!myUserId) return;
    if (following.has(memberId)) {
      await supabase.from('follows').delete().eq('follower_id', myUserId).eq('following_id', memberId);
      setFollowing(prev => { const s = new Set(prev); s.delete(memberId); return s; });
    } else {
      await supabase.from('follows').insert({ follower_id: myUserId, following_id: memberId, statut: 'accepte' });
      setFollowing(prev => new Set([...prev, memberId]));
    }
  }

  // Memoise : le calcul de region par membre (accents geres a la main, cf. villeRegion.ts)
  // ne doit tourner qu'a chaque changement reel de donnees, pas a chaque frappe clavier —
  // sinon l'input de recherche devient perceptiblement lent (re-render sur chaque touche).
  const membreRegions = useMemo(() => {
    const map = new Map<string, string>();
    membres.forEach(m => map.set(m.id, getRegion(m.ville)));
    return map;
  }, [membres]);

  const regionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    membreRegions.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
    return counts;
  }, [membreRegions]);

  const filteredMembres = useMemo(() => membres
    .filter(m => {
      if (search.length === 0) return true;
      const q = search.toLowerCase();
      return (
        (m.user.prenom || '').toLowerCase().includes(q) ||
        (m.nomChien || '').toLowerCase().includes(q) ||
        (m.ville || '').toLowerCase().includes(q)
      );
    })
    .filter(m => !regionFilter || membreRegions.get(m.id) === regionFilter),
    [membres, search, regionFilter, membreRegions]);

  // ── Render ──

  if (sessionLoading) return <ActivityIndicator style={{ flex: 1 }} color={colors.terra} />;
  if (!session) return (
    <AuthGate navigation={navigation} message="Connecte-toi pour rejoindre la meute, chatter et découvrir d'autres membres." />
  );

  return (
    <View style={styles.container}>
      {/* Tab bar */}
      <View style={styles.tabsWrap}>
        {([
          { key: 'feed',     label: 'Feed' },
          { key: 'messages', label: 'Chat' },
          { key: 'membres',  label: 'Membres' },
        ] as const).map(t => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => setTab(t.key)}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Chat */}
      {tab === 'messages' ? (
        <MessagerieScreen
          pendingConversationId={pendingConvId}
          onConsumedPendingConversation={() => setPendingConvId(null)}
        />

      /* Feed */
      ) : tab === 'feed' ? (
        <>
          {feedLoading ? (
            <ActivityIndicator style={{ flex: 1 }} color={colors.terra} />
          ) : (
            <FlatList
              data={posts}
              keyExtractor={p => p.id}
              contentContainerStyle={styles.feedList}
              refreshControl={
                <RefreshControl
                  refreshing={feedRefreshing}
                  onRefresh={async () => { setFeedRefreshing(true); await loadFeed(); setFeedRefreshing(false); }}
                  tintColor={colors.terra}
                />
              }
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyIcon}>📸</Text>
                  <Text style={styles.emptyText}>Aucune photo pour l'instant.</Text>
                  <Text style={styles.emptySubText}>Sois le premier à partager un moment avec la meute !</Text>
                </View>
              }
              ListHeaderComponent={
                visibleSuggestions.length > 0 ? (
                  <View style={styles.suggestWrap}>
                    <TouchableOpacity style={styles.suggestTitleRow} onPress={toggleSuggestionsCollapsed} activeOpacity={0.7}>
                      <Text style={styles.suggestTitle}>Suggestions pour toi</Text>
                      <Ionicons name={suggestionsCollapsed ? 'chevron-down' : 'chevron-up'} size={16} color={colors.textMuted} />
                    </TouchableOpacity>
                    {suggestionsCollapsed ? null : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.suggestScroll}>
                      {visibleSuggestions.map(s => (
                        <View key={s.id} style={styles.suggestCard}>
                          <TouchableOpacity
                            style={styles.suggestDismiss}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            onPress={() => dismissSuggestion(s.id)}
                          >
                            <Ionicons name="close" size={13} color={colors.textMuted} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            activeOpacity={0.85}
                            onPress={() => navigation.navigate('ProfilPublic', {
                              userId: s.user.id, prenom: s.user.prenom, avatarUrl: s.user.avatar_url,
                            })}
                          >
                            {s.user.avatar_url ? (
                              <Image source={{ uri: s.user.avatar_url }} style={styles.suggestAvatar} />
                            ) : (
                              <View style={styles.suggestAvatarFallback}>
                                <Text style={styles.suggestAvatarLetter}>{(s.user.prenom || '?')[0].toUpperCase()}</Text>
                              </View>
                            )}
                            <Text style={styles.suggestName} numberOfLines={1}>{s.user.prenom}</Text>
                            <Text style={styles.suggestSub} numberOfLines={1}>
                              {(mutuals[s.id] || 0) > 0
                                ? `${mutuals[s.id]} ami${mutuals[s.id] > 1 ? 's' : ''} en commun`
                                : (s.ville || (s.nomChien ? `🐾 ${s.nomChien}` : ' '))}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.suggestFollowBtn} onPress={() => toggleFollow(s.id)}>
                            <Text style={styles.suggestFollowBtnText}>Suivre</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </ScrollView>
                    )}
                  </View>
                ) : null
              }
              renderItem={({ item }) =>
                item.type === 'nouveau_lieu' ? (
                  <NouveauLieuCard post={item} onLieuPress={openLieu} />
                ) : item.type === 'balade' ? (
                  <BaladeCard
                    post={item}
                    myUserId={myUserId || ''}
                    onLike={toggleLike}
                    onCommentPress={setCommentPost}
                    onBaladePress={openBalade}
                    onDeletePress={deletePost}
                  />
                ) : (
                  <PostCard
                    post={item}
                    myUserId={myUserId || ''}
                    onLike={toggleLike}
                    onCommentPress={setCommentPost}
                    onLieuPress={openLieu}
                    onDeletePress={deletePost}
                  />
                )
              }
            />
          )}

          <TouchableOpacity style={styles.fab} onPress={() => setNewPostVisible(true)} activeOpacity={0.85}>
            <Ionicons name="camera" size={22} color="#fff" />
          </TouchableOpacity>
        </>

      /* Membres */
      ) : membresLoading ? (
        <ActivityIndicator style={{ flex: 1 }} color={colors.terra} />
      ) : (
        <FlatList
          data={filteredMembres}
          keyExtractor={m => m.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={membresRefreshing}
              onRefresh={async () => { setMembresRefreshing(true); await loadMembres(); setMembresRefreshing(false); }}
              tintColor={colors.terra}
            />
          }
          ListHeaderComponent={
            <>
              <View style={styles.searchBar}>
                <Ionicons name="search" size={15} color={colors.textMuted} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Rechercher un membre…"
                  placeholderTextColor={colors.textMuted}
                  value={search}
                  onChangeText={setSearch}
                />
                {search.length > 0 && (
                  <TouchableOpacity onPress={() => setSearch('')}>
                    <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity style={styles.regionFilterBtn} onPress={() => setRegionPickerVisible(true)}>
                <Ionicons name="location-outline" size={14} color={colors.terra} />
                <Text style={styles.regionFilterBtnText}>{regionFilter || 'Toutes les régions'}</Text>
                <Ionicons name="chevron-down" size={14} color={colors.terra} />
                {regionFilter && (
                  <TouchableOpacity onPress={() => setRegionFilter(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close-circle" size={15} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.findContactsBtn} onPress={findFriendsFromContacts} disabled={contactMatchesLoading}>
                {contactMatchesLoading ? (
                  <ActivityIndicator size="small" color={colors.terra} />
                ) : (
                  <Ionicons name="people-outline" size={16} color={colors.terra} />
                )}
                <Text style={styles.findContactsBtnText}>Trouver des amis via mes contacts</Text>
              </TouchableOpacity>
            </>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🐾</Text>
              <Text style={styles.emptyText}>Aucun membre pour l'instant.</Text>
            </View>
          }
          renderItem={({ item: m }) => (
            <TouchableOpacity
              style={styles.card}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('ProfilPublic', {
                userId: m.user.id, prenom: m.user.prenom, avatarUrl: m.user.avatar_url,
              })}
            >
              {m.user.avatar_url ? (
                <Image source={{ uri: m.user.avatar_url }} style={styles.avatarImg} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarLetter}>{(m.user.prenom || '?')[0].toUpperCase()}</Text>
                </View>
              )}
              <View style={styles.body}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={styles.memberName}>{m.user.prenom}</Text>
                  {m.user.ambassadeur ? <AmbassadeurBadge /> : null}
                  {m.user.explorateur ? <ExplorateurBadge /> : null}
                </View>
                {m.ville ? <Text style={styles.ville}>{m.ville}</Text> : null}
                {m.nomChien ? <Text style={styles.dogInfo}>🐾 {m.nomChien}</Text> : null}
                {(mutuals[m.user.id] || 0) > 0 && (
                  <View style={styles.mutualRow}>
                    <Ionicons name="people-outline" size={12} color={colors.terra} />
                    <Text style={styles.mutualText}>
                      {mutuals[m.user.id]} ami{mutuals[m.user.id] > 1 ? 's' : ''} en commun
                    </Text>
                  </View>
                )}
              </View>
              <TouchableOpacity
                style={[styles.followBtn, following.has(m.user.id) && styles.followBtnActive]}
                onPress={e => { e.stopPropagation?.(); toggleFollow(m.user.id); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.followBtnText, following.has(m.user.id) && styles.followBtnTextActive]}>
                  {following.has(m.user.id) ? 'Suivi ✓' : 'Suivre'}
                </Text>
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />
      )}

      {/* Modals */}
      {myUserId && (
        <>
          <NewPostModal
            visible={newPostVisible}
            onClose={() => setNewPostVisible(false)}
            myUserId={myUserId}
            onPosted={() => { setTab('feed'); loadFeed(); }}
            navigation={navigation}
          />
          <CommentsModal
            post={commentPost}
            visible={!!commentPost}
            onClose={() => setCommentPost(null)}
            myUserId={myUserId}
          />
        </>
      )}

      {/* Amis trouvés via les contacts */}
      <Modal visible={contactMatchesModalVisible} animationType="slide" transparent onRequestClose={() => setContactMatchesModalVisible(false)}>
        <View style={styles.contactModalOverlay}>
          <View style={styles.contactModalCard}>
            <View style={styles.contactModalHeader}>
              <Text style={styles.contactModalTitle}>Amis dans tes contacts</Text>
              <TouchableOpacity onPress={() => setContactMatchesModalVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ErrorBoundary label="contacts_modal" onClose={() => setContactMatchesModalVisible(false)}>
            {contactMatchesSearched && visibleContactMatches.length === 0 && inviteCandidates.length === 0 ? (
              <View style={{ paddingVertical: 30, alignItems: 'center' }}>
                <Text style={styles.emptyIcon}>🐾</Text>
                <Text style={styles.emptyText}>Aucun de tes contacts n'est encore sur The Pack.</Text>
                <Text style={styles.emptySubText}>Reviens quand tu leur auras montré l'app !</Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
                {visibleContactMatches.map(m => (
                  <View key={m.id} style={styles.suggestRow}>
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}
                      onPress={() => {
                        setContactMatchesModalVisible(false);
                        navigation.navigate('ProfilPublic', { userId: m.user.id, prenom: m.user.prenom, avatarUrl: m.user.avatar_url });
                      }}
                    >
                      {m.user.avatar_url ? (
                        <Image source={{ uri: m.user.avatar_url }} style={styles.suggestAvatar} />
                      ) : (
                        <View style={styles.suggestAvatarFallback}>
                          <Text style={styles.suggestAvatarLetter}>{(m.user.prenom || '?')[0].toUpperCase()}</Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.suggestRowName}>{m.user.prenom}</Text>
                        {m.ville ? <Text style={styles.suggestRowSub}>{m.ville}</Text> : null}
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.suggestFollowBtn} onPress={() => toggleFollow(m.id)}>
                      <Text style={styles.suggestFollowBtnText}>Suivre</Text>
                    </TouchableOpacity>
                  </View>
                ))}

                {inviteCandidates.length > 0 && (
                  <>
                    <Text style={styles.inviteSectionTitle}>
                      Pas encore sur l'app ({inviteCandidates.length})
                    </Text>
                    <View style={styles.inviteSearchBar}>
                      <Ionicons name="search" size={14} color={colors.textMuted} />
                      <TextInput
                        style={styles.inviteSearchInput}
                        placeholder="Chercher un contact…"
                        placeholderTextColor={colors.textMuted}
                        value={inviteSearch}
                        onChangeText={setInviteSearch}
                      />
                      {inviteSearch.length > 0 && (
                        <TouchableOpacity onPress={() => setInviteSearch('')}>
                          <Ionicons name="close-circle" size={15} color={colors.textMuted} />
                        </TouchableOpacity>
                      )}
                    </View>
                    {filteredInviteCandidates.length === 0 && (
                      <Text style={styles.emptySubText}>Aucun contact ne correspond à « {inviteSearch} ».</Text>
                    )}
                    {displayedInviteCandidates.map((c, i) => (
                      <View key={`${c.phone}-${i}`} style={styles.suggestRow}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                          <View style={styles.suggestAvatarFallback}>
                            <Text style={styles.suggestAvatarLetter}>{c.name[0]?.toUpperCase() || '?'}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.suggestRowName} numberOfLines={1}>{c.name}</Text>
                          </View>
                        </View>
                        <TouchableOpacity style={styles.inviteBtn} onPress={() => inviteContact(c)}>
                          <Text style={styles.inviteBtnText}>Inviter</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                    {inviteSearch.length === 0 && filteredInviteCandidates.length > INVITE_DISPLAY_LIMIT && (
                      <Text style={styles.emptySubText}>
                        + {filteredInviteCandidates.length - INVITE_DISPLAY_LIMIT} autres — tape un nom pour les chercher.
                      </Text>
                    )}
                  </>
                )}
              </ScrollView>
            )}
            </ErrorBoundary>
          </View>
        </View>
      </Modal>

      {/* Filtre région */}
      <Modal visible={regionPickerVisible} animationType="slide" transparent onRequestClose={() => setRegionPickerVisible(false)}>
        <View style={styles.contactModalOverlay}>
          <View style={styles.contactModalCard}>
            <View style={styles.contactModalHeader}>
              <Text style={styles.contactModalTitle}>Filtrer par région</Text>
              <TouchableOpacity onPress={() => setRegionPickerVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ErrorBoundary label="region_modal" onClose={() => setRegionPickerVisible(false)}>
            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              <TouchableOpacity
                style={styles.regionOptionRow}
                onPress={() => { setRegionFilter(null); setRegionPickerVisible(false); }}
              >
                <Text style={[styles.regionOptionText, !regionFilter && styles.regionOptionTextActive]}>Toutes les régions</Text>
                {!regionFilter && <Ionicons name="checkmark" size={18} color={colors.terra} />}
              </TouchableOpacity>
              {REGIONS.map(r => {
                const count = regionCounts[r] || 0;
                return (
                  <TouchableOpacity
                    key={r}
                    style={styles.regionOptionRow}
                    onPress={() => { setRegionFilter(r); setRegionPickerVisible(false); }}
                  >
                    <Text style={[styles.regionOptionText, regionFilter === r && styles.regionOptionTextActive]}>
                      {r}{count > 0 ? ` (${count})` : ''}
                    </Text>
                    {regionFilter === r && <Ionicons name="checkmark" size={18} color={colors.terra} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            </ErrorBoundary>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: colors.ivoryPale },
  tabsWrap: {
    flexDirection: 'row', backgroundColor: colors.white,
    borderRadius: 12, padding: 4, borderWidth: 1, borderColor: colors.border,
    marginHorizontal: 16, marginVertical: 12,
  },
  tab:          { flex: 1, paddingVertical: 9, paddingHorizontal: 4, borderRadius: 8, alignItems: 'center' },
  tabActive:    { backgroundColor: colors.bordeaux },
  tabText:      { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.textMuted },
  tabTextActive:{ color: colors.ivory },

  // Feed
  feedList: { paddingBottom: 90 },
  suggestWrap: { paddingTop: 14, paddingBottom: 6, backgroundColor: colors.white, marginBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  suggestTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingHorizontal: 14 },
  suggestTitle: { fontFamily: 'DMSans_600SemiBold', fontSize: 13, color: colors.bordeaux },
  suggestScroll: { paddingHorizontal: 14, gap: 10, paddingBottom: 14 },
  suggestCard: { width: 118, backgroundColor: colors.ivoryPale, borderRadius: 14, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  suggestDismiss: { position: 'absolute', top: 6, right: 6, zIndex: 1, padding: 2 },
  suggestAvatar: { width: 52, height: 52, borderRadius: 26, marginBottom: 8 },
  suggestAvatarFallback: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.bordeaux, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  suggestAvatarLetter: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 20, color: colors.ivory },
  suggestName: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux, maxWidth: 94 },
  suggestSub: { fontFamily: 'DMSans_400Regular', fontSize: 10.5, color: colors.textMuted, marginTop: 2, maxWidth: 94, textAlign: 'center' },
  suggestFollowBtn: { marginTop: 10, backgroundColor: colors.terra, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 16 },
  suggestFollowBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.ivory },
  findContactsBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.white, marginHorizontal: 14, marginTop: 10, marginBottom: 4, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  findContactsBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.terra },
  regionFilterBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: colors.white, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: colors.border, marginBottom: 4 },
  regionFilterBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.terra },
  regionOptionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.border },
  regionOptionText: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux },
  regionOptionTextActive: { fontFamily: 'DMSans_500Medium', color: colors.terra },
  contactModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  contactModalCard: { backgroundColor: colors.ivoryPale, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32 },
  contactModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  contactModalTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.bordeaux },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.white, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  suggestRowName: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
  suggestRowSub: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 1 },
  inviteSectionTitle: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.textMuted, marginTop: 8, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 },
  inviteSearchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.ivoryLight, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 8 },
  inviteSearchInput: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.bordeaux },
  inviteBtn: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.terra, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 16 },
  inviteBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.terra },
  postCard: { backgroundColor: colors.white, marginBottom: 8 },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  postAvatarImg:     { width: 36, height: 36, borderRadius: 18 },
  postAvatarFallback:{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bordeaux, alignItems: 'center', justifyContent: 'center' },
  postAvatarLetter:  { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 15, color: colors.ivory },
  postAuthor:  { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux },
  postTime:    { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 1 },
  postImage:   { width: SCREEN_WIDTH, height: SCREEN_WIDTH * 0.75 },
  fromMapBadge: {
    position: 'absolute', top: 10, right: 10,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.52)', borderRadius: 12,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  fromMapBadgeText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: '#fff' },
  carouselDots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5, paddingVertical: 8 },
  carouselDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  carouselDotActive: { width: 18, backgroundColor: colors.bordeaux },
  carouselCounter: { backgroundColor: 'rgba(61,26,26,0.08)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  carouselCounterText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.textMuted },
  postMenuBtn: { padding: 4, marginLeft: 4 },
  postActions: { flexDirection: 'row', gap: 16, paddingHorizontal: 14, paddingTop: 10 },
  postActionBtn:  { flexDirection: 'row', alignItems: 'center', gap: 5 },
  postActionCount:{ fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux },
  lieuTag:     { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingTop: 6 },
  lieuTagText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.terra, flex: 1 },
  postCaption: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.bordeaux, paddingHorizontal: 14, paddingTop: 5, paddingBottom: 12, lineHeight: 19 },
  postCaptionBold: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux },
  fab: {
    position: 'absolute', bottom: 20, right: 20,
    width: 54, height: 54, borderRadius: 27,
    backgroundColor: colors.terra, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6, elevation: 6,
  },

  // Comments modal
  commentsOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  commentsSheet: { backgroundColor: colors.white, borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: 'hidden' },
  commentsHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginTop: 10, marginBottom: 2 },
  commentsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  commentsTitle:  { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 17, color: colors.bordeaux },
  commentsList:   { padding: 16, gap: 12 },
  commentsEmpty:  { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingVertical: 32 },
  commentRow:     { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  commentBubble:  { flex: 1, backgroundColor: colors.ivoryPale, borderRadius: 12, padding: 10 },
  commentAuthor:  { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.bordeaux, marginBottom: 2 },
  commentContent: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.bordeaux, lineHeight: 18 },
  commentInputRow:{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.white },
  commentTextInput: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux, maxHeight: 80 },

  // New post modal
  newPostModal:    { flex: 1, backgroundColor: colors.white },
  newPostHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  newPostTitle:    { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 17, color: colors.bordeaux },
  publishBtn:      { backgroundColor: colors.terra, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 7 },
  publishBtnDisabled: { backgroundColor: colors.textMuted },
  publishBtnText:  { fontFamily: 'DMSans_500Medium', fontSize: 13, color: '#fff' },
  imagePicker:     { margin: 16, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, height: (SCREEN_WIDTH - 32) * 0.75 },
  imagePickerEmpty:{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ivoryPale, gap: 8 },
  imagePickerHint: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted },
  imageThumbsRow:  { paddingHorizontal: 16, gap: 10 },
  imageThumb:      { width: 90, height: 90, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.ivoryPale },
  imageThumbAdd:   { alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed', backgroundColor: 'transparent' },
  imageThumbRemove:{ position: 'absolute', top: 3, right: 3, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 10 },
  newPostSection:  { paddingHorizontal: 16, paddingTop: 12 },
  captionInput:    { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux, padding: 12, backgroundColor: colors.ivoryPale, borderRadius: 10, minHeight: 60 },
  lieuSearchRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: colors.ivoryPale, borderRadius: 10 },
  lieuSearchInput: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux },
  selectedLieuChip:{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectedLieuText:{ fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.terra, flex: 1 },
  lieuResultsList: { marginTop: 4, backgroundColor: colors.white, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  lieuResultRow:   { padding: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  lieuResultName:  { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux },
  lieuResultVille: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 1 },
  lieuSuggestRow:  { marginTop: 6, flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, backgroundColor: colors.terra + '10', borderRadius: 10, borderWidth: 1, borderColor: colors.terra + '30' },
  lieuSuggestText: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.bordeaux, lineHeight: 17 },

  // Balade card
  baladeCard: { borderLeftWidth: 3, borderLeftColor: colors.sage },
  baladeCardTitle: {
    fontFamily: 'DMSans_600SemiBold', fontSize: 17, color: colors.bordeaux,
    marginHorizontal: 14, marginBottom: 10,
  },
  baladeStravaStats: {
    flexDirection: 'row', marginHorizontal: 14, marginBottom: 12, gap: 20,
  },
  baladeStravaStatItem: { alignItems: 'flex-start' },
  baladeStravaStatValue: { fontFamily: 'DMSans_600SemiBold', fontSize: 16, color: colors.bordeaux },
  baladeStravaStatLabel: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 1 },
  baladeTypeBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  baladeTypeBadgeText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.sage },

  // Nouveau lieu card
  lieuCard: { borderLeftWidth: 3, borderLeftColor: colors.terra },
  nouveauLieuBody: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 14, marginBottom: 14, padding: 14,
    backgroundColor: colors.ivoryPale, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
  },
  nouveauLieuIconWrap: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  nouveauLieuLabel: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted },
  nouveauLieuNom:   { fontFamily: 'DMSans_600SemiBold', fontSize: 15, color: colors.bordeaux },
  nouveauLieuMeta:  { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted },

  // Membres
  list:       { paddingHorizontal: 16, gap: 10, paddingBottom: 20 },
  searchBar:  { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.white, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 4 },
  searchInput:{ flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux },
  card:       { backgroundColor: colors.white, borderRadius: 14, padding: 14, flexDirection: 'row', gap: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  avatarImg:  { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.bordeaux, alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.ivory },
  body:       { flex: 1 },
  memberName: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
  ville:      { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 1 },
  dogInfo:    { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, marginTop: 1 },
  mutualRow:  { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  mutualText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.terra },
  followBtn:  { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.bordeaux },
  followBtnActive:    { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.bordeaux },
  followBtnText:      { fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#fff' },
  followBtnTextActive:{ color: colors.bordeaux },
  empty:      { alignItems: 'center', padding: 48 },
  emptyIcon:  { fontSize: 40, marginBottom: 12 },
  emptyText:  { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
  emptySubText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: 4 },
});
