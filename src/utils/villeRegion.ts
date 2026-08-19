export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export const REGIONS = [
  'Île-de-France', 'Auvergne-Rhône-Alpes', 'Provence-Alpes-Côte d\'Azur', 'Occitanie',
  'Nouvelle-Aquitaine', 'Hauts-de-France', 'Grand Est', 'Pays de la Loire', 'Bretagne',
  'Normandie', 'Bourgogne-Franche-Comté', 'Centre-Val de Loire', 'Corse',
  'Guadeloupe', 'Martinique', 'Guyane', 'La Réunion', 'Mayotte',
] as const;

// Villes principales par region — couverture des prefectures, sous-prefectures et
// grandes agglomerations. Une ville non presente ici tombe dans le groupe "Autres".
const VILLE_TO_REGION: Record<string, string> = {};
function add(region: string, villes: string[]) {
  for (const v of villes) VILLE_TO_REGION[normalizeText(v)] = region;
}

add('Île-de-France', [
  'Paris', 'Boulogne-Billancourt', 'Saint-Denis', 'Argenteuil', 'Montreuil', 'Créteil',
  'Versailles', 'Vitry-sur-Seine', 'Nanterre', 'Colombes', 'Aulnay-sous-Bois', 'Rueil-Malmaison',
  'Aubervilliers', 'Champigny-sur-Marne', 'Saint-Maur-des-Fossés', 'Drancy', 'Issy-les-Moulineaux',
  'Levallois-Perret', 'Noisy-le-Grand', 'Antony', 'Neuilly-sur-Seine', 'Sarcelles', 'Ivry-sur-Seine',
  'Clichy', 'Cergy', 'Pantin', 'Meaux', 'Melun', 'Fontainebleau', 'Évry', 'Massy', 'Vincennes',
  'Saint-Germain-en-Laye', 'Poissy', 'Chatou', 'Maisons-Laffitte', 'Corbeil-Essonnes', 'Mantes-la-Jolie',
]);
add('Auvergne-Rhône-Alpes', [
  'Lyon', 'Villeurbanne', 'Grenoble', 'Saint-Étienne', 'Clermont-Ferrand', 'Annecy', 'Chambéry',
  'Valence', 'Vénissieux', 'Bourg-en-Bresse', 'Roanne', 'Annemasse', 'Voiron', 'Aix-les-Bains',
  'Montélimar', 'Vienne', 'Thonon-les-Bains', 'Chalon-sur-Saône', 'Moulins', 'Aurillac', 'Le Puy-en-Velay',
  'Privas', 'Bourgoin-Jallieu', 'Oyonnax', 'Chamonix', 'Megève', 'Annonay',
]);
add('Provence-Alpes-Côte d\'Azur', [
  'Marseille', 'Nice', 'Toulon', 'Aix-en-Provence', 'Cannes', 'Antibes', 'Avignon', 'La Seyne-sur-Mer',
  'Hyères', 'Fréjus', 'Arles', 'Gap', 'Digne-les-Bains', 'Grasse', 'Draguignan', 'Salon-de-Provence',
  'Martigues', 'Menton', 'Manosque', 'Vence', 'Saint-Raphaël', 'Cassis', 'Cavaillon', 'Istres',
  'Sisteron', 'Briançon',
]);
add('Occitanie', [
  'Toulouse', 'Montpellier', 'Nîmes', 'Perpignan', 'Béziers', 'Albi', 'Carcassonne', 'Montauban',
  'Narbonne', 'Sète', 'Castres', 'Rodez', 'Tarbes', 'Mende', 'Auch', 'Cahors', 'Nîmes', 'Foix',
  'Colomiers', 'Blagnac', 'Alès', 'Millau', 'Agde', 'Lourdes',
]);
add('Nouvelle-Aquitaine', [
  'Bordeaux', 'Limoges', 'Poitiers', 'Pau', 'La Rochelle', 'Angoulême', 'Niort', 'Bayonne', 'Biarritz',
  'Périgueux', 'Brive-la-Gaillarde', 'Agen', 'Mont-de-Marsan', 'Mérignac', 'Pessac', 'Anglet',
  'Rochefort', 'Saintes', 'Guéret', 'Tulle', 'Bergerac', 'Arcachon',
]);
add('Hauts-de-France', [
  'Lille', 'Amiens', 'Roubaix', 'Tourcoing', 'Dunkerque', 'Calais', 'Beauvais', 'Saint-Quentin',
  'Compiègne', 'Arras', 'Boulogne-sur-Mer', 'Laon', 'Soissons', 'Valenciennes', 'Douai', 'Béthune',
  'Cambrai', 'Le Touquet', 'Villeneuve-d\'Ascq', 'Maubeuge',
]);
add('Grand Est', [
  'Strasbourg', 'Reims', 'Metz', 'Mulhouse', 'Nancy', 'Colmar', 'Troyes', 'Charleville-Mézières',
  'Châlons-en-Champagne', 'Épinal', 'Verdun', 'Sedan', 'Haguenau', 'Sélestat', 'Bar-le-Duc',
  'Saint-Dizier', 'Thionville', 'Forbach', 'Vitry-le-François',
]);
add('Pays de la Loire', [
  'Nantes', 'Angers', 'Le Mans', 'Saint-Nazaire', 'Cholet', 'Laval', 'La Roche-sur-Yon', 'Saumur',
  'Sablé-sur-Sarthe', 'Les Sables-d\'Olonne', 'Fontenay-le-Comte', 'Château-Gontier',
]);
add('Bretagne', [
  'Rennes', 'Brest', 'Quimper', 'Lorient', 'Vannes', 'Saint-Malo', 'Saint-Brieuc', 'Concarneau',
  'Fougères', 'Lannion', 'Dinard', 'Douarnenez', 'Auray', 'Pontivy',
]);
add('Normandie', [
  'Rouen', 'Le Havre', 'Caen', 'Cherbourg-en-Cotentin', 'Évreux', 'Dieppe', 'Alençon', 'Saint-Lô',
  'Lisieux', 'Vernon', 'Bayeux', 'Deauville', 'Honfleur', 'Granville',
]);
add('Bourgogne-Franche-Comté', [
  'Dijon', 'Besançon', 'Belfort', 'Chalon-sur-Saône', 'Nevers', 'Auxerre', 'Mâcon', 'Montceau-les-Mines',
  'Sens', 'Dole', 'Vesoul', 'Lons-le-Saunier', 'Beaune', 'Montbéliard',
]);
add('Centre-Val de Loire', [
  'Orléans', 'Tours', 'Bourges', 'Blois', 'Chartres', 'Châteauroux', 'Vierzon', 'Dreux', 'Vendôme',
  'Montargis', 'Loches', 'Amboise',
]);
add('Corse', ['Ajaccio', 'Bastia', 'Porto-Vecchio', 'Corte', 'Calvi', 'Bonifacio', 'Propriano']);
add('Guadeloupe', ['Pointe-à-Pitre', 'Basse-Terre', 'Les Abymes', 'Le Gosier', 'Sainte-Anne']);
add('Martinique', ['Fort-de-France', 'Le Lamentin', 'Schœlcher', 'Le Robert']);
add('Guyane', ['Cayenne', 'Saint-Laurent-du-Maroni', 'Kourou']);
add('La Réunion', ['Saint-Pierre', 'Le Tampon', 'Saint-André']);
add('Mayotte', ['Mamoudzou', 'Koungou', 'Dzaoudzi']);

export function getRegion(ville: string | null | undefined): string {
  if (!ville) return 'Autres';
  return VILLE_TO_REGION[normalizeText(ville)] || 'Autres';
}
