import type { AgentKind } from "../types";
import type { Specialist } from "./contract";
import { customerServiceSpecialist } from "./customer-service";
import { palmReadingSpecialist } from "./palm-reading";
import { salesSpecialist } from "./sales";
import { ticketBookingSpecialist } from "./ticket-booking";

type SpecialistRegistry = { [K in AgentKind]: Specialist<K> };

/** Adding an agent kind = catalog entry + specialist + one line here. */
export const SPECIALISTS: SpecialistRegistry = {
  customer_service: customerServiceSpecialist,
  palm_reading: palmReadingSpecialist,
  ticket_booking: ticketBookingSpecialist,
  sales: salesSpecialist,
};

export function getSpecialist<K extends AgentKind>(kind: K): Specialist<K> {
  return SPECIALISTS[kind];
}
