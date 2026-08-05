let _pendingLieuId: string | null = null;
let _returnCallback: (() => void) | null = null;
let _pendingProposeName: string | null = null;
let _pendingBaladeId: string | null = null;
let _pendingConversationId: string | null = null;
let _pendingEventId: string | null = null;

export const mapNavigation = {
  setPendingLieu(id: string, returnCallback?: () => void) {
    _pendingLieuId = id;
    _returnCallback = returnCallback ?? null;
  },
  consume(): string | null { const id = _pendingLieuId; _pendingLieuId = null; return id; },
  consumeReturn(): (() => void) | null {
    const cb = _returnCallback; _returnCallback = null; return cb;
  },
  setPendingPropose(name: string) { _pendingProposeName = name; },
  consumePropose(): string | null { const n = _pendingProposeName; _pendingProposeName = null; return n; },
  setPendingBalade(id: string) { _pendingBaladeId = id; },
  consumeBalade(): string | null { const id = _pendingBaladeId; _pendingBaladeId = null; return id; },
  setPendingConversation(id: string) { _pendingConversationId = id; },
  consumeConversation(): string | null { const id = _pendingConversationId; _pendingConversationId = null; return id; },
  setPendingEvent(id: string) { _pendingEventId = id; },
  consumeEvent(): string | null { const id = _pendingEventId; _pendingEventId = null; return id; },
};
