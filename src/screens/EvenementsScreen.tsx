import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, Image, ScrollView,
  Modal, TextInput, Switch, Platform, Alert, KeyboardAvoidingView, Linking, Dimensions,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { mapNavigation } from '../lib/mapNavigation';
import { Ionicons } from '@expo/vector-icons';
import { supabase, uploadToR2 } from '../lib/supabase';
import { sendPushNotification } from '../lib/notifications';
import { colors } from '../lib/theme';
import { useSession } from '../hooks/useSession';
import AuthGate from '../components/AuthGate';
import { RACES } from '../constants/races';

const MAX_EVENT_PHOTOS = 3;

type Evenement = {
  id: string; titre: string; description: string | null;
  date_heure: string; date_heure_fin: string | null; adresse: string | null; ville: string;
  lat: number | null; lng: number | null;
  max_participants: number | null; payant: boolean; prix: number | null;
  image_url: string | null; images: string[] | null; site_web: string | null;
  code_promo: string | null; mise_en_avant?: boolean;
  races: string[] | null;
  partenaires_mentions: { type: 'partenaire' | 'instagram'; nom: string; id?: string; logo_url?: string | null; url?: string }[] | null;
  organisateur_id: string | null; valide?: boolean;
  profils: { prenom: string | null; username: string | null; avatar_url: string | null } | null;
  nb_inscrits?: number; je_suis_inscrit?: boolean; est_enregistre?: boolean;
  created_by?: string;
};

type Filter = 'avenir' | 'mesEvents' | 'semaine';

type EvenementPrive = {
  id: string; titre: string; description: string | null; date_heure: string;
  adresse: string | null; ville: string | null; organisateur_id: string;
  conversation_id: string | null; actif: boolean;
  image_url: string | null; images: string[] | null;
};
type Invitation = {
  id: string; evenement_id: string; statut: 'en_attente' | 'accepte' | 'refuse';
  evenements_prives: EvenementPrive;
};
type ProfilSearch = { id: string; username: string | null; prenom: string | null; avatar_url: string | null; ville?: string | null };

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
  const [villeFilter, setVilleFilter] = useState<string>('');
  const [raceFilter, setRaceFilter] = useState<string>('');
  const [villeModalOpen, setVilleModalOpen] = useState(false);
  const [raceModalOpen, setRaceModalOpen] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);

  const [selectedEvent, setSelectedEvent] = useState<Evenement | null>(null);
  const [inscriptionLoading, setInscriptionLoading] = useState(false);
  const [modalPhotoIndex, setModalPhotoIndex] = useState(0);

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
  const [eventDateFin, setEventDateFin] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showDateFinPicker, setShowDateFinPicker] = useState(false);
  const [showTimeFinPicker, setShowTimeFinPicker] = useState(false);
  const [photoUris, setPhotoUris] = useState<string[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [selectedRaces, setSelectedRaces] = useState<string[]>([]);
  const [raceCreateModalOpen, setRaceCreateModalOpen] = useState(false);
  const [raceCreateSearch, setRaceCreateSearch] = useState('');

  // ── Événements privés ──
  const [privateOrganized, setPrivateOrganized] = useState<EvenementPrive[]>([]);
  const [privateAccepted, setPrivateAccepted] = useState<EvenementPrive[]>([]);
  const [privatePending, setPrivatePending] = useState<Invitation[]>([]);
  const [privateLoading, setPrivateLoading] = useState(false);
  const [selectedPrivate, setSelectedPrivate] = useState<(EvenementPrive & { _role?: 'organisateur' | 'invite' }) | null>(null);
  const [createPriveModal, setCreatePriveModal] = useState(false);
  const [savingPrive, setSavingPrive] = useState(false);
  const [pTitre, setPTitre] = useState('');
  const [pDescription, setPDescription] = useState('');
  const [pVille, setPVille] = useState('');
  const [pAdresse, setPAdresse] = useState('');
  const [pDate, setPDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(10, 0, 0, 0); return d; });
  const [pShowDatePicker, setPShowDatePicker] = useState(false);
  const [pShowTimePicker, setPShowTimePicker] = useState(false);
  const [pPhotoUris, setPPhotoUris] = useState<string[]>([]);
  const [uploadingPrivePhotos, setUploadingPrivePhotos] = useState(false);

  // ── Édition événement privé ──
  const [editPriveModal, setEditPriveModal] = useState(false);
  const [editingPriveId, setEditingPriveId] = useState<string | null>(null);
  const [savingEditPrive, setSavingEditPrive] = useState(false);
  const [ePTitre, setEPTitre] = useState('');
  const [ePDescription, setEPDescription] = useState('');
  const [ePVille, setEPVille] = useState('');
  const [ePAdresse, setEPAdresse] = useState('');
  const [ePDate, setEPDate] = useState(new Date());
  const [ePShowDatePicker, setEPShowDatePicker] = useState(false);
  const [ePShowTimePicker, setEPShowTimePicker] = useState(false);
  const [ePPhotoUris, setEPPhotoUris] = useState<string[]>([]);

  const [inviteModal, setInviteModal] = useState(false);
  const [inviteEventId, setInviteEventId] = useState<string | null>(null);
  const [inviteSearch, setInviteSearch] = useState('');
  const [inviteSelected, setInviteSelected] = useState<ProfilSearch[]>([]);
  const [sendingInvites, setSendingInvites] = useState(false);
  const [inviteMode, setInviteModeState] = useState<'amis' | 'tous'>('amis');
  const [inviteVilleFilter, setInviteVilleFilter] = useState('');
  const [myFriends, setMyFriends] = useState<ProfilSearch[] | null>(null);
  const [inviteAllCache, setInviteAllCache] = useState<ProfilSearch[] | null>(null);
  const [inviteListLoading, setInviteListLoading] = useState(false);

  useEffect(() => {
    if (session?.user?.id) setMyUserId(session.user.id);
    load();
  }, [session?.user?.id, filter]);

  useEffect(() => { if (session?.user?.id) loadPrivateEvents(); }, [session?.user?.id]);

  useEffect(() => { setModalPhotoIndex(0); }, [selectedEvent?.id]);

  // Ouvre directement un evenement quand on arrive via une notification.
  // navigate('Tabs', { screen: 'Events' }) est un no-op silencieux si Events est deja
  // l'onglet actif, et cet effet ne se redeclenche de toute facon que si `evenements`
  // change (pas a chaque navigation) -- dans les deux cas l'id en attente pouvait ne
  // jamais etre consomme. L'abonnement direct plus bas couvre ces cas : il s'execute
  // des que la notif est tapee, sans dependre d'un focus ou d'un changement de liste.
  const openEventById = useCallback((pendingId: string) => {
    setEvenements(current => {
      const found = current.find(e => e.id === pendingId);
      if (found) { setSelectedEvent(found); return current; }
      // Pas dans la liste actuelle (filtre different) : on va le chercher directement
      supabase.from('evenements')
        .select('*, profils(prenom, username, avatar_url)')
        .eq('id', pendingId).maybeSingle()
        .then(({ data }) => { if (data) setSelectedEvent(data as Evenement); });
      return current;
    });
  }, []);

  useEffect(() => {
    const pendingId = mapNavigation.consumeEvent();
    if (pendingId) openEventById(pendingId);
  }, [evenements, openEventById]);

  useEffect(() => {
    mapNavigation.onEventPending(openEventById);
    return () => mapNavigation.onEventPending(null);
  }, [openEventById]);

  async function load() {
    setLoading(true);
    try {
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
          const [{ data: parts }, { data: favs }, ...counts] = await Promise.all([
            supabase.from('participations').select('event_id').eq('user_id', session.user.id).in('event_id', ids),
            supabase.from('evenements_favoris').select('event_id').eq('user_id', session.user.id).in('event_id', ids),
            ...ids.map((id: string) =>
              supabase.from('participations').select('*', { count: 'exact', head: true }).eq('event_id', id)
            ),
          ]);
          const inscritIds = new Set((parts || []).map((p: any) => p.event_id));
          const favIds = new Set((favs || []).map((f: any) => f.event_id));
          const mapped: Evenement[] = events.map((e: any, i: number) => ({
            ...e,
            nb_inscrits: (counts[i] as any).count || 0,
            je_suis_inscrit: inscritIds.has(e.id),
            est_enregistre: favIds.has(e.id),
          }));
          if (filter === 'mesEvents') {
            setEvenements(await buildMesEvents(mapped, session.user.id));
          } else {
            setEvenements(mapped);
          }
        } else if (filter === 'mesEvents' && session?.user?.id) {
          setEvenements(await buildMesEvents([], session.user.id));
        } else {
          setEvenements(filter === 'mesEvents' ? [] : events);
        }
      } catch {
        setEvenements(filter === 'mesEvents' ? [] : events);
      }
    } catch {
      setEvenements([]);
    } finally {
      setLoading(false);
    }
  }

  async function buildMesEvents(baseMapped: Evenement[], userId: string): Promise<Evenement[]> {
    // baseMapped vient d'une requete deja filtree sur date_heure >= now (voir load()),
    // donc les events passes auxquels on est inscrit en sont deja absents. Mais les
    // events qu'on a organises ou enregistres sont recuperes ici via des requetes a
    // part qui n'ont pas ce filtre par defaut - on l'applique explicitement pour ne
    // pas laisser trainer indefiniment des events passes dans "Mes events".
    const now = new Date().toISOString();
    // !e.site_web : les fiches d'evenements tiers (curatees via admin, lien externe)
    // ont souvent organisateur_id/created_by pointant vers le compte admin qui les a
    // ajoutees -- ca ne veut pas dire que ce compte "organise" l'event. Sans ce filtre,
    // "Mes events" listait indument toutes ces fiches pour le compte admin.
    const mine = baseMapped.filter(e => e.je_suis_inscrit || e.est_enregistre || (!e.site_web && (e.organisateur_id === userId || e.created_by === userId)));
    const byId = new Map<string, Evenement>();
    mine.forEach(e => byId.set(e.id, e));
    try {
      const { data: ownAll } = await supabase.from('evenements')
        .select('*, profils(prenom, username, avatar_url)')
        .or(`organisateur_id.eq.${userId},created_by.eq.${userId}`)
        .is('site_web', null)
        .gte('date_heure', now);
      (ownAll || []).forEach((e: any) => {
        if (!byId.has(e.id)) byId.set(e.id, { ...e, je_suis_inscrit: false, est_enregistre: false });
      });
    } catch {}
    try {
      const { data: favRows } = await supabase.from('evenements_favoris')
        .select('event_id, evenements(*, profils(prenom, username, avatar_url))')
        .eq('user_id', userId);
      (favRows || []).forEach((f: any) => {
        if (!f.evenements || f.evenements.date_heure < now) return;
        if (!byId.has(f.event_id)) {
          byId.set(f.event_id, { ...f.evenements, je_suis_inscrit: false, est_enregistre: true });
        } else {
          byId.set(f.event_id, { ...byId.get(f.event_id)!, est_enregistre: true });
        }
      });
    } catch {}
    return Array.from(byId.values()).sort((a, b) => new Date(a.date_heure).getTime() - new Date(b.date_heure).getTime());
  }

  async function toggleInscription(eventId: string, join: boolean) {
    if (!myUserId) return;
    setInscriptionLoading(true);
    const { error } = join
      ? await supabase.from('participations').insert({ event_id: eventId, user_id: myUserId })
      : await supabase.from('participations').delete().eq('event_id', eventId).eq('user_id', myUserId);
    setInscriptionLoading(false);
    if (error) { Alert.alert('Erreur', error.message); return; }
    const update = (e: Evenement) => e.id !== eventId ? e : {
      ...e, je_suis_inscrit: join, nb_inscrits: (e.nb_inscrits || 0) + (join ? 1 : -1),
    };
    setEvenements(prev => prev.map(update));
    if (selectedEvent?.id === eventId) setSelectedEvent(prev => prev ? update(prev) : prev);
  }

  async function toggleFavori(eventId: string, save: boolean) {
    if (!myUserId) return;
    const update = (e: Evenement) => e.id !== eventId ? e : { ...e, est_enregistre: save };
    setEvenements(prev => prev.map(update));
    if (selectedEvent?.id === eventId) setSelectedEvent(prev => prev ? update(prev) : prev);
    const { error } = save
      ? await supabase.from('evenements_favoris').insert({ event_id: eventId, user_id: myUserId })
      : await supabase.from('evenements_favoris').delete().eq('event_id', eventId).eq('user_id', myUserId);
    if (error) {
      const revert = (e: Evenement) => e.id !== eventId ? e : { ...e, est_enregistre: !save };
      setEvenements(prev => prev.map(revert));
      if (selectedEvent?.id === eventId) setSelectedEvent(prev => prev ? revert(prev) : prev);
      Alert.alert('Erreur', error.message);
    } else if (filter === 'mesEvents' && !save) {
      setEvenements(prev => prev.filter(e => e.id !== eventId || e.je_suis_inscrit || e.organisateur_id === myUserId || e.created_by === myUserId));
    }
  }

  // ── Événements privés ──
  async function loadPrivateEvents() {
    if (!session?.user?.id) return;
    setPrivateLoading(true);
    const uid = session.user.id;
    const [{ data: organized }, { data: invitations }] = await Promise.all([
      supabase.from('evenements_prives').select('*').eq('organisateur_id', uid).eq('actif', true).order('date_heure', { ascending: true }),
      supabase.from('evenements_invitations').select('*, evenements_prives(*)').eq('invite_id', uid),
    ]);
    setPrivateOrganized((organized || []) as EvenementPrive[]);
    const invRows = ((invitations || []) as Invitation[]).filter(i => i.evenements_prives?.actif);
    setPrivatePending(invRows.filter(i => i.statut === 'en_attente'));
    setPrivateAccepted(invRows.filter(i => i.statut === 'accepte').map(i => i.evenements_prives));
    setPrivateLoading(false);
  }

  function resetPriveForm() {
    setPTitre(''); setPDescription(''); setPVille(''); setPAdresse(''); setPPhotoUris([]);
    const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(10, 0, 0, 0);
    setPDate(d);
  }

  // Reutilisee par la creation ET l'edition d'un event prive (ajout de photos).
  function pickPhotosGeneric(currentUris: string[], setUris: (fn: (prev: string[]) => string[]) => void) {
    Alert.alert('Ajouter des photos', '', [
      {
        text: 'Prendre une photo',
        onPress: async () => {
          try {
            const perm = await ImagePicker.requestCameraPermissionsAsync();
            if (!perm.granted) {
              Alert.alert('Accès à la caméra requis', 'Autorise The Pack à accéder à ta caméra dans les Réglages.', [
                { text: 'Annuler', style: 'cancel' },
                { text: 'Ouvrir les Réglages', onPress: () => Linking.openSettings() },
              ]);
              return;
            }
            const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
            if (result.canceled || !result.assets?.length) return;
            setUris(prev => [...prev, ...result.assets.map(a => a.uri)].slice(0, MAX_EVENT_PHOTOS));
          } catch (e: any) {
            Alert.alert('Erreur', e?.message || "Impossible d'ouvrir la caméra.");
          }
        },
      },
      {
        text: 'Choisir depuis la galerie',
        onPress: async () => {
          try {
            const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!perm.granted) {
              Alert.alert('Accès aux photos requis', 'Autorise The Pack à accéder à ta galerie dans les Réglages.', [
                { text: 'Annuler', style: 'cancel' },
                { text: 'Ouvrir les Réglages', onPress: () => Linking.openSettings() },
              ]);
              return;
            }
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'], quality: 0.8,
              allowsMultipleSelection: true, selectionLimit: MAX_EVENT_PHOTOS - currentUris.length,
              preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
            });
            if (result.canceled || !result.assets?.length) return;
            setUris(prev => [...prev, ...result.assets.map(a => a.uri)].slice(0, MAX_EVENT_PHOTOS));
          } catch (e: any) {
            Alert.alert('Erreur', e?.message || "Impossible d'ouvrir la galerie.");
          }
        },
      },
      { text: 'Annuler', style: 'cancel' },
    ]);
  }
  function pickPrivateEventPhotos() { pickPhotosGeneric(pPhotoUris, setPPhotoUris); }
  function pickEditPrivePhotos() { pickPhotosGeneric(ePPhotoUris, setEPPhotoUris); }

  async function submitPrivateEvent() {
    if (!pTitre.trim() || !myUserId) {
      Alert.alert('Champ requis', 'Le titre est obligatoire.');
      return;
    }
    setSavingPrive(true);
    try {
      setUploadingPrivePhotos(true);
      const urls: string[] = [];
      for (const uri of pPhotoUris) {
        try {
          const ext = uri.split('.').pop()?.toLowerCase() === 'png' ? 'png' : 'jpg';
          const r2Key = `lieu-photos/evenements/${myUserId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          urls.push(await uploadToR2(uri, r2Key));
        } catch {}
      }
      setUploadingPrivePhotos(false);

      // Le salon est cree ici par un simple insert (protege par les policies existantes,
      // pas de logique de securite) ; qui peut le rejoindre ensuite est decide uniquement
      // cote serveur par le trigger sur evenements_invitations, exclusivement via une
      // invitation acceptee (un event prive est toujours sur invitation).
      const { data: conv, error: convErr } = await supabase.from('conversations')
        .insert({ nom: '🐾 ' + pTitre.trim(), type: 'evenement_prive', created_by: myUserId, actif: true })
        .select().single();
      if (convErr || !conv) throw convErr || new Error('Création du salon impossible');
      await supabase.from('conversation_members').insert({ conversation_id: conv.id, user_id: myUserId });

      const { data: ev, error } = await supabase.from('evenements_prives').insert({
        titre: pTitre.trim(), description: pDescription.trim() || null, date_heure: pDate.toISOString(),
        adresse: pAdresse.trim() || null, ville: pVille.trim() || null,
        organisateur_id: myUserId, conversation_id: conv.id,
        image_url: urls[0] || null, images: urls.length > 1 ? urls : null,
      }).select().single();
      if (error || !ev) throw error || new Error('Création impossible');

      setCreatePriveModal(false);
      resetPriveForm();
      loadPrivateEvents();
      openInviteModal(ev.id);
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Réessaie.');
    } finally {
      setSavingPrive(false);
    }
  }

  function isRemoteUrl(uri: string) { return uri.startsWith('http://') || uri.startsWith('https://'); }

  function openEditPriveModal(ev: EvenementPrive) {
    setEditingPriveId(ev.id);
    setEPTitre(ev.titre);
    setEPDescription(ev.description || '');
    setEPVille(ev.ville || '');
    setEPAdresse(ev.adresse || '');
    setEPDate(new Date(ev.date_heure));
    setEPPhotoUris(ev.images && ev.images.length ? ev.images : (ev.image_url ? [ev.image_url] : []));
    setSelectedPrivate(null);
    setEditPriveModal(true);
  }

  async function submitEditPrive() {
    if (!editingPriveId || !ePTitre.trim()) {
      Alert.alert('Champ requis', 'Le titre est obligatoire.');
      return;
    }
    setSavingEditPrive(true);
    try {
      const newLocalUris = ePPhotoUris.filter(u => !isRemoteUrl(u));
      const keptRemoteUrls = ePPhotoUris.filter(isRemoteUrl);
      const uploadedUrls: string[] = [];
      for (const uri of newLocalUris) {
        try {
          const ext = uri.split('.').pop()?.toLowerCase() === 'png' ? 'png' : 'jpg';
          const r2Key = `lieu-photos/evenements/${myUserId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          uploadedUrls.push(await uploadToR2(uri, r2Key));
        } catch {}
      }
      const allUrls = [...keptRemoteUrls, ...uploadedUrls];

      const { error } = await supabase.from('evenements_prives').update({
        titre: ePTitre.trim(), description: ePDescription.trim() || null, date_heure: ePDate.toISOString(),
        adresse: ePAdresse.trim() || null, ville: ePVille.trim() || null,
        image_url: allUrls[0] || null, images: allUrls.length > 1 ? allUrls : null,
      }).eq('id', editingPriveId);
      if (error) throw error;

      setEditPriveModal(false);
      setEditingPriveId(null);
      loadPrivateEvents();
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Réessaie.');
    } finally {
      setSavingEditPrive(false);
    }
  }

  function deletePriveEvent() {
    if (!editingPriveId) return;
    Alert.alert('Supprimer cet événement ?', 'Les invités ne pourront plus y accéder.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer', style: 'destructive', onPress: async () => {
          const ev = privateOrganized.find(e => e.id === editingPriveId);
          const { error } = await supabase.from('evenements_prives').update({ actif: false }).eq('id', editingPriveId);
          if (error) { Alert.alert('Erreur', error.message); return; }
          if (ev?.conversation_id) {
            await supabase.from('conversations').update({ actif: false }).eq('id', ev.conversation_id);
          }
          setEditPriveModal(false);
          setEditingPriveId(null);
          loadPrivateEvents();
        },
      },
    ]);
  }

  async function loadMyFriends(): Promise<ProfilSearch[]> {
    if (myFriends) return myFriends;
    if (!myUserId) return [];
    const { data: followRows } = await supabase.from('follows').select('following_id').eq('follower_id', myUserId).eq('statut', 'accepte');
    const ids = (followRows || []).map((f: any) => f.following_id);
    if (!ids.length) { setMyFriends([]); return []; }
    const { data } = await supabase.from('profils').select('id,username,prenom,avatar_url,ville').in('id', ids);
    const sorted = ((data || []) as ProfilSearch[]).sort((a, b) => (a.prenom || '').localeCompare(b.prenom || '', 'fr'));
    setMyFriends(sorted);
    return sorted;
  }

  async function loadAllMembersCache(): Promise<ProfilSearch[]> {
    if (inviteAllCache) return inviteAllCache;
    if (!myUserId) return [];
    const { data } = await supabase.from('profils').select('id,username,prenom,avatar_url,ville').neq('id', myUserId).limit(500);
    const list = (data || []) as ProfilSearch[];
    setInviteAllCache(list);
    return list;
  }

  function setInviteMode(mode: 'amis' | 'tous') {
    setInviteModeState(mode);
    if (mode === 'tous' && !inviteAllCache) {
      setInviteListLoading(true);
      loadAllMembersCache().finally(() => setInviteListLoading(false));
    }
  }

  async function openInviteModal(eventId: string) {
    setInviteEventId(eventId);
    setInviteSearch(''); setInviteSelected([]); setInviteVilleFilter(''); setInviteModeState('amis');
    setInviteModal(true);
    if (!myFriends) {
      setInviteListLoading(true);
      await loadMyFriends();
      setInviteListLoading(false);
    }
  }

  // "Mes amis" en tete (prioritaires, cf. demande explicite), puis recherche prenom OU
  // pseudo, puis filtre ville -- chercher seulement par pseudo rendait les gens trop
  // difficiles a retrouver.
  function getInviteCandidates(): ProfilSearch[] {
    let candidates: ProfilSearch[];
    if (inviteMode === 'amis') {
      candidates = myFriends || [];
    } else {
      const all = inviteAllCache || [];
      const friendIds = new Set((myFriends || []).map(f => f.id));
      candidates = [...all].sort((a, b) => {
        const fa = friendIds.has(a.id) ? 1 : 0, fb = friendIds.has(b.id) ? 1 : 0;
        if (fa !== fb) return fb - fa;
        return (a.prenom || '').localeCompare(b.prenom || '', 'fr');
      });
    }
    let filtered = candidates.filter(p => !inviteSelected.some(s => s.id === p.id));
    const q = inviteSearch.trim().toLowerCase();
    if (q) filtered = filtered.filter(p => (p.prenom || '').toLowerCase().includes(q) || (p.username || '').toLowerCase().includes(q));
    if (inviteVilleFilter) filtered = filtered.filter(p => p.ville === inviteVilleFilter);
    return filtered;
  }

  function selectInviteUser(p: ProfilSearch) {
    if (inviteSelected.some(s => s.id === p.id)) return;
    setInviteSelected(prev => [...prev, p]);
    setInviteSearch('');
  }

  function removeInviteUser(id: string) {
    setInviteSelected(prev => prev.filter(p => p.id !== id));
  }

  async function sendInvitations() {
    if (!inviteEventId || !inviteSelected.length || !myUserId) { setInviteModal(false); return; }
    setSendingInvites(true);
    try {
      const rows = inviteSelected.map(p => ({ evenement_id: inviteEventId, invite_id: p.id, invited_by: myUserId }));
      const { error } = await supabase.from('evenements_invitations').insert(rows);
      if (error) throw error;
      const { data: profs } = await supabase.from('profils').select('id,push_token,notif_messages').in('id', inviteSelected.map(p => p.id));
      (profs || []).forEach((pr: any) => {
        if (pr.push_token && pr.notif_messages !== false) {
          sendPushNotification(pr.push_token, '🐾 Invitation à un événement privé', "Tu es invité·e à un événement privé sur The Pack La Meute", { type: 'private_event_invite' });
        }
      });
      setInviteModal(false);
      loadPrivateEvents();
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Réessaie.');
    } finally {
      setSendingInvites(false);
    }
  }

  async function respondInvitation(invitationId: string, statut: 'accepte' | 'refuse') {
    const { error } = await supabase.from('evenements_invitations').update({ statut }).eq('id', invitationId);
    if (error) { Alert.alert('Erreur', error.message); return; }
    loadPrivateEvents();
  }

  function openPrivateChat(convId: string) {
    setSelectedPrivate(null);
    mapNavigation.setPendingConversation(convId);
    navigation.navigate('Tabs', { screen: 'Meute' });
  }

  function resetForm() {
    setTitre(''); setDescription(''); setVille(''); setAdresse('');
    setMaxPart(''); setPayant(false); setPrix(''); setPhotoUris([]);
    setSelectedRaces([]);
    const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(10, 0, 0, 0);
    setEventDate(d);
    setEventDateFin(null);
  }

  function toggleSelectedRace(r: string) {
    setSelectedRaces(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);
  }

  function pickEventPhotos() {
    Alert.alert('Ajouter des photos', '', [
      {
        text: 'Prendre une photo',
        onPress: async () => {
          try {
            const perm = await ImagePicker.requestCameraPermissionsAsync();
            if (!perm.granted) {
              Alert.alert('Accès à la caméra requis', 'Autorise The Pack à accéder à ta caméra dans les Réglages.', [
                { text: 'Annuler', style: 'cancel' },
                { text: 'Ouvrir les Réglages', onPress: () => Linking.openSettings() },
              ]);
              return;
            }
            const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
            if (result.canceled || !result.assets?.length) return;
            setPhotoUris(prev => [...prev, ...result.assets.map(a => a.uri)].slice(0, MAX_EVENT_PHOTOS));
          } catch (e: any) {
            Alert.alert('Erreur', e?.message || "Impossible d'ouvrir la caméra.");
          }
        },
      },
      {
        text: 'Choisir depuis la galerie',
        onPress: async () => {
          try {
            const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!perm.granted) {
              Alert.alert('Accès aux photos requis', 'Autorise The Pack à accéder à ta galerie dans les Réglages.', [
                { text: 'Annuler', style: 'cancel' },
                { text: 'Ouvrir les Réglages', onPress: () => Linking.openSettings() },
              ]);
              return;
            }
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'], quality: 0.8,
              allowsMultipleSelection: true, selectionLimit: MAX_EVENT_PHOTOS - photoUris.length,
              preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
            });
            if (result.canceled || !result.assets?.length) return;
            setPhotoUris(prev => [...prev, ...result.assets.map(a => a.uri)].slice(0, MAX_EVENT_PHOTOS));
          } catch (e: any) {
            Alert.alert('Erreur', e?.message || "Impossible d'ouvrir la galerie.");
          }
        },
      },
      { text: 'Annuler', style: 'cancel' },
    ]);
  }

  async function submitEvent() {
    if (!titre.trim() || !ville.trim()) {
      Alert.alert('Champs requis', 'Le titre et la ville sont obligatoires.');
      return;
    }
    if (eventDateFin && eventDateFin.getTime() < eventDate.getTime()) {
      Alert.alert('Date de fin invalide', 'La date/heure de fin doit être après le début.');
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

    setUploadingPhotos(true);
    const urls: string[] = [];
    for (const uri of photoUris) {
      try {
        const ext = uri.split('.').pop()?.toLowerCase() === 'png' ? 'png' : 'jpg';
        const r2Key = `lieu-photos/evenements/${myUserId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        urls.push(await uploadToR2(uri, r2Key));
      } catch {}
    }
    setUploadingPhotos(false);

    const { error } = await supabase.from('evenements').insert({
      titre: titre.trim(),
      description: description.trim() || null,
      date_heure: eventDate.toISOString(),
      date_heure_fin: eventDateFin ? eventDateFin.toISOString() : null,
      ville: ville.trim(),
      adresse: adresse.trim() || null,
      max_participants: maxPart ? parseInt(maxPart) : null,
      payant,
      prix: payant && prix ? parseFloat(prix) : null,
      valide: false,
      actif: true,
      lat: eventLat,
      lng: eventLng,
      created_by: myUserId,
      organisateur_id: myUserId,
      image_url: urls[0] || null,
      images: urls.length > 1 ? urls : null,
      races: selectedRaces.length ? selectedRaces : null,
    });
    setSaving(false);
    if (error) { Alert.alert('Erreur', error.message); return; }
    setCreateModal(false);
    resetForm();
    // Sans ca, rester sur l'onglet "Mes events" au moment de la creation ne faisait
    // jamais apparaitre le nouvel event tant qu'on ne changeait pas d'onglet ou ne
    // tirait pas pour rafraichir.
    load();
    Alert.alert('Événement soumis', 'Il sera visible après validation par l\'équipe The Pack.');
  }

  if (sessionLoading) return <ActivityIndicator style={{ flex: 1 }} color={colors.terra} />;
  if (!session) return <AuthGate navigation={navigation} message="Connecte-toi pour voir et créer des événements dog-friendly." />;

  const FILTERS: { key: Filter; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
    { key: 'avenir',  label: 'À venir',       icon: 'calendar-outline' },
    { key: 'semaine', label: 'Cette semaine',  icon: 'today-outline' },
    { key: 'mesEvents',label: privatePending.length ? `Mes events (${privatePending.length})` : 'Mes events', icon: 'checkmark-circle-outline' },
  ];

  const villesDisponibles = [...new Set(evenements.map(e => e.ville).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  const racesDisponibles = [...new Set(evenements.flatMap(e => e.races || []))].sort((a, b) => a.localeCompare(b, 'fr'));
  const evenementsAffiches = evenements.filter(e =>
    (!villeFilter || e.ville === villeFilter) &&
    (!raceFilter || !e.races?.length || e.races.includes(raceFilter))
  );
  if (filter !== 'mesEvents') {
    evenementsAffiches.sort((a, b) => (b.mise_en_avant ? 1 : 0) - (a.mise_en_avant ? 1 : 0));
  }

  // Rendue en ListHeaderComponent de l'onglet "À venir" (et non plus comme onglet a
  // part) -- renvoie null si rien a montrer, pour ne pas alourdir la vue publique par
  // defaut quand l'utilisateur n'a aucun evenement prive.
  function renderPrivateSection() {
    const total = privatePending.length + privateOrganized.length + privateAccepted.length;
    if (!total) return null;
    return (
      <View style={styles.privateSection}>
        {privatePending.length > 0 && <Text style={styles.privateSectionTitle}>Invitations en attente</Text>}
        {privatePending.map(inv => {
          const e = inv.evenements_prives;
          const d = new Date(e.date_heure);
          return (
            <View key={inv.id} style={styles.privateCard}>
              <View style={styles.lockBadge}><Text style={styles.lockBadgeText}>🐾 Privé</Text></View>
              <Text style={styles.privateCardTitle}>{e.titre}</Text>
              <Text style={styles.privateCardMeta}>{fmtDate(d)} à {fmtHeure(d)}</Text>
              {e.ville ? <Text style={styles.privateCardMeta}>{e.ville}{e.adresse ? ` · ${e.adresse}` : ''}</Text> : null}
              <View style={styles.inviteActionsRow}>
                <TouchableOpacity style={styles.acceptBtn} onPress={() => respondInvitation(inv.id, 'accepte')}>
                  <Text style={styles.acceptBtnText}>Accepter</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.refuseBtn} onPress={() => respondInvitation(inv.id, 'refuse')}>
                  <Text style={styles.refuseBtnText}>Refuser</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
        {(privateOrganized.length + privateAccepted.length) > 0 && (
          <Text style={[styles.privateSectionTitle, privatePending.length > 0 && { marginTop: 14 }]}>🐾 Tes événements privés</Text>
        )}
        {[
          ...privateOrganized.map(e => ({ ...e, _role: 'organisateur' as const })),
          ...privateAccepted.map(e => ({ ...e, _role: 'invite' as const })),
        ].sort((a, b) => new Date(a.date_heure).getTime() - new Date(b.date_heure).getTime()).map(e => {
          const d = new Date(e.date_heure);
          return (
            <TouchableOpacity key={e.id} style={styles.privateCard} onPress={() => setSelectedPrivate(e)} activeOpacity={0.8}>
              <View style={styles.lockBadge}>
                <Text style={styles.lockBadgeText}>🐾 {e._role === 'organisateur' ? 'Organisateur' : 'Invité·e'}</Text>
              </View>
              <Text style={styles.privateCardTitle}>{e.titre}</Text>
              <Text style={styles.privateCardMeta}>{fmtDate(d)} à {fmtHeure(d)}</Text>
              {e.ville ? <Text style={styles.privateCardMeta}>{e.ville}{e.adresse ? ` · ${e.adresse}` : ''}</Text> : null}
            </TouchableOpacity>
          );
        })}
      </View>
    );
  }

  const inviteVilles = [...new Set((myFriends || []).map(f => f.ville).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'fr'));
  const inviteCandidates = getInviteCandidates();
  const inviteCandidatesCapped = inviteCandidates.slice(0, 40);

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
            <Text style={[styles.tabText, filter === f.key && styles.tabTextActive]} numberOfLines={1}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Filtres ville / race */}
      {(villesDisponibles.length > 0 || racesDisponibles.length > 0) && (
        <View style={styles.dropdownFiltersRow}>
          {villesDisponibles.length > 0 && (
            <TouchableOpacity style={styles.dropdownFilterBtn} onPress={() => setVilleModalOpen(true)}>
              <Text style={styles.dropdownFilterBtnText} numberOfLines={1}>{villeFilter || 'Toutes les villes'}</Text>
              <Ionicons name="chevron-down" size={14} color={colors.bordeaux} />
            </TouchableOpacity>
          )}
          {racesDisponibles.length > 0 && (
            <TouchableOpacity style={styles.dropdownFilterBtn} onPress={() => setRaceModalOpen(true)}>
              <Text style={styles.dropdownFilterBtnText} numberOfLines={1}>{raceFilter || 'Toutes les races'}</Text>
              <Ionicons name="chevron-down" size={14} color={colors.bordeaux} />
            </TouchableOpacity>
          )}
        </View>
      )}

      <Modal visible={villeModalOpen} animationType="slide" transparent onRequestClose={() => setVilleModalOpen(false)}>
        <TouchableOpacity style={styles.pickerBackdrop} activeOpacity={1} onPress={() => setVilleModalOpen(false)}>
          <View style={styles.pickerSheet}>
            <Text style={styles.pickerTitle}>Filtrer par ville</Text>
            <FlatList
              data={['', ...villesDisponibles]}
              keyExtractor={v => v || '_all'}
              renderItem={({ item: v }) => (
                <TouchableOpacity style={styles.pickerRow} onPress={() => { setVilleFilter(v); setVilleModalOpen(false); }}>
                  <Text style={[styles.pickerRowText, villeFilter === v && styles.pickerRowTextActive]}>{v || 'Toutes les villes'}</Text>
                  {villeFilter === v && <Ionicons name="checkmark" size={16} color={colors.bordeaux} />}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={raceModalOpen} animationType="slide" transparent onRequestClose={() => setRaceModalOpen(false)}>
        <TouchableOpacity style={styles.pickerBackdrop} activeOpacity={1} onPress={() => setRaceModalOpen(false)}>
          <View style={styles.pickerSheet}>
            <Text style={styles.pickerTitle}>Filtrer par race</Text>
            <FlatList
              data={['', ...racesDisponibles]}
              keyExtractor={r => r || '_all'}
              renderItem={({ item: r }) => (
                <TouchableOpacity style={styles.pickerRow} onPress={() => { setRaceFilter(r); setRaceModalOpen(false); }}>
                  <Text style={[styles.pickerRowText, raceFilter === r && styles.pickerRowTextActive]}>{r || 'Toutes les races'}</Text>
                  {raceFilter === r && <Ionicons name="checkmark" size={16} color={colors.bordeaux} />}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={raceCreateModalOpen} animationType="slide" transparent onRequestClose={() => setRaceCreateModalOpen(false)}>
        <TouchableOpacity style={styles.pickerBackdrop} activeOpacity={1} onPress={() => setRaceCreateModalOpen(false)}>
          <View style={styles.pickerSheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.pickerTitle}>Race(s) concernée(s)</Text>
            <TextInput
              style={styles.input}
              value={raceCreateSearch}
              onChangeText={setRaceCreateSearch}
              placeholder="Rechercher une race…"
              placeholderTextColor={colors.textMuted}
            />
            <FlatList
              style={{ marginTop: 8 }}
              data={raceCreateSearch ? RACES.filter(r => r.toLowerCase().includes(raceCreateSearch.toLowerCase())) : RACES}
              keyExtractor={r => r}
              renderItem={({ item: r }) => {
                const checked = selectedRaces.includes(r);
                return (
                  <TouchableOpacity style={styles.pickerRow} onPress={() => toggleSelectedRace(r)}>
                    <Text style={[styles.pickerRowText, checked && styles.pickerRowTextActive]}>{r}</Text>
                    {checked && <Ionicons name="checkmark" size={16} color={colors.bordeaux} />}
                  </TouchableOpacity>
                );
              }}
            />
            <TouchableOpacity style={[styles.dateBtn, { marginTop: 12 }]} onPress={() => setRaceCreateModalOpen(false)}>
              <Text style={styles.dateBtnText}>Valider{selectedRaces.length ? ` (${selectedRaces.length})` : ''}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Liste */}
      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={colors.terra} />
      ) : (
        <FlatList
          data={evenementsAffiches}
          keyExtractor={e => e.id}
          contentContainerStyle={[styles.list, evenements.length === 0 && { flex: 1 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await Promise.all([load(), loadPrivateEvents()]); setRefreshing(false); }} tintColor={colors.terra} />}
          ListHeaderComponent={filter === 'mesEvents' ? renderPrivateSection : null}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="calendar-outline" size={44} color={colors.border} />
              <Text style={styles.emptyTitle}>
                {filter === 'mesEvents' ? 'Aucun event pour l\'instant' : 'Aucun événement à venir'}
              </Text>
              <Text style={styles.emptyText}>
                {filter === 'mesEvents' ? 'Crée, enregistre ou inscris-toi à un event pour le retrouver ici !' : 'Sois le premier à en créer un !'}
              </Text>
            </View>
          }
          renderItem={({ item: e }) => {
            const date = new Date(e.date_heure);
            const diffDays = Math.ceil((date.getTime() - Date.now()) / 86400000);
            return (
              <TouchableOpacity style={styles.card} onPress={() => setSelectedEvent(e)} activeOpacity={0.85}>
                {e.image_url ? (
                  <View>
                    <Image source={{ uri: e.image_url }} style={styles.cardImg} />
                    {e.images && e.images.length > 1 && (
                      <View style={styles.photoCountBadge}>
                        <Ionicons name="images-outline" size={11} color="#fff" />
                        <Text style={styles.photoCountText}>{e.images.length}</Text>
                      </View>
                    )}
                  </View>
                ) : null}
                <TouchableOpacity
                  style={[styles.saveBtn, !e.image_url && styles.saveBtnNoImg]}
                  onPress={() => toggleFavori(e.id, !e.est_enregistre)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name={e.est_enregistre ? 'bookmark' : 'bookmark-outline'} size={16} color={e.image_url ? '#fff' : colors.bordeaux} />
                </TouchableOpacity>
                <View style={styles.cardBody}>
                  {/* Badges */}
                  <View style={styles.badgeRow}>
                    {e.mise_en_avant && (
                      <View style={styles.featuredBadge}><Text style={styles.featuredText}>✨ En avant</Text></View>
                    )}
                    {filter === 'mesEvents' && !e.valide && (
                      <View style={styles.pendingBadge}><Text style={styles.pendingText}>En attente de validation</Text></View>
                    )}
                    {diffDays <= 3 && (
                      <View style={styles.urgencyBadge}>
                        <Text style={styles.urgencyText}>{diffDays === 0 ? "Auj." : diffDays === 1 ? 'Demain' : `J-${diffDays}`}</Text>
                      </View>
                    )}
                    {e.payant
                      ? <View style={styles.paidBadge}><Text style={styles.paidText}>{e.prix ? `${e.prix} €` : 'Payant'}</Text></View>
                      : <View style={styles.freeBadge}><Text style={styles.freeText}>Gratuit</Text></View>}
                    {e.races && e.races.length > 0 && (
                      <View style={styles.raceBadge}>
                        <Text style={styles.raceText}>{e.races.length === 1 ? e.races[0] : 'Plusieurs races'}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.cardTitle} numberOfLines={2}>{e.titre}</Text>
                  <View style={styles.infoRow}>
                    <Ionicons name="calendar-outline" size={12} color={colors.textMuted} />
                    <Text style={styles.infoText}>{fmtDate(date)} à {fmtHeure(date)}{e.date_heure_fin ? ` - ${fmtHeure(new Date(e.date_heure_fin))}` : ''}</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Ionicons name="location-outline" size={12} color={colors.textMuted} />
                    <Text style={styles.infoText} numberOfLines={1}>{e.ville}{e.adresse ? ` — ${e.adresse}` : ''}</Text>
                  </View>
                  <View style={styles.cardFooter}>
                    <Text style={styles.orgaText}>{e.site_web ? 'Événement tiers' : `@${e.profils?.username || 'anonyme'}`}</Text>
                    {!e.site_web && e.nb_inscrits !== undefined && (
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

      {/* FAB créer -- creation d'un event public retiree de cet ecran : geree
          desormais via l'espace pro (B2B) ou l'admin, pour rester gerable. */}
      <TouchableOpacity style={styles.fab} onPress={() => { resetPriveForm(); setCreatePriveModal(true); }} activeOpacity={0.85}>
        <Ionicons name="add" size={26} color={colors.ivory} />
      </TouchableOpacity>

      {/* ── Modal détail événement privé ── */}
      <Modal visible={!!selectedPrivate} animationType="slide" transparent onRequestClose={() => setSelectedPrivate(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: '80%' }]}>
            <TouchableOpacity style={styles.modalClose} onPress={() => setSelectedPrivate(null)}>
              <Ionicons name="close" size={22} color={colors.textMid} />
            </TouchableOpacity>
            {selectedPrivate && (() => {
              const privatePhotos = selectedPrivate.images?.length ? selectedPrivate.images : (selectedPrivate.image_url ? [selectedPrivate.image_url] : []);
              return (
              <ScrollView contentContainerStyle={styles.modalContent}>
                {privatePhotos.length > 0 && (
                  <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20, marginTop: -20, marginBottom: 16 }}>
                    {privatePhotos.map((url, idx) => (
                      <Image key={idx} source={{ uri: url }} style={[styles.modalImg, { width: Dimensions.get('window').width }]} />
                    ))}
                  </ScrollView>
                )}
                <View style={styles.lockBadge}>
                  <Text style={styles.lockBadgeText}>🐾 Événement privé</Text>
                </View>
                <Text style={[styles.modalTitle, { marginTop: 10 }]}>{selectedPrivate.titre}</Text>
                <View style={styles.modalInfoRow}>
                  <Ionicons name="calendar-outline" size={16} color={colors.textMuted} />
                  <View>
                    <Text style={styles.modalInfoMain}>{new Date(selectedPrivate.date_heure).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</Text>
                    <Text style={styles.modalInfoSub}>à {fmtHeure(new Date(selectedPrivate.date_heure))}</Text>
                  </View>
                </View>
                {selectedPrivate.ville ? (
                  <View style={styles.modalInfoRow}>
                    <Ionicons name="location-outline" size={16} color={colors.textMuted} />
                    <View>
                      <Text style={styles.modalInfoMain}>{selectedPrivate.ville}</Text>
                      {selectedPrivate.adresse ? <Text style={styles.modalInfoSub}>{selectedPrivate.adresse}</Text> : null}
                    </View>
                  </View>
                ) : null}
                {selectedPrivate.description ? <Text style={styles.modalDesc}>{selectedPrivate.description}</Text> : null}
                {selectedPrivate.conversation_id ? (
                  <TouchableOpacity style={styles.joinBtn} onPress={() => openPrivateChat(selectedPrivate.conversation_id!)}>
                    <Text style={styles.joinBtnText}>💬 Ouvrir la discussion</Text>
                  </TouchableOpacity>
                ) : null}
                {selectedPrivate._role === 'organisateur' ? (
                  <>
                    <TouchableOpacity
                      style={[styles.cancelBtn, { marginTop: 10 }]}
                      onPress={() => { const id = selectedPrivate.id; setSelectedPrivate(null); openInviteModal(id); }}
                    >
                      <Ionicons name="person-add-outline" size={16} color="#e65100" />
                      <Text style={styles.cancelBtnText}>Inviter d'autres personnes</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.saveBtnFull, { marginTop: 10 }]}
                      onPress={() => openEditPriveModal(selectedPrivate)}
                    >
                      <Ionicons name="pencil-outline" size={16} color={colors.bordeaux} />
                      <Text style={styles.saveBtnFullText}>Modifier l'événement</Text>
                    </TouchableOpacity>
                  </>
                ) : null}
              </ScrollView>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* ── Modal créer événement privé ── */}
      <Modal visible={createPriveModal} animationType="slide" transparent onRequestClose={() => { setCreatePriveModal(false); resetPriveForm(); }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalSheet, { maxHeight: '95%' }]}>
              <View style={styles.createHeader}>
                <Text style={styles.createTitle}>🐾 Événement privé</Text>
                <TouchableOpacity onPress={() => { setCreatePriveModal(false); resetPriveForm(); }}>
                  <Ionicons name="close" size={22} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <ScrollView contentContainerStyle={styles.createForm} keyboardShouldPersistTaps="handled">
                <Text style={styles.submitNoteText}>Une discussion de groupe privée est créée automatiquement, jamais visible dans l'espace Événements public.</Text>

                <Text style={styles.fieldLabel}>Titre *</Text>
                <TextInput style={styles.input} value={pTitre} onChangeText={setPTitre} placeholder="Anniversaire de Rex, pique-nique entre amis…" placeholderTextColor={colors.textMuted} />

                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput style={[styles.input, styles.inputMulti]} value={pDescription} onChangeText={setPDescription} placeholder="Détails, ce qu'il faut prévoir…" placeholderTextColor={colors.textMuted} multiline />

                <Text style={styles.fieldLabel}>Date</Text>
                <TouchableOpacity style={styles.dateBtn} onPress={() => setPShowDatePicker(true)}>
                  <Ionicons name="calendar-outline" size={16} color={colors.bordeaux} />
                  <Text style={styles.dateBtnText}>{pDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</Text>
                </TouchableOpacity>
                {pShowDatePicker && (
                  <DateTimePicker
                    value={pDate} mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    minimumDate={new Date()}
                    onChange={(_, d) => { setPShowDatePicker(Platform.OS === 'ios'); if (d) setPDate(prev => { const n = new Date(prev); n.setFullYear(d.getFullYear(), d.getMonth(), d.getDate()); return n; }); }}
                  />
                )}

                <Text style={styles.fieldLabel}>Heure</Text>
                <TouchableOpacity style={styles.dateBtn} onPress={() => setPShowTimePicker(true)}>
                  <Ionicons name="time-outline" size={16} color={colors.bordeaux} />
                  <Text style={styles.dateBtnText}>{fmtHeure(pDate)}</Text>
                </TouchableOpacity>
                {pShowTimePicker && (
                  <DateTimePicker
                    value={pDate} mode="time"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={(_, d) => { setPShowTimePicker(Platform.OS === 'ios'); if (d) setPDate(prev => { const n = new Date(prev); n.setHours(d.getHours(), d.getMinutes()); return n; }); }}
                  />
                )}

                <Text style={styles.fieldLabel}>Ville</Text>
                <TextInput style={styles.input} value={pVille} onChangeText={setPVille} placeholder="Ex : Paris" placeholderTextColor={colors.textMuted} />

                <Text style={styles.fieldLabel}>Adresse (optionnel)</Text>
                <TextInput style={styles.input} value={pAdresse} onChangeText={setPAdresse} placeholder="Ex : 12 rue des Lilas" placeholderTextColor={colors.textMuted} />

                <Text style={styles.fieldLabel}>Photos (max {MAX_EVENT_PHOTOS}, optionnel)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 90 }} contentContainerStyle={{ flexDirection: 'row', gap: 10 }}>
                  {pPhotoUris.map((uri, idx) => (
                    <View key={idx} style={styles.photoThumb}>
                      <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                      <TouchableOpacity style={styles.photoRemove} onPress={() => setPPhotoUris(p => p.filter((_, i) => i !== idx))}>
                        <Ionicons name="close-circle" size={20} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  ))}
                  {pPhotoUris.length < MAX_EVENT_PHOTOS && (
                    <TouchableOpacity style={[styles.photoThumb, styles.photoAdd]} onPress={pickPrivateEventPhotos}>
                      <Ionicons name="camera-outline" size={24} color={colors.bordeaux} />
                      <Text style={styles.photoAddLabel}>Ajouter</Text>
                    </TouchableOpacity>
                  )}
                </ScrollView>

                <TouchableOpacity style={styles.submitBtn} onPress={submitPrivateEvent} disabled={savingPrive}>
                  {savingPrive ? <ActivityIndicator color={colors.ivory} /> : <Text style={styles.submitBtnText}>{uploadingPrivePhotos ? 'Envoi des photos…' : 'Créer et inviter'}</Text>}
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Modal modifier événement privé ── */}
      <Modal visible={editPriveModal} animationType="slide" transparent onRequestClose={() => setEditPriveModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalSheet, { maxHeight: '95%' }]}>
              <View style={styles.createHeader}>
                <Text style={styles.createTitle}>Modifier l'événement</Text>
                <TouchableOpacity onPress={() => setEditPriveModal(false)}>
                  <Ionicons name="close" size={22} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <ScrollView contentContainerStyle={styles.createForm} keyboardShouldPersistTaps="handled">
                <Text style={styles.fieldLabel}>Titre *</Text>
                <TextInput style={styles.input} value={ePTitre} onChangeText={setEPTitre} placeholderTextColor={colors.textMuted} />


                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput style={[styles.input, styles.inputMulti]} value={ePDescription} onChangeText={setEPDescription} placeholderTextColor={colors.textMuted} multiline />

                <Text style={styles.fieldLabel}>Date</Text>
                <TouchableOpacity style={styles.dateBtn} onPress={() => setEPShowDatePicker(true)}>
                  <Ionicons name="calendar-outline" size={16} color={colors.bordeaux} />
                  <Text style={styles.dateBtnText}>{ePDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</Text>
                </TouchableOpacity>
                {ePShowDatePicker && (
                  <DateTimePicker
                    value={ePDate} mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={(_, d) => { setEPShowDatePicker(Platform.OS === 'ios'); if (d) setEPDate(prev => { const n = new Date(prev); n.setFullYear(d.getFullYear(), d.getMonth(), d.getDate()); return n; }); }}
                  />
                )}

                <Text style={styles.fieldLabel}>Heure</Text>
                <TouchableOpacity style={styles.dateBtn} onPress={() => setEPShowTimePicker(true)}>
                  <Ionicons name="time-outline" size={16} color={colors.bordeaux} />
                  <Text style={styles.dateBtnText}>{fmtHeure(ePDate)}</Text>
                </TouchableOpacity>
                {ePShowTimePicker && (
                  <DateTimePicker
                    value={ePDate} mode="time"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={(_, d) => { setEPShowTimePicker(Platform.OS === 'ios'); if (d) setEPDate(prev => { const n = new Date(prev); n.setHours(d.getHours(), d.getMinutes()); return n; }); }}
                  />
                )}

                <Text style={styles.fieldLabel}>Ville</Text>
                <TextInput style={styles.input} value={ePVille} onChangeText={setEPVille} placeholderTextColor={colors.textMuted} />

                <Text style={styles.fieldLabel}>Adresse (optionnel)</Text>
                <TextInput style={styles.input} value={ePAdresse} onChangeText={setEPAdresse} placeholderTextColor={colors.textMuted} />

                <Text style={styles.fieldLabel}>Photos (max {MAX_EVENT_PHOTOS}, optionnel)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 90 }} contentContainerStyle={{ flexDirection: 'row', gap: 10 }}>
                  {ePPhotoUris.map((uri, idx) => (
                    <View key={idx} style={styles.photoThumb}>
                      <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                      <TouchableOpacity style={styles.photoRemove} onPress={() => setEPPhotoUris(p => p.filter((_, i) => i !== idx))}>
                        <Ionicons name="close-circle" size={20} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  ))}
                  {ePPhotoUris.length < MAX_EVENT_PHOTOS && (
                    <TouchableOpacity style={[styles.photoThumb, styles.photoAdd]} onPress={pickEditPrivePhotos}>
                      <Ionicons name="camera-outline" size={24} color={colors.bordeaux} />
                      <Text style={styles.photoAddLabel}>Ajouter</Text>
                    </TouchableOpacity>
                  )}
                </ScrollView>

                <TouchableOpacity style={styles.submitBtn} onPress={submitEditPrive} disabled={savingEditPrive}>
                  {savingEditPrive ? <ActivityIndicator color={colors.ivory} /> : <Text style={styles.submitBtnText}>Enregistrer</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={[styles.cancelBtn, { marginTop: 10 }]} onPress={deletePriveEvent}>
                  <Ionicons name="trash-outline" size={16} color="#e65100" />
                  <Text style={styles.cancelBtnText}>Supprimer l'événement</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Modal inviter des personnes ── */}
      <Modal visible={inviteModal} animationType="slide" transparent onRequestClose={() => setInviteModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalSheet, { maxHeight: '85%' }]}>
              <View style={styles.createHeader}>
                <Text style={styles.createTitle}>Inviter des personnes</Text>
                <TouchableOpacity onPress={() => setInviteModal(false)}>
                  <Ionicons name="close" size={22} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <View style={styles.createForm}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity style={[styles.priveModeBtn, inviteMode === 'amis' && styles.priveModeBtnActive]} onPress={() => setInviteMode('amis')}>
                    <Text style={[styles.priveModeBtnText, inviteMode === 'amis' && styles.priveModeBtnTextActive]}>Mes amis</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.priveModeBtn, inviteMode === 'tous' && styles.priveModeBtnActive]} onPress={() => setInviteMode('tous')}>
                    <Text style={[styles.priveModeBtnText, inviteMode === 'tous' && styles.priveModeBtnTextActive]}>Tous les membres</Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={[styles.input, { marginTop: 10 }]} value={inviteSearch} onChangeText={setInviteSearch}
                  placeholder="Rechercher par prénom ou pseudo…" placeholderTextColor={colors.textMuted}
                />
                {inviteVilles.length > 1 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }} contentContainerStyle={{ gap: 6 }}>
                    <TouchableOpacity style={[styles.villeChip, !inviteVilleFilter && styles.villeChipActive]} onPress={() => setInviteVilleFilter('')}>
                      <Text style={[styles.villeChipText, !inviteVilleFilter && styles.villeChipTextActive]}>Toutes les villes</Text>
                    </TouchableOpacity>
                    {inviteVilles.map(v => (
                      <TouchableOpacity key={v} style={[styles.villeChip, inviteVilleFilter === v && styles.villeChipActive]} onPress={() => setInviteVilleFilter(v)}>
                        <Text style={[styles.villeChipText, inviteVilleFilter === v && styles.villeChipTextActive]}>{v}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
                <View style={{ marginTop: 10, maxHeight: 260 }}>
                  {inviteListLoading ? (
                    <ActivityIndicator color={colors.terra} style={{ marginTop: 12 }} />
                  ) : inviteCandidatesCapped.length === 0 ? (
                    <Text style={styles.fieldSub}>
                      {inviteMode === 'amis' && !(myFriends || []).length ? 'Tu ne suis encore personne — passe sur "Tous les membres".' : 'Aucun résultat'}
                    </Text>
                  ) : (
                    <FlatList
                      data={inviteCandidatesCapped}
                      keyExtractor={p => p.id}
                      renderItem={({ item: p }) => (
                        <TouchableOpacity style={styles.inviteResultRow} onPress={() => selectInviteUser(p)}>
                          {p.avatar_url ? <Image source={{ uri: p.avatar_url }} style={styles.inviteAvatar} /> : (
                            <View style={[styles.inviteAvatar, styles.inviteAvatarFallback]}><Text style={styles.inviteAvatarLetter}>{(p.prenom || p.username || '?')[0]?.toUpperCase()}</Text></View>
                          )}
                          <View>
                            <Text style={styles.pickerRowText}>{p.prenom || '—'}</Text>
                            <Text style={styles.fieldSub}>@{p.username || 'sans pseudo'}{p.ville ? ` · ${p.ville}` : ''}</Text>
                          </View>
                        </TouchableOpacity>
                      )}
                      ListFooterComponent={inviteCandidates.length > 40 ? (
                        <Text style={[styles.fieldSub, { textAlign: 'center', paddingVertical: 6 }]}>+{inviteCandidates.length - 40} autres — affine ta recherche</Text>
                      ) : null}
                    />
                  )}
                </View>
                {inviteSelected.length > 0 && (
                  <View style={styles.raceChipsWrap}>
                    {inviteSelected.map(p => (
                      <View key={p.id} style={styles.raceChipMulti}>
                        <Text style={styles.raceChipMultiText}>@{p.username || p.prenom || '?'}</Text>
                        <TouchableOpacity onPress={() => removeInviteUser(p.id)}>
                          <Ionicons name="close" size={13} color={colors.bordeaux} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
                <TouchableOpacity style={[styles.submitBtn, { marginTop: 16 }]} onPress={sendInvitations} disabled={sendingInvites}>
                  {sendingInvites ? <ActivityIndicator color={colors.ivory} /> : <Text style={styles.submitBtnText}>Envoyer les invitations</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={[styles.dateBtn, { justifyContent: 'center', marginTop: 8 }]} onPress={() => setInviteModal(false)}>
                  <Text style={styles.dateBtnText}>Passer, inviter plus tard</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Modal détail événement ── */}
      <Modal visible={!!selectedEvent} animationType="slide" transparent onRequestClose={() => setSelectedEvent(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <TouchableOpacity style={styles.modalClose} onPress={() => setSelectedEvent(null)}>
              <Ionicons name="close" size={22} color={colors.textMid} />
            </TouchableOpacity>
            {selectedEvent && (() => {
              const date = new Date(selectedEvent.date_heure);
              const dateFin = selectedEvent.date_heure_fin ? new Date(selectedEvent.date_heure_fin) : null;
              const isFull = !!(selectedEvent.max_participants && (selectedEvent.nb_inscrits || 0) >= selectedEvent.max_participants && !selectedEvent.je_suis_inscrit);
              const allPhotos = selectedEvent.images?.length ? selectedEvent.images : (selectedEvent.image_url ? [selectedEvent.image_url] : []);
              return (
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
                  {allPhotos.length > 0 && (
                    <View>
                      <ScrollView
                        horizontal pagingEnabled showsHorizontalScrollIndicator={false}
                        contentContainerStyle={{ flexDirection: 'row' }}
                        onMomentumScrollEnd={ev => setModalPhotoIndex(Math.round(ev.nativeEvent.contentOffset.x / Dimensions.get('window').width))}
                      >
                        {allPhotos.map((url, idx) => (
                          <Image key={idx} source={{ uri: url }} style={[styles.modalImg, { width: Dimensions.get('window').width }]} />
                        ))}
                      </ScrollView>
                      {allPhotos.length > 1 && (
                        <View style={styles.photoDotsRow}>
                          {allPhotos.map((_, idx) => (
                            <View key={idx} style={[styles.photoDot, idx === modalPhotoIndex && styles.photoDotActive]} />
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                  <View style={styles.modalContent}>
                    <Text style={styles.modalTitle}>{selectedEvent.titre}</Text>
                    <View style={styles.modalBadges}>
                      {selectedEvent.payant
                        ? <View style={styles.paidBadge}><Text style={styles.paidText}>{selectedEvent.prix ? `${selectedEvent.prix} €` : 'Payant'}</Text></View>
                        : <View style={styles.freeBadge}><Text style={styles.freeText}>✓ Gratuit</Text></View>}
                      {selectedEvent.races && selectedEvent.races.length > 0 && (
                        <View style={styles.raceBadge}><Text style={styles.raceText}>{selectedEvent.races.join(', ')}</Text></View>
                      )}
                      {!selectedEvent.site_web && selectedEvent.nb_inscrits !== undefined && (
                        <View style={styles.countBadge}>
                          <Text style={styles.countText}>{selectedEvent.nb_inscrits}{selectedEvent.max_participants ? `/${selectedEvent.max_participants}` : ''} inscrits</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.modalInfoRow}>
                      <Ionicons name="calendar-outline" size={16} color={colors.textMuted} />
                      <View>
                        <Text style={styles.modalInfoMain}>{date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</Text>
                        <Text style={styles.modalInfoSub}>
                          {dateFin
                            ? (dateFin.toDateString() === date.toDateString()
                              ? `de ${fmtHeure(date)} à ${fmtHeure(dateFin)}`
                              : `à ${fmtHeure(date)} — jusqu'au ${dateFin.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} à ${fmtHeure(dateFin)}`)
                            : `à ${fmtHeure(date)}`}
                        </Text>
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
                      <Ionicons name={selectedEvent.site_web ? 'globe-outline' : 'person-outline'} size={16} color={colors.textMuted} />
                      <Text style={styles.modalInfoSub}>
                        {selectedEvent.site_web ? 'Événement organisé par un tiers' : `Organisé par @${selectedEvent.profils?.username || 'anonyme'}`}
                      </Text>
                    </View>
                    {selectedEvent.description ? <Text style={styles.modalDesc}>{selectedEvent.description}</Text> : null}

                    {selectedEvent.partenaires_mentions && selectedEvent.partenaires_mentions.length > 0 ? (
                      <View style={{ marginBottom: 16 }}>
                        <Text style={styles.mentionsLabel}>Avec la participation de</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                          {selectedEvent.partenaires_mentions.map((m, i) => (
                            <TouchableOpacity
                              key={i}
                              style={styles.mentionChip}
                              onPress={() => {
                                if (m.type === 'instagram' && m.url) Linking.openURL(m.url);
                                else navigation.navigate('Services');
                              }}
                            >
                              {m.logo_url ? <Image source={{ uri: m.logo_url }} style={styles.mentionLogo} /> : null}
                              <Text style={styles.mentionChipText}>{m.type === 'instagram' ? `📷 ${m.nom}` : m.nom}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    ) : null}

                    {selectedEvent.site_web ? (
                      <>
                        {selectedEvent.code_promo ? (
                          <View style={styles.promoBox}>
                            <Text style={styles.promoLabel}>Code promo à utiliser sur leur site</Text>
                            <Text style={styles.promoCode}>{selectedEvent.code_promo}</Text>
                          </View>
                        ) : null}
                        <TouchableOpacity style={styles.joinBtn} onPress={() => Linking.openURL(selectedEvent.site_web!)}>
                          <Text style={styles.joinBtnText}>Voir le site officiel</Text>
                        </TouchableOpacity>
                        <Text style={styles.externalNote}>Inscription non disponible sur l'app — organisé par un tiers</Text>
                      </>
                    ) : isFull ? (
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
                    <TouchableOpacity style={styles.saveBtnFull} onPress={() => toggleFavori(selectedEvent.id, !selectedEvent.est_enregistre)}>
                      <Ionicons name={selectedEvent.est_enregistre ? 'bookmark' : 'bookmark-outline'} size={16} color={colors.bordeaux} />
                      <Text style={styles.saveBtnFullText}>{selectedEvent.est_enregistre ? 'Enregistré' : 'Enregistrer pour plus tard'}</Text>
                    </TouchableOpacity>
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

                <Text style={styles.fieldLabel}>Date et heure de fin (optionnel)</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity style={[styles.dateBtn, { flex: 1 }]} onPress={() => setShowDateFinPicker(true)}>
                    <Ionicons name="calendar-outline" size={16} color={colors.bordeaux} />
                    <Text style={styles.dateBtnText}>{eventDateFin ? eventDateFin.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : 'Date'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.dateBtn, { flex: 1 }]} onPress={() => setShowTimeFinPicker(true)}>
                    <Ionicons name="time-outline" size={16} color={colors.bordeaux} />
                    <Text style={styles.dateBtnText}>{eventDateFin ? fmtHeure(eventDateFin) : 'Heure'}</Text>
                  </TouchableOpacity>
                  {eventDateFin && (
                    <TouchableOpacity style={styles.dateBtn} onPress={() => setEventDateFin(null)}>
                      <Ionicons name="close" size={16} color={colors.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>
                {showDateFinPicker && (
                  <DateTimePicker
                    value={eventDateFin || eventDate} mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    minimumDate={eventDate}
                    onChange={(_, d) => { setShowDateFinPicker(Platform.OS === 'ios'); if (d) setEventDateFin(prev => { const n = new Date(prev || eventDate); n.setFullYear(d.getFullYear(), d.getMonth(), d.getDate()); return n; }); }}
                  />
                )}
                {showTimeFinPicker && (
                  <DateTimePicker
                    value={eventDateFin || eventDate} mode="time"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={(_, d) => { setShowTimeFinPicker(Platform.OS === 'ios'); if (d) setEventDateFin(prev => { const n = new Date(prev || eventDate); n.setHours(d.getHours(), d.getMinutes()); return n; }); }}
                  />
                )}

                <Text style={styles.fieldLabel}>Photos (max {MAX_EVENT_PHOTOS})</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 90 }} contentContainerStyle={{ flexDirection: 'row', gap: 10 }}>
                  {photoUris.map((uri, idx) => (
                    <View key={idx} style={styles.photoThumb}>
                      <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                      <TouchableOpacity style={styles.photoRemove} onPress={() => setPhotoUris(p => p.filter((_, i) => i !== idx))}>
                        <Ionicons name="close-circle" size={20} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  ))}
                  {photoUris.length < MAX_EVENT_PHOTOS && (
                    <TouchableOpacity style={[styles.photoThumb, styles.photoAdd]} onPress={pickEventPhotos}>
                      <Ionicons name="camera-outline" size={24} color={colors.bordeaux} />
                      <Text style={styles.photoAddLabel}>Ajouter</Text>
                    </TouchableOpacity>
                  )}
                </ScrollView>

                <Text style={styles.fieldLabel}>Ville *</Text>
                <TextInput style={styles.input} value={ville} onChangeText={setVille} placeholder="Ex : Paris" placeholderTextColor={colors.textMuted} />

                <Text style={styles.fieldLabel}>Adresse (optionnel)</Text>
                <TextInput style={styles.input} value={adresse} onChangeText={setAdresse} placeholder="Ex : Bois de Vincennes, entrée Nord" placeholderTextColor={colors.textMuted} />

                <Text style={styles.fieldLabel}>Race(s) concernée(s) (optionnel)</Text>
                <TouchableOpacity style={styles.dateBtn} onPress={() => { setRaceCreateSearch(''); setRaceCreateModalOpen(true); }}>
                  <Ionicons name="paw-outline" size={16} color={colors.bordeaux} />
                  <Text style={styles.dateBtnText}>{selectedRaces.length ? `${selectedRaces.length} race(s) sélectionnée(s)` : 'Choisir une ou plusieurs races'}</Text>
                </TouchableOpacity>
                {selectedRaces.length > 0 && (
                  <View style={styles.raceChipsWrap}>
                    {selectedRaces.map(r => (
                      <View key={r} style={styles.raceChipMulti}>
                        <Text style={styles.raceChipMultiText}>{r}</Text>
                        <TouchableOpacity onPress={() => toggleSelectedRace(r)}>
                          <Ionicons name="close" size={13} color={colors.bordeaux} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}

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
                  {saving
                    ? <ActivityIndicator color={colors.ivory} />
                    : <Text style={styles.submitBtnText}>{uploadingPhotos ? 'Envoi des photos…' : "Soumettre l'événement"}</Text>}
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

  dropdownFiltersRow: { flexDirection: 'row', gap: 8, marginHorizontal: 16, marginBottom: 8, flexWrap: 'wrap' },
  dropdownFilterBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20,
    backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, maxWidth: 220,
  },
  dropdownFilterBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.bordeaux },
  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  pickerSheet: { backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '70%', padding: 20 },
  pickerTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 17, color: colors.bordeaux, marginBottom: 12 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickerRowText: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux },
  pickerRowTextActive: { fontFamily: 'DMSans_500Medium' },
  raceChipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  raceChipMulti: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.ivoryLight,
    borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingVertical: 5, paddingLeft: 12, paddingRight: 8,
  },
  raceChipMultiText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.bordeaux },

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
  pendingBadge: { backgroundColor: '#fff3e0', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  pendingText: { fontFamily: 'DMSans_500Medium', fontSize: 10, color: '#e65100' },
  photoCountBadge: {
    position: 'absolute', bottom: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3,
  },
  photoCountText: { fontFamily: 'DMSans_500Medium', fontSize: 10, color: '#fff' },
  saveBtn: {
    position: 'absolute', top: 10, right: 10, width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center',
  },
  saveBtnNoImg: { backgroundColor: colors.ivoryPale, borderWidth: 1, borderColor: colors.border },
  paidBadge: { backgroundColor: '#fce4ec', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  paidText: { fontFamily: 'DMSans_500Medium', fontSize: 10, color: '#c62828' },
  featuredBadge: { backgroundColor: colors.terra, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  featuredText: { fontFamily: 'DMSans_600SemiBold', fontSize: 10, color: '#fff' },
  freeBadge: { backgroundColor: '#e8f5e9', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  freeText: { fontFamily: 'DMSans_500Medium', fontSize: 10, color: '#2e7d32' },
  raceBadge: { backgroundColor: 'rgba(196,105,58,0.12)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  raceText: { fontFamily: 'DMSans_500Medium', fontSize: 10, color: colors.terra },
  mentionsLabel: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  mentionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.ivoryPale,
    borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingVertical: 5, paddingHorizontal: 12,
  },
  mentionChipText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.bordeaux },
  mentionLogo: { width: 20, height: 20, borderRadius: 6 },
  countBadge: { backgroundColor: colors.ivoryPale, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  countText: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },

  // FAB
  fab: {
    position: 'absolute', bottom: 28, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.bordeaux, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.bordeaux, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 8,
  },
  fabSecondary: {
    position: 'absolute', bottom: 94, right: 26,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.terra, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.terra, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 7,
  },

  // Événements privés
  privateSection: { marginBottom: 18, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  privateSectionTitle: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8, marginTop: 4 },
  privateCard: { backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10 },
  privateCardTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 15, color: colors.bordeaux, marginTop: 8, marginBottom: 4 },
  privateCardMeta: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, marginBottom: 2 },
  lockBadge: { alignSelf: 'flex-start', backgroundColor: 'rgba(61,26,26,0.08)', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 3 },
  lockBadgeText: { fontFamily: 'DMSans_600SemiBold', fontSize: 10, color: colors.bordeaux },
  inviteActionsRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  acceptBtn: { flex: 1, backgroundColor: colors.bordeaux, borderRadius: 10, paddingVertical: 9, alignItems: 'center' },
  acceptBtnText: { fontFamily: 'DMSans_600SemiBold', fontSize: 13, color: colors.ivory },
  refuseBtn: { flex: 1, backgroundColor: colors.ivoryLight, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 9, alignItems: 'center' },
  refuseBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.textMuted },
  inviteResultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 4 },
  inviteAvatar: { width: 32, height: 32, borderRadius: 16 },
  inviteAvatarFallback: { backgroundColor: colors.ivoryLight, alignItems: 'center', justifyContent: 'center' },
  inviteAvatarLetter: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 13, color: colors.bordeaux },
  priveModeBtn: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 10, alignItems: 'center', backgroundColor: colors.ivoryPale },
  priveModeBtnActive: { backgroundColor: colors.bordeaux, borderColor: colors.bordeaux },
  priveModeBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.textMuted },
  priveModeBtnTextActive: { color: colors.ivory },
  villeChip: { borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: colors.ivoryPale },
  villeChipActive: { backgroundColor: colors.bordeaux, borderColor: colors.bordeaux },
  villeChipText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.textMuted },
  villeChipTextActive: { color: colors.ivory },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.white, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '90%' },
  modalClose: { position: 'absolute', top: 14, right: 16, zIndex: 10, padding: 4 },
  modalImg: { width: '100%', height: 210, resizeMode: 'cover' },
  photoDotsRow: {
    position: 'absolute', bottom: 10, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', gap: 6,
  },
  photoDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' },
  photoDotActive: { backgroundColor: '#fff', width: 16 },
  modalContent: { padding: 20 },
  modalTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 21, color: colors.bordeaux, lineHeight: 28, marginBottom: 12 },
  modalBadges: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 16 },
  modalInfoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  modalInfoMain: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.textMid },
  modalInfoSub: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted },
  modalDesc: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.textMid, lineHeight: 22, marginBottom: 20 },
  promoBox: {
    backgroundColor: colors.terra + '14', borderWidth: 1, borderColor: colors.terra, borderStyle: 'dashed',
    borderRadius: 12, padding: 12, alignItems: 'center', marginTop: 8,
  },
  promoLabel: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, marginBottom: 2 },
  promoCode: { fontFamily: 'DMSans_600SemiBold', fontSize: 17, color: colors.terra, letterSpacing: 1 },
  joinBtn: { backgroundColor: colors.bordeaux, borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8 },
  joinBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.ivory },
  externalNote: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: 8 },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#fff3e0', borderRadius: 14, padding: 15, marginTop: 8, borderWidth: 1, borderColor: '#ffcc80' },
  cancelBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: '#e65100' },
  fullBadge: { backgroundColor: colors.ivoryPale, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8 },
  fullText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted },
  saveBtnFull: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 13, marginTop: 10,
  },
  saveBtnFullText: { fontFamily: 'DMSans_500Medium', fontSize: 13.5, color: colors.bordeaux },

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
  photoThumb: { width: 80, height: 80, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.border },
  photoAdd: {
    alignItems: 'center', justifyContent: 'center', gap: 4,
    borderWidth: 1.5, borderColor: colors.bordeaux, borderStyle: 'dashed', backgroundColor: 'transparent',
  },
  photoAddLabel: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.bordeaux },
  photoRemove: { position: 'absolute', top: 3, right: 3, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 10 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  submitNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 16, backgroundColor: colors.ivoryLight, padding: 12, borderRadius: 10 },
  submitNoteText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, flex: 1, lineHeight: 17 },
  submitBtn: { backgroundColor: colors.bordeaux, borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 12 },
  submitBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.ivory },
});
