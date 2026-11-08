import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

// Position approximative (arrondie a ~1 km) utilisee par le serveur pour les
// notifications "nouveau lieu pres de toi". Stockee dans une table privee
// (positions_notif), jamais visible des autres membres. Envoyee au plus une
// fois par jour, ou plus tot si le membre s'est deplace de plus de 5 km.

const CLE = 'position_notif_derniere';

export async function memoriserPositionNotif(lat: number, lng: number): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId || !isFinite(lat) || !isFinite(lng)) return;
    const arrondi = { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };

    const brut = await AsyncStorage.getItem(CLE);
    if (brut) {
      const der = JSON.parse(brut) as { lat: number; lng: number; at: number; userId: string };
      const recent = Date.now() - der.at < 24 * 3600 * 1000;
      const bouge = Math.abs(der.lat - arrondi.lat) > 0.05 || Math.abs(der.lng - arrondi.lng) > 0.07;
      if (der.userId === userId && recent && !bouge) return;
    }

    const { error } = await supabase.from('positions_notif').upsert(
      { user_id: userId, ...arrondi, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
    if (!error) await AsyncStorage.setItem(CLE, JSON.stringify({ ...arrondi, at: Date.now(), userId }));
  } catch {
    // jamais bloquant
  }
}
