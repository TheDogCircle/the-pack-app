// Un evenement reste visible toute la journee du jour J (les participants ont
// besoin de l'adresse et des infos pendant qu'il a lieu), et jusqu'a sa fin
// s'il dure plusieurs jours. Avant : filtre date_heure >= maintenant, donc un
// event a 10 h disparaissait de l'app a 10 h pile.

function debutDuJour(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Filtre PostgREST a passer a .or(...)
export function filtreEvenementsVisibles(): string {
  return `date_heure.gte.${debutDuJour().toISOString()},date_heure_fin.gte.${new Date().toISOString()}`;
}

export function estEvenementVisible(e: { date_heure: string; date_heure_fin?: string | null }): boolean {
  if (new Date(e.date_heure) >= debutDuJour()) return true;
  return !!e.date_heure_fin && new Date(e.date_heure_fin) >= new Date();
}
