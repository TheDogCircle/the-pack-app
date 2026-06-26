let _pendingLieuId: string | null = null;

export const mapNavigation = {
  setPendingLieu(id: string) { _pendingLieuId = id; },
  consume(): string | null { const id = _pendingLieuId; _pendingLieuId = null; return id; },
};
