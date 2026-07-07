// Managed by bgp-admin. Style freely to match the app, but keep the props
// and the Restore button — it is REQUIRED by Apple App Store Guidelines.

interface PaywallProps {
  freeLimit: number;
  totalItems?: number;
  onClose: () => void;
  onPurchase: () => Promise<void>;
  onRestore: () => Promise<void>; // ⚠️ Required by Apple App Store Guidelines
  isLoading: boolean;
}

export const Paywall = ({
  freeLimit,
  totalItems = 100,
  onClose,
  onPurchase,
  onRestore,
  isLoading,
}: PaywallProps) => (
  <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 p-4">
    <div className="relative w-full max-w-sm rounded-2xl bg-background border p-6 text-center">
      <button onClick={onClose} className="absolute top-4 right-4">
        ✕
      </button>

      <h2 className="text-2xl font-bold mb-2">Unlock Full App</h2>
      <p className="text-muted-foreground text-sm mb-6">
        You've completed the first {freeLimit} items for free. Unlock all {totalItems}+ to
        continue.
      </p>

      <button
        onClick={() => void onPurchase()}
        disabled={isLoading}
        className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-bold mb-3 disabled:opacity-50"
      >
        {isLoading ? "Loading…" : "Unlock Full App"}
      </button>

      {/* ⚠️ MANDATORY on iOS — required by Apple, do not remove */}
      <button
        onClick={() => void onRestore()}
        disabled={isLoading}
        className="w-full py-2 text-muted-foreground text-sm disabled:opacity-50"
      >
        Restore previous purchase
      </button>
    </div>
  </div>
);
