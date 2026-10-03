import { formatMoney } from "@/lib/expenses";

export const ESTIMATE_HINT =
  "Estimated: Google Play closes a month around the 5th of the next one. Until then this is worked out from its sales.";

/** A euro amount as Revenue and Home show it; ≈ marks one that counts Google's estimate. */
export function Amount({ value, estimated }: { value: number; estimated?: boolean }) {
  return (
    <span title={estimated ? ESTIMATE_HINT : undefined}>
      {estimated && "≈ "}
      {formatMoney(value, "EUR")}
    </span>
  );
}
