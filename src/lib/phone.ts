// Normalise un numero de telephone pour permettre de comparer un numero
// saisi a la main (Reglages) avec un numero lu depuis le carnet de contacts,
// quel que soit leur format d'origine ("06 12 34 56 78", "+33612345678",
// "0033 6 12 34 56 78"...). Marche public francophone : on ne garde que les
// 9 derniers chiffres (numero local sans le 0 initial ni l'indicatif pays).
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 9) return null;
  return digits.slice(-9);
}
