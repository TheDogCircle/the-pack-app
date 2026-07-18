let _pendingLieuId: string | null = null;
let _returnCallback: (() => void) | null = null;

export const mapNavigation = {
  setPendingLieu(id: string, returnCallback?: () => void) {
    _pendingLieuId = id;
    _returnCallback = returnCallback ?? null;
  },
  consume(): string | null { const id = _pendingLieuId; _pendingLieuId = null; return id; },
  consumeReturn(): (() => void) | null {
    const cb = _returnCallback; _returnCallback = null; return cb;
  },
};
