import { useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Ne pas appeler getSession() en parallele : au demarrage a froid, son
    // resolve peut devancer l'hydratation depuis AsyncStorage et renvoyer
    // session=null un instant avant que onAuthStateChange ne livre la vraie
    // session -- ce flash fait monter puis demonter/remonter NavigationContainer
    // (onReady se redeclenche), ce qui perd la navigation deja appliquee au
    // tap d'une notification en cold start. onAuthStateChange emet deja un
    // evenement INITIAL_SESSION avec la session hydratee des l'abonnement :
    // seule source necessaire, session et loading changent ensemble.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return { session, loading };
}
