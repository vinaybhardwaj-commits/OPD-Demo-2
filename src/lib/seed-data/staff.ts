/**
 * v2.0.0 seed — doctors, support staff, OPD rooms.
 *
 * 10 doctors covering the realistic EHRC outpatient mix:
 * Neurology, Internal Medicine, Cardiology, Endocrinology, GI,
 * Orthopedics, Pulmonology, Family Medicine, Dermatology, Psychiatry.
 *
 * Each doctor gets one OPD room as default; admin can swap.
 *
 * Support staff: 2 CCEs, 2 Triage Nurses, 1 Lab Tech.
 *
 * The seed runner inserts these idempotently (ON CONFLICT on email).
 * Dr. Vinay already exists from v1 (migration v2); his row gets its
 * role + specialty updated rather than inserted.
 */

export type SeedDoctor = {
  email: string;
  name: string;
  mci_registration_number: string;
  role: 'doctor' | 'nurse' | 'cce' | 'lab_tech' | 'admin';
  specialty: string | null;
};

export type SeedRoom = {
  name: string;
  floor: string;
  default_doctor_email: string; // resolve to id on insert
  specialty: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Doctors — 10 named, with the EHRC-realistic specialty mix.
// ─────────────────────────────────────────────────────────────────────────────

export const SEED_DOCTORS: SeedDoctor[] = [
  {
    email: 'vinay.bhardwaj@even.in',
    name: 'Dr. Vinay Bhardwaj',
    mci_registration_number: 'DEMO-MCI-001',
    role: 'doctor',
    specialty: 'Neurology',
  },
  {
    email: 'chandrika.kambam@even.in',
    name: 'Dr. Chandrika Kambam',
    mci_registration_number: 'KMC-2014-12450',
    role: 'doctor',
    specialty: 'Internal Medicine',
  },
  {
    email: 'anika.iyer@even.in',
    name: 'Dr. Anika Iyer',
    mci_registration_number: 'KMC-2012-09871',
    role: 'doctor',
    specialty: 'Cardiology',
  },
  {
    email: 'rajesh.murthy@even.in',
    name: 'Dr. Rajesh Murthy',
    mci_registration_number: 'KMC-2011-08234',
    role: 'doctor',
    specialty: 'Endocrinology',
  },
  {
    email: 'priya.suresh@even.in',
    name: 'Dr. Priya Suresh',
    mci_registration_number: 'KMC-2015-13892',
    role: 'doctor',
    specialty: 'Gastroenterology',
  },
  {
    email: 'karthik.reddy@even.in',
    name: 'Dr. Karthik Reddy',
    mci_registration_number: 'KMC-2010-07211',
    role: 'doctor',
    specialty: 'Orthopedics',
  },
  {
    email: 'lakshmi.naidu@even.in',
    name: 'Dr. Lakshmi Naidu',
    mci_registration_number: 'KMC-2013-10564',
    role: 'doctor',
    specialty: 'Pulmonology',
  },
  {
    email: 'aditya.sharma@even.in',
    name: 'Dr. Aditya Sharma',
    mci_registration_number: 'KMC-2016-15672',
    role: 'doctor',
    specialty: 'Family Medicine',
  },
  {
    email: 'meera.pillai@even.in',
    name: 'Dr. Meera Pillai',
    mci_registration_number: 'KMC-2017-16924',
    role: 'doctor',
    specialty: 'Dermatology',
  },
  {
    email: 'ravi.kumar@even.in',
    name: 'Dr. Ravi Kumar',
    mci_registration_number: 'KMC-2014-12198',
    role: 'doctor',
    specialty: 'Psychiatry',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Support staff — CCEs, Nurses, Lab Tech.
// MCI number column is reused as a generic "registration ID" for non-doctor
// staff (employee numbers); the schema doesn't differentiate.
// ─────────────────────────────────────────────────────────────────────────────

export const SEED_STAFF: SeedDoctor[] = [
  {
    email: 'lalitha.krishnan@even.in',
    name: 'Lalitha Krishnan',
    mci_registration_number: 'EH-EMP-2018-204',
    role: 'cce',
    specialty: null,
  },
  {
    email: 'manjunath.hegde@even.in',
    name: 'Manjunath Hegde',
    mci_registration_number: 'EH-EMP-2020-318',
    role: 'cce',
    specialty: null,
  },
  {
    email: 'devi.suresh@even.in',
    name: 'Nurse Devi Suresh',
    mci_registration_number: 'KSNMC-NUR-2016-8421',
    role: 'nurse',
    specialty: null,
  },
  {
    email: 'anand.pawar@even.in',
    name: 'Nurse Anand Pawar',
    mci_registration_number: 'KSNMC-NUR-2019-9237',
    role: 'nurse',
    specialty: null,
  },
  {
    email: 'ramesh.kumar@even.in',
    name: 'Ramesh Kumar',
    mci_registration_number: 'EH-EMP-2017-156',
    role: 'lab_tech',
    specialty: null,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// OPD rooms — one per doctor.
// ─────────────────────────────────────────────────────────────────────────────

export const SEED_ROOMS: SeedRoom[] = [
  { name: 'OPD-1',  floor: '2nd floor', default_doctor_email: 'vinay.bhardwaj@even.in',     specialty: 'Neurology' },
  { name: 'OPD-2',  floor: '2nd floor', default_doctor_email: 'chandrika.kambam@even.in',   specialty: 'Internal Medicine' },
  { name: 'OPD-3',  floor: '2nd floor', default_doctor_email: 'anika.iyer@even.in',         specialty: 'Cardiology' },
  { name: 'OPD-4',  floor: '2nd floor', default_doctor_email: 'rajesh.murthy@even.in',      specialty: 'Endocrinology' },
  { name: 'OPD-5',  floor: '3rd floor', default_doctor_email: 'priya.suresh@even.in',       specialty: 'Gastroenterology' },
  { name: 'OPD-6',  floor: '3rd floor', default_doctor_email: 'karthik.reddy@even.in',      specialty: 'Orthopedics' },
  { name: 'OPD-7',  floor: '3rd floor', default_doctor_email: 'lakshmi.naidu@even.in',      specialty: 'Pulmonology' },
  { name: 'OPD-8',  floor: '3rd floor', default_doctor_email: 'aditya.sharma@even.in',      specialty: 'Family Medicine' },
  { name: 'OPD-9',  floor: '4th floor', default_doctor_email: 'meera.pillai@even.in',       specialty: 'Dermatology' },
  { name: 'OPD-10', floor: '4th floor', default_doctor_email: 'ravi.kumar@even.in',         specialty: 'Psychiatry' },
];
