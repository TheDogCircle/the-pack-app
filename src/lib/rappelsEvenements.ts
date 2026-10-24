import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';
import { estEvenementVisible } from '../utils/evenementsVisibles';

// Rappels LOCAUX pour les evenements enregistres (evenements_favoris) : programmes
// sur le telephone au moment de l'enregistrement, donc independants des pushes
// serveur (qui ne s'affichent pas sur iPhone pour l'instant). Les participants
// (table participations) recoivent deja les rappels serveur J-1 / jour J de
// l'edge function event-reminders : pas de rappel local pour eux, sinon doublon.
//
// Le type 'event_reminder' est deja route par navigation/index.tsx vers l'onglet
// Events et ouvre l'evenement (data.eventId).

type EvenementRappel = {
  id: string;
  titre: string;
  date_heure: string;
  ville?: string | null;
  adresse?: string | null;
};

const PREFIXE = 'event-rappel-';

function lieu(e: EvenementRappel) {
  return e.adresse || e.ville || '';
}

async function programmer(identifier: string, date: Date, title: string, body: string, eventId: string) {
  if (date.getTime() <= Date.now() + 60_000) return;
  await Notifications.scheduleNotificationAsync({
    identifier,
    content: { title, body, data: { type: 'event_reminder', eventId } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
  });
}

export async function programmerRappelsEvenement(e: EvenementRappel) {
  try {
    await annulerRappelsEvenement(e.id);
    const debut = new Date(e.date_heure);
    const heure = debut.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const ou = lieu(e) ? ` · ${lieu(e)}` : '';

    const veille = new Date(debut);
    veille.setDate(veille.getDate() - 1);
    veille.setHours(18, 0, 0, 0);
    await programmer(`${PREFIXE}${e.id}-veille`, veille, `Demain : ${e.titre} 🐾`, `Rendez-vous à ${heure}${ou}`, e.id);

    const avant = new Date(debut.getTime() - 2 * 3600_000);
    await programmer(`${PREFIXE}${e.id}-jour`, avant, `C'est bientôt : ${e.titre}`, `Dans 2 h, à ${heure}${ou}`, e.id);
  } catch {
    // Permission refusee ou date invalide : pas de rappel, jamais bloquant.
  }
}

export async function annulerRappelsEvenement(eventId: string) {
  try {
    await Promise.all([
      Notifications.cancelScheduledNotificationAsync(`${PREFIXE}${eventId}-veille`),
      Notifications.cancelScheduledNotificationAsync(`${PREFIXE}${eventId}-jour`),
    ]);
  } catch {}
}

// Recale tous les rappels sur la liste actuelle des evenements enregistres
// (events enregistres avant cette version, date modifiee, enregistrement retire
// depuis un autre appareil...). Idempotent.
export async function synchroniserRappelsEvenements(enregistres: EvenementRappel[]) {
  try {
    const prevus = await Notifications.getAllScheduledNotificationsAsync();
    const garder = new Set(enregistres.map(e => e.id));
    await Promise.all(
      prevus
        .filter(n => n.identifier.startsWith(PREFIXE))
        .filter(n => !garder.has(String((n.content.data as any)?.eventId)))
        .map(n => Notifications.cancelScheduledNotificationAsync(n.identifier)),
    );
    for (const e of enregistres) await programmerRappelsEvenement(e);
  } catch {}
}

export type MonEvenement = EvenementRappel & {
  date_heure_fin: string | null;
  statut: 'inscrit' | 'enregistre';
};

// Evenements a venir (encore visibles, cf. utils/evenementsVisibles) auxquels
// l'utilisateur participe ou qu'il a enregistres. Sert a "Mes rendez-vous" et
// a la synchronisation des rappels locaux.
export async function chargerMesEvenementsAVenir(userId: string): Promise<MonEvenement[]> {
  const champs = 'event_id, evenements(id, titre, date_heure, date_heure_fin, ville, adresse, actif, valide)';
  const [{ data: parts }, { data: favs }] = await Promise.all([
    supabase.from('participations').select(champs).eq('user_id', userId),
    supabase.from('evenements_favoris').select(champs).eq('user_id', userId),
  ]);
  const parId = new Map<string, MonEvenement>();
  const ajouter = (rows: any[] | null, statut: MonEvenement['statut']) => {
    (rows || []).forEach(r => {
      const e = r.evenements;
      if (!e || e.actif === false || e.valide === false || !estEvenementVisible(e)) return;
      if (parId.has(e.id) && statut === 'enregistre') return;
      parId.set(e.id, {
        id: e.id, titre: e.titre, date_heure: e.date_heure, date_heure_fin: e.date_heure_fin,
        ville: e.ville, adresse: e.adresse, statut,
      });
    });
  };
  ajouter(parts as any[], 'inscrit');
  ajouter(favs as any[], 'enregistre');
  return [...parId.values()].sort((a, b) => a.date_heure.localeCompare(b.date_heure));
}

export async function synchroniserRappelsUtilisateur(userId: string) {
  try {
    const events = await chargerMesEvenementsAVenir(userId);
    await synchroniserRappelsEvenements(events.filter(e => e.statut === 'enregistre'));
  } catch {}
}
