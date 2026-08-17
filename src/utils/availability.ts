// Porte la logique de calcul de creneaux de carte.html (updateBookingSlots) en TS.
// Convention disponibilites.jour : 0=lundi...6=dimanche (voir espace-pro.html JOURS).

export type Disponibilite = { jour: number; heure_debut: string; heure_fin: string };
export type ReservationSlot = { date: string; heure_debut: string };

export function weekdayOf(dateStr: string): number {
  const jsDay = new Date(`${dateStr}T12:00:00`).getDay(); // 0=dimanche
  return (jsDay + 6) % 7;
}

export function computeSlots(
  dateStr: string,
  dureeMinutes: number,
  disponibilites: Disponibilite[],
  reservations: ReservationSlot[]
): { slot: string; pris: boolean }[] {
  const jour = weekdayOf(dateStr);
  const dispo = disponibilites.find((d) => d.jour === jour);
  if (!dispo) return [];

  const [hDeb, mDeb] = dispo.heure_debut.slice(0, 5).split(':').map(Number);
  const [hFin, mFin] = dispo.heure_fin.slice(0, 5).split(':').map(Number);
  const end = hFin * 60 + mFin;

  const prisSet = new Set(
    reservations.filter((r) => r.date === dateStr).map((r) => r.heure_debut.slice(0, 5))
  );

  const slots: { slot: string; pris: boolean }[] = [];
  let cur = hDeb * 60 + mDeb;
  while (cur + dureeMinutes <= end) {
    const h = String(Math.floor(cur / 60)).padStart(2, '0');
    const m = String(cur % 60).padStart(2, '0');
    const slot = `${h}:${m}`;
    slots.push({ slot, pris: prisSet.has(slot) });
    cur += dureeMinutes;
  }
  return slots;
}
