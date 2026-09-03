// React Navigation ne declenche un evenement de focus (useFocusEffect) que lors d'une
// vraie transition de route. `navigate('Tabs', { screen: 'Meute' })` est un no-op silencieux
// quand cet onglet est deja actif (cas frequent en tapant une notif de message pendant
// qu'on est deja dans Meute/Chat) -- aucun focus ne se redeclenche, donc l'ancien systeme
// (une simple variable + useFocusEffect qui la "consume") ne livrait jamais la valeur.
//
// Chaque "pending" ci-dessous garde ce mecanisme de secours (set/consume, utile au tout
// premier montage d'un onglet, avant qu'un abonne existe), mais ajoute un abonnement
// (subscribe) livre immediatement si un ecran est deja monte -- ce qui est le cas la
// quasi totalite du temps, les onglets restant montes une fois visites une premiere fois.
function createPending<T = string>() {
  let value: T | null = null;
  let listener: ((v: T) => void) | null = null;
  return {
    set(v: T) {
      if (listener) listener(v);
      else value = v;
    },
    consume(): T | null {
      const v = value;
      value = null;
      return v;
    },
    subscribe(cb: ((v: T) => void) | null) {
      listener = cb;
    },
  };
}

const lieuPending = createPending<string>();
const baladePending = createPending<string>();
const proposePending = createPending<string>();
const conversationPending = createPending<string>();
const eventPending = createPending<string>();
const postPending = createPending<string>();

let _returnCallback: (() => void) | null = null;

export const mapNavigation = {
  setPendingLieu(id: string, returnCallback?: () => void) {
    lieuPending.set(id);
    _returnCallback = returnCallback ?? null;
  },
  consume(): string | null { return lieuPending.consume(); },
  onLieuPending(cb: ((id: string) => void) | null) { lieuPending.subscribe(cb); },

  consumeReturn(): (() => void) | null {
    const cb = _returnCallback; _returnCallback = null; return cb;
  },

  setPendingPropose(name: string) { proposePending.set(name); },
  consumePropose(): string | null { return proposePending.consume(); },
  onProposePending(cb: ((name: string) => void) | null) { proposePending.subscribe(cb); },

  setPendingBalade(id: string) { baladePending.set(id); },
  consumeBalade(): string | null { return baladePending.consume(); },
  onBaladePending(cb: ((id: string) => void) | null) { baladePending.subscribe(cb); },

  setPendingConversation(id: string) { conversationPending.set(id); },
  consumeConversation(): string | null { return conversationPending.consume(); },
  onConversationPending(cb: ((id: string) => void) | null) { conversationPending.subscribe(cb); },

  setPendingEvent(id: string) { eventPending.set(id); },
  consumeEvent(): string | null { return eventPending.consume(); },
  onEventPending(cb: ((id: string) => void) | null) { eventPending.subscribe(cb); },

  setPendingPost(id: string) { postPending.set(id); },
  consumePost(): string | null { return postPending.consume(); },
  onPostPending(cb: ((id: string) => void) | null) { postPending.subscribe(cb); },
};
