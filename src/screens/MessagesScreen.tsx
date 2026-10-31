import React, { useEffect, useState } from 'react';
import MessagerieScreen from './MessagerieScreen';
import { mapNavigation } from '../lib/mapNavigation';

// Ecran "Messages" ouvert par la bulle de l'en-tete, une notification de message,
// le bouton "Message" d'un profil ou le salon d'un evenement prive.
export default function MessagesScreen({ route }: { route: any }) {
  const [pending, setPending] = useState<string | null>(
    () => route?.params?.conversationId ?? mapNavigation.consumeConversation(),
  );

  // Ecran deja ouvert : une nouvelle conversation demandee arrive directement ici
  useEffect(() => {
    mapNavigation.onConversationPending(cid => setPending(cid));
    return () => mapNavigation.onConversationPending(null);
  }, []);

  useEffect(() => {
    if (route?.params?.conversationId) setPending(route.params.conversationId);
  }, [route?.params?.conversationId, route?.params?.t]);

  return (
    <MessagerieScreen
      pendingConversationId={pending}
      onConsumedPendingConversation={() => setPending(null)}
      titreListe="Messages"
    />
  );
}
