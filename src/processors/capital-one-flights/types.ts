export interface CapitalOneFlightReceipt {
  tripCode: string;
  originAirportCode: string;
  destinationAirportCode: string;
  grandTotalCents: number;
  totalDiscountCents: number;
  discountSummary: string | null;
  chargedAmountCents: number;
}
