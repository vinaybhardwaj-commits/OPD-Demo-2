/**
 * v2.0.0 seed — patient stories aggregator.
 *
 * Re-exports the 50 patient stories across 8 batches plus the staff/rooms data.
 * The seed runner imports from here.
 */

export { SEED_DOCTORS, SEED_STAFF, SEED_ROOMS } from './staff';
export type { SeedDoctor, SeedRoom } from './staff';

export type {
  SeedPatient,
  SeedEncounter,
  SeedLabCycle,
  SeedLabResult,
  SeedOverride,
  SeedActiveProblem,
  SeedRxLine,
  SeedVitals,
} from './types';

import type { SeedPatient } from './types';
import { PATIENTS_BATCH_1 } from './patients-batch-1';
import { PATIENTS_BATCH_2 } from './patients-batch-2';
import { PATIENTS_BATCH_3 } from './patients-batch-3';
import { PATIENTS_BATCH_4 } from './patients-batch-4';
import { PATIENTS_BATCH_5 } from './patients-batch-5';
import { PATIENTS_BATCH_6 } from './patients-batch-6';
import { PATIENTS_BATCH_7 } from './patients-batch-7';
import { PATIENTS_BATCH_8 } from './patients-batch-8';

export const ALL_PATIENTS: SeedPatient[] = [
  ...PATIENTS_BATCH_1,
  ...PATIENTS_BATCH_2,
  ...PATIENTS_BATCH_3,
  ...PATIENTS_BATCH_4,
  ...PATIENTS_BATCH_5,
  ...PATIENTS_BATCH_6,
  ...PATIENTS_BATCH_7,
  ...PATIENTS_BATCH_8,
];
