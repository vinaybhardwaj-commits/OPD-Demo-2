#!/usr/bin/env python3
"""
Demo enrichment generator.

Reads patients.tsv, produces enrich.sql to be pasted into the Neon SQL editor.

Goals (per V's instructions, 25 May 2026):
  - Comorbidities for ~50/72 patients with realistic age/sex matching, +
    8-10 complex multi-system cases. control_state + severity_state.
  - Clinical-depth history: every patient gets 4-8 historical completed
    encounters with vitals/ICD-10/exam/assessment/Rx; 10-15 "showcase"
    patients get 8-12 with chronic-condition progression (HbA1c series,
    lipid deltas, eGFR trending, BP series).
  - ~25 visible queue today for V (bump V's today from 19 to ~35,
    distributed so 25 are visible — waiting_for_doctor + paused +
    ready_to_resume).
  - Allergy coverage 14 → ~35.
  - Patient #52 (age 120 sex O) is the QA edge-case row; skip clinical content.
  - Patient #11 Sunita Krishnan already has 8 encs + 1 como; leave intact.

The trigger encounters_active_time_trg (migration v34) will fire on
every encounter INSERT and stamp active_since correctly. Today
encounters in active/ready states will tick; pre-doctor + paused +
completed rows freeze cleanly.

One transaction. Idempotent against re-runs: comorbidities use
ON CONFLICT (patient_id, code), encounter_number includes a v412 suffix
so they don't collide with seeded rows. Re-running deletes prior v412
content and recreates.
"""
import random
from pathlib import Path

random.seed(42)  # reproducible
V_DOC = "2a03f6df-6023-4250-92ad-bd8770196f08"

# Load patients
rows = []
for line in Path("/tmp/opd2/enrich/patients.tsv").read_text().strip().split("\n"):
    parts = line.split("\t")
    rows.append({
        "n": int(parts[0]),
        "id": parts[1],
        "age": int(parts[2]),
        "sex": parts[3],
        "encs": int(parts[4]),
        "comos": int(parts[5]),
        "allergies": parts[6] if len(parts) > 6 else "",
    })

# === Persona definitions ===
# Each persona is a clinical archetype. The generator picks one per patient.
# A persona drives: comorbidities, vitals ranges, chief complaints, ICD-10
# codes, Rx patterns, lab orders/results, # of history encounters.

PERSONAS = {
    1: {
        "name": "healthy_episodic",
        "comos": [],  # No chronic comorbidities
        "hx_min": 3, "hx_max": 6,
        "ccs": [
            ("Cough + sore throat, 3 days", ["Cough", "Sore throat"], ["J06.9"], "Acute viral URTI"),
            ("Loose stools, 24 hours, no vomiting", ["Diarrhea"], ["K59.1"], "Acute gastroenteritis, viral"),
            ("Mild dysmenorrhea, paracetamol working", ["Dysmenorrhea"], ["N94.4"], "Primary dysmenorrhea"),
            ("Lower back pain after gym, 2 days", ["Back pain"], ["M54.5"], "Acute mechanical low back pain"),
            ("Allergic conjunctivitis, eye redness + itch", ["Itchy eyes"], ["H10.45"], "Allergic conjunctivitis"),
            ("Headache + nausea, started this morning", ["Headache"], ["G44.1"], "Tension-type headache"),
            ("Routine health check, no complaints", ["Annual check"], ["Z00.0"], "Routine adult health exam, no findings"),
        ],
        "rx_pool": [
            [("Paracetamol 500mg", "1 tab", "TID", "3 days", "PO")],
            [("Levocetirizine 5mg", "1 tab", "HS", "5 days", "PO")],
            [("ORS sachet", "1 sachet in 200ml", "after each loose stool", "as needed", "PO"), ("Probiotic capsule", "1 cap", "BID", "5 days", "PO")],
            [("Ibuprofen 400mg", "1 tab", "BID", "3 days", "PO with food")],
            [("Mefenamic acid 500mg", "1 tab", "TID", "3 days", "PO during periods")],
            [],  # No Rx (counseling only)
        ],
        "vitals_template": lambda age, sex: {
            "bp": f"{random.randint(110,128)}/{random.randint(70,82)}",
            "hr": random.randint(68, 88),
            "rr": random.randint(14, 18),
            "temp_c": round(random.uniform(36.4, 37.4), 1),
            "spo2": random.randint(97, 99),
        },
        "labs": [],  # No routine labs
    },
    2: {
        "name": "asthma_atopy",
        "comos": [("J45.909", "Asthma, unspecified", "partial", "mild"),
                  ("J30.1", "Allergic rhinitis due to pollen", "partial", "mild")],
        "hx_min": 4, "hx_max": 7,
        "ccs": [
            ("Wheeze + nocturnal cough, worse this week", ["Wheeze", "Cough"], ["J45.909"], "Asthma exacerbation, mild — step up controller"),
            ("Allergic rhinitis flare, post-nasal drip", ["Sneezing", "Rhinorrhea"], ["J30.1"], "Allergic rhinitis flare — seasonal"),
            ("Routine asthma review, well-controlled", ["Asthma review"], ["J45.909"], "Asthma — well controlled on current regimen"),
            ("Wheeze after exercise", ["Exertional wheeze"], ["J45.990"], "Exercise-induced bronchospasm"),
        ],
        "rx_pool": [
            [("Budesonide-Formoterol 200/6 inhaler", "2 puffs", "BID", "30 days", "Inhaled, rinse mouth")],
            [("Salbutamol 100mcg inhaler", "2 puffs", "PRN", "30 days", "Inhaled, max 4 doses/day"),
             ("Levocetirizine 5mg", "1 tab", "HS", "10 days", "PO")],
            [("Montelukast 10mg", "1 tab", "HS", "30 days", "PO")],
        ],
        "vitals_template": lambda age, sex: {
            "bp": f"{random.randint(110,124)}/{random.randint(68,78)}",
            "hr": random.randint(78, 96),
            "rr": random.randint(18, 24),
            "temp_c": round(random.uniform(36.5, 37.1), 1),
            "spo2": random.randint(95, 98),
            "peak_flow_lpm": random.randint(280, 420),
        },
        "labs": [
            ("Spirometry", "ResultsExternal", None, None, None, "FEV1/FVC 78%, mild obstruction reversible post-bronchodilator"),
        ],
    },
    3: {
        "name": "htn_dyslipidemia",
        "comos": [("I10", "Essential (primary) hypertension", "partial", "moderate"),
                  ("E78.5", "Hyperlipidemia, unspecified", "well", "mild")],
        "hx_min": 5, "hx_max": 8,
        "ccs": [
            ("Routine BP review", ["BP check"], ["I10"], "Essential HTN, controlled on current regimen. Continue."),
            ("Occasional headaches", ["Headache"], ["I10", "G44.1"], "Headache likely tension; BP today 138/86 — at target."),
            ("Dizziness on standing", ["Postural dizziness"], ["I10"], "Mild orthostatic symptoms; reduced amlodipine dose."),
            ("Lipid review, fasting", ["Lipid follow-up"], ["E78.5"], "LDL 110 → statin titrated up."),
            ("Annual cardiovascular risk review", ["CV risk review"], ["I10", "E78.5"], "10-y ASCVD risk 12% intermediate; reinforce lifestyle + continue statin."),
        ],
        "rx_pool": [
            [("Telmisartan 40mg", "1 tab", "OD morning", "30 days", "PO"),
             ("Atorvastatin 10mg", "1 tab", "HS", "30 days", "PO")],
            [("Amlodipine 5mg", "1 tab", "OD morning", "30 days", "PO"),
             ("Atorvastatin 20mg", "1 tab", "HS", "30 days", "PO")],
            [("Telmisartan 40mg / Amlodipine 5mg combo", "1 tab", "OD morning", "30 days", "PO"),
             ("Atorvastatin 10mg", "1 tab", "HS", "30 days", "PO")],
        ],
        "vitals_template": lambda age, sex: {
            "bp": f"{random.randint(132,150)}/{random.randint(82,96)}",
            "hr": random.randint(70, 84),
            "rr": random.randint(14, 18),
            "temp_c": round(random.uniform(36.4, 36.9), 1),
            "spo2": random.randint(96, 99),
            "weight_kg": round(random.uniform(66, 84), 1),
        },
        "labs": [
            ("Lipid panel", "ResultsExternal", None, None, None, "TC trending 220 → 185 over 6 months"),
            ("Fasting glucose", "ResultsExternal", None, None, None, "FBS 102 mg/dL — pre-diabetic range"),
            ("KFT", "ResultsExternal", None, None, None, "Creat 0.9 mg/dL, eGFR 92"),
        ],
    },
    4: {
        "name": "t2dm_uncomplicated",
        "comos": [("E11.9", "Type 2 diabetes mellitus without complications", "partial", "moderate"),
                  ("E78.5", "Hyperlipidemia, unspecified", "partial", "mild")],
        "hx_min": 6, "hx_max": 10,
        "ccs": [
            ("HbA1c follow-up, 3-month review", ["HbA1c review"], ["E11.9"], "T2DM — HbA1c trending. Reinforce diet, continue metformin."),
            ("Polyuria + thirst increased, last 2 weeks", ["Polyuria", "Polydipsia"], ["E11.9"], "Suboptimal control; add second OHA."),
            ("Foot tingling, no ulcer", ["Foot paraesthesia"], ["E11.40"], "Early diabetic neuropathy — monofilament normal, B12 OK."),
            ("Annual eye check referral", ["Diabetes eye check"], ["E11.9"], "Refer to ophthalmology for dilated fundus exam — annual."),
            ("Routine quarterly DM review", ["Diabetes review"], ["E11.9"], "T2DM — A1c 6.9%, at target."),
        ],
        "rx_pool": [
            [("Metformin 1000mg", "1 tab", "BID after meals", "30 days", "PO")],
            [("Metformin 1000mg", "1 tab", "BID after meals", "30 days", "PO"),
             ("Glimepiride 2mg", "1 tab", "OD before breakfast", "30 days", "PO")],
            [("Metformin 1000mg", "1 tab", "BID after meals", "30 days", "PO"),
             ("Vildagliptin 50mg", "1 tab", "BID", "30 days", "PO"),
             ("Atorvastatin 10mg", "1 tab", "HS", "30 days", "PO")],
        ],
        "vitals_template": lambda age, sex: {
            "bp": f"{random.randint(124,140)}/{random.randint(78,88)}",
            "hr": random.randint(70, 86),
            "rr": random.randint(14, 18),
            "temp_c": round(random.uniform(36.4, 36.9), 1),
            "spo2": random.randint(96, 99),
            "weight_kg": round(random.uniform(70, 92), 1),
        },
        "labs": [
            # HbA1c trending — generator will instantiate a progression
            ("HbA1c", "ResultsExternal", None, None, None, "PROGRESSION"),
            ("Fasting glucose", "ResultsExternal", None, None, None, "FBS series"),
            ("Lipid panel", "ResultsExternal", None, None, None, "Lipid panel"),
            ("KFT", "ResultsExternal", None, None, None, "Creat + eGFR"),
        ],
    },
    5: {
        "name": "t2dm_htn_ckd_complex",
        "comos": [("E11.22", "Type 2 diabetes with diabetic chronic kidney disease", "uncontrolled", "moderate"),
                  ("I12.9", "Hypertensive chronic kidney disease without HF", "partial", "moderate"),
                  ("N18.3", "Chronic kidney disease, stage 3", "partial", "moderate"),
                  ("E78.5", "Hyperlipidemia, unspecified", "well", "mild")],
        "hx_min": 8, "hx_max": 12,
        "ccs": [
            ("Quarterly DM + CKD review", ["Diabetes review", "CKD review"], ["E11.22", "N18.3"], "T2DM+CKD3 — A1c 7.6%, eGFR 48. Hold metformin if eGFR<45. Continue ARB."),
            ("Leg swelling at end of day", ["Pedal edema"], ["N18.3", "I12.9"], "Bilateral pitting pedal edema; furosemide added; restrict salt."),
            ("Sudden BP rise to 168/96 at home", ["Severe HTN"], ["I12.9"], "Uncontrolled HTN; titrate up amlodipine. Recheck in 2 weeks."),
            ("Routine labs review", ["Lab review"], ["E11.22", "N18.3"], "eGFR 46 mL/min — CKD3a. Continue nephroprotection."),
            ("Foot ulcer screening", ["Diabetic foot check"], ["E11.621"], "Mild dryness, no ulcer; reinforce footcare."),
        ],
        "rx_pool": [
            [("Telmisartan 40mg", "1 tab", "OD morning", "30 days", "PO"),
             ("Amlodipine 5mg", "1 tab", "OD morning", "30 days", "PO"),
             ("Metformin 500mg (renal-adjusted)", "1 tab", "BID after meals", "30 days", "PO"),
             ("Atorvastatin 20mg", "1 tab", "HS", "30 days", "PO")],
            [("Telmisartan 80mg", "1 tab", "OD morning", "30 days", "PO"),
             ("Amlodipine 10mg", "1 tab", "OD morning", "30 days", "PO"),
             ("Linagliptin 5mg", "1 tab", "OD", "30 days", "PO"),
             ("Atorvastatin 40mg", "1 tab", "HS", "30 days", "PO"),
             ("Furosemide 20mg", "1 tab", "OD morning", "30 days", "PO")],
        ],
        "vitals_template": lambda age, sex: {
            "bp": f"{random.randint(138,160)}/{random.randint(84,98)}",
            "hr": random.randint(72, 88),
            "rr": random.randint(14, 20),
            "temp_c": round(random.uniform(36.4, 36.9), 1),
            "spo2": random.randint(95, 98),
            "weight_kg": round(random.uniform(72, 96), 1),
        },
        "labs": [
            ("HbA1c", "ResultsExternal", None, None, None, "PROGRESSION"),
            ("KFT", "ResultsExternal", None, None, None, "CKD progression"),
            ("Urine ACR", "ResultsExternal", None, None, None, "Albuminuria series"),
            ("Lipid panel", "ResultsExternal", None, None, None, "Lipid"),
            ("CBC", "ResultsExternal", None, None, None, "Hb monitoring"),
        ],
    },
    6: {
        "name": "copd_smoker",
        "comos": [("J44.9", "Chronic obstructive pulmonary disease, unspecified", "partial", "moderate"),
                  ("F17.210", "Nicotine dependence, cigarettes, uncomplicated", "uncontrolled", "moderate")],
        "hx_min": 5, "hx_max": 8,
        "ccs": [
            ("Increasing dyspnea on exertion, 4 weeks", ["Dyspnea"], ["J44.9"], "COPD — moderate worsening. Stepped up to LAMA+LABA."),
            ("Cough with white sputum, smoker 30 PY", ["Cough", "Sputum"], ["J44.9"], "Stable COPD; reinforce smoking cessation."),
            ("Routine spirometry follow-up", ["COPD review"], ["J44.9"], "FEV1 declining; GOLD stage 2 → 3 transition."),
            ("Acute exacerbation, increased dyspnea + green sputum", ["AECOPD"], ["J44.1"], "AECOPD; oral steroids + amoxiclav started."),
        ],
        "rx_pool": [
            [("Tiotropium 18mcg inhaler", "1 cap inhaled", "OD", "30 days", "Inhaled via Rotahaler"),
             ("Salbutamol 100mcg inhaler", "2 puffs", "PRN", "30 days", "Inhaled")],
            [("Tiotropium-Formoterol 9/12 mcg", "1 cap inhaled", "BID", "30 days", "Inhaled"),
             ("Prednisolone 40mg", "1 tab", "OD morning", "5 days", "PO with food"),
             ("Amoxicillin-Clavulanate 625mg", "1 tab", "TID", "7 days", "PO")],
            [("Salmeterol-Fluticasone 50/250 inhaler", "1 puff", "BID", "30 days", "Inhaled, rinse mouth"),
             ("Salbutamol 100mcg inhaler", "2 puffs", "PRN", "30 days", "Inhaled")],
        ],
        "vitals_template": lambda age, sex: {
            "bp": f"{random.randint(122,138)}/{random.randint(76,86)}",
            "hr": random.randint(84, 102),
            "rr": random.randint(18, 26),
            "temp_c": round(random.uniform(36.6, 37.6), 1),
            "spo2": random.randint(90, 95),
        },
        "labs": [
            ("Spirometry", "ResultsExternal", None, None, None, "FEV1 60% predicted"),
            ("ABG", "ResultsExternal", None, None, None, "pH 7.38, pCO2 46, pO2 68"),
            ("Chest X-ray", "ResultsExternal", None, None, None, "Hyperinflated lungs, no acute infiltrate"),
        ],
    },
    7: {
        "name": "hypothyroid",
        "comos": [("E03.9", "Hypothyroidism, unspecified", "well", "mild")],
        "hx_min": 4, "hx_max": 7,
        "ccs": [
            ("TSH check, on Eltroxin", ["TSH review"], ["E03.9"], "Hypothyroid — TSH 2.4, in range. Continue current dose."),
            ("Cold intolerance, weight gain", ["Cold intolerance"], ["E03.9"], "TSH 8.6 — increased dose."),
            ("Routine thyroid review", ["Thyroid review"], ["E03.9"], "Stable, continue thyroxine."),
            ("Hair thinning, fatigue", ["Fatigue"], ["E03.9"], "TSH within target; CBC normal — likely para-menopausal."),
        ],
        "rx_pool": [
            [("Levothyroxine (Eltroxin) 50mcg", "1 tab", "OD empty stomach", "30 days", "PO 30 min before food")],
            [("Levothyroxine (Eltroxin) 75mcg", "1 tab", "OD empty stomach", "30 days", "PO 30 min before food")],
            [("Levothyroxine (Eltroxin) 100mcg", "1 tab", "OD empty stomach", "30 days", "PO 30 min before food")],
        ],
        "vitals_template": lambda age, sex: {
            "bp": f"{random.randint(112,126)}/{random.randint(70,80)}",
            "hr": random.randint(58, 76),
            "rr": random.randint(12, 16),
            "temp_c": round(random.uniform(36.3, 36.8), 1),
            "spo2": random.randint(97, 99),
            "weight_kg": round(random.uniform(58, 76), 1),
        },
        "labs": [
            ("TSH", "ResultsExternal", None, None, None, "TSH series"),
            ("Free T4", "ResultsExternal", None, None, None, "FT4 within range"),
        ],
    },
    8: {
        "name": "post_mi_polypharm",
        "comos": [("I25.10", "Atherosclerotic heart disease of native coronary artery without angina", "partial", "moderate"),
                  ("Z95.5", "Presence of coronary angioplasty implant and graft", "well", "mild"),
                  ("I10", "Essential hypertension", "partial", "moderate"),
                  ("E78.5", "Hyperlipidemia, unspecified", "well", "mild")],
        "hx_min": 7, "hx_max": 11,
        "ccs": [
            ("Routine post-PCI review, no chest pain", ["Cardio review"], ["I25.10", "Z95.5"], "Stable post-PCI 2024; DAPT continued; LDL at target."),
            ("Mild dyspnea on climbing stairs, no chest pain", ["Dyspnea on exertion"], ["I25.10"], "Stress test — no inducible ischemia. Optimize meds."),
            ("Bleeding gums on DAPT", ["Gum bleeding"], ["Z79.02"], "Mild bleeding tendency on dual antiplatelet; reduced clopidogrel intensity at 12-month mark."),
            ("Annual LDL check", ["Lipid follow-up"], ["E78.5"], "LDL 65 mg/dL — excellent control on high-intensity statin."),
            ("BP check, home reading high", ["BP check"], ["I10"], "BP 144/88 — titrate up metoprolol."),
        ],
        "rx_pool": [
            [("Aspirin 75mg", "1 tab", "OD after lunch", "30 days", "PO"),
             ("Clopidogrel 75mg", "1 tab", "OD after dinner", "30 days", "PO"),
             ("Atorvastatin 40mg", "1 tab", "HS", "30 days", "PO"),
             ("Metoprolol succinate 50mg", "1 tab", "OD morning", "30 days", "PO"),
             ("Ramipril 5mg", "1 tab", "OD morning", "30 days", "PO")],
            [("Aspirin 75mg", "1 tab", "OD after lunch", "30 days", "PO"),
             ("Atorvastatin 80mg", "1 tab", "HS", "30 days", "PO"),
             ("Bisoprolol 5mg", "1 tab", "OD morning", "30 days", "PO"),
             ("Telmisartan 40mg", "1 tab", "OD morning", "30 days", "PO")],
        ],
        "vitals_template": lambda age, sex: {
            "bp": f"{random.randint(124,144)}/{random.randint(78,90)}",
            "hr": random.randint(58, 72),
            "rr": random.randint(14, 18),
            "temp_c": round(random.uniform(36.4, 36.9), 1),
            "spo2": random.randint(96, 99),
            "weight_kg": round(random.uniform(70, 86), 1),
        },
        "labs": [
            ("Lipid panel", "ResultsExternal", None, None, None, "LDL series"),
            ("KFT", "ResultsExternal", None, None, None, "Creat + eGFR"),
            ("LFT", "ResultsExternal", None, None, None, "ALT (statin monitoring)"),
            ("HbA1c", "ResultsExternal", None, None, None, "Pre-diabetic 5.9-6.3"),
            ("ECG", "ResultsExternal", None, None, None, "NSR, old Q waves in inferior leads"),
        ],
    },
    9: {
        "name": "hf_afib",
        "comos": [("I50.9", "Heart failure, unspecified", "partial", "moderate"),
                  ("I48.91", "Atrial fibrillation, unspecified", "partial", "moderate"),
                  ("I10", "Essential hypertension", "well", "mild")],
        "hx_min": 6, "hx_max": 10,
        "ccs": [
            ("Routine HF/AFib follow-up", ["HF review"], ["I50.9", "I48.91"], "Stable HFrEF 35%; AFib rate-controlled. Continue apixaban."),
            ("Weight up 2 kg in 1 week, mild dyspnea", ["Weight gain", "Dyspnea"], ["I50.9"], "Mild fluid retention; up furosemide for 5 days."),
            ("Bruise on shin, on apixaban", ["Bruising"], ["I48.91"], "Apixaban-related ecchymosis; continue at current dose."),
            ("INR not needed on apixaban, BP review", ["BP check"], ["I10"], "BP at target. Continue regimen."),
            ("Echo annual review", ["Echo"], ["I50.9"], "LVEF 38% — stable. Maintain GDMT."),
        ],
        "rx_pool": [
            [("Apixaban 5mg", "1 tab", "BID", "30 days", "PO"),
             ("Bisoprolol 5mg", "1 tab", "OD morning", "30 days", "PO"),
             ("Furosemide 40mg", "1 tab", "OD morning", "30 days", "PO"),
             ("Spironolactone 25mg", "1 tab", "OD morning", "30 days", "PO"),
             ("Sacubitril-Valsartan 49/51", "1 tab", "BID", "30 days", "PO")],
        ],
        "vitals_template": lambda age, sex: {
            "bp": f"{random.randint(110,128)}/{random.randint(66,78)}",
            "hr": random.randint(72, 96),  # AFib can be irregular
            "rr": random.randint(16, 22),
            "temp_c": round(random.uniform(36.4, 36.8), 1),
            "spo2": random.randint(94, 97),
            "weight_kg": round(random.uniform(64, 84), 1),
        },
        "labs": [
            ("NT-proBNP", "ResultsExternal", None, None, None, "BNP series"),
            ("KFT", "ResultsExternal", None, None, None, "Creat + K"),
            ("TSH", "ResultsExternal", None, None, None, "Normal"),
            ("ECG", "ResultsExternal", None, None, None, "AFib, rate 88"),
        ],
    },
    10: {
        "name": "ra_methotrexate",
        "comos": [("M05.79", "Rheumatoid arthritis with rheumatoid factor", "partial", "moderate"),
                  ("E03.9", "Hypothyroidism, unspecified", "well", "mild")],
        "hx_min": 6, "hx_max": 9,
        "ccs": [
            ("Monthly MTX review, joint pain mild", ["RA review"], ["M05.79"], "RA — DAS28 3.1, low activity. Continue MTX 15mg weekly."),
            ("Mouth ulcers on MTX", ["Mouth ulcers"], ["M05.79"], "Folate-deficiency stomatitis; up folic acid to daily except MTX day."),
            ("Morning stiffness >1 hour, flare", ["Joint stiffness"], ["M05.79"], "RA flare; short prednisolone taper added."),
            ("Annual TB screen for biologic eligibility", ["TB screen"], ["M05.79"], "TST + IGRA neg; safe to initiate biologic if needed."),
        ],
        "rx_pool": [
            [("Methotrexate 15mg", "1 tab", "OD weekly (Sunday)", "30 days", "PO"),
             ("Folic acid 5mg", "1 tab", "OD except MTX day", "30 days", "PO"),
             ("Hydroxychloroquine 200mg", "1 tab", "BID after meals", "30 days", "PO")],
            [("Methotrexate 20mg", "1 tab", "OD weekly", "30 days", "PO"),
             ("Folic acid 5mg", "1 tab", "OD except MTX day", "30 days", "PO"),
             ("Prednisolone 10mg", "1 tab", "OD morning, taper", "14 days", "PO")],
        ],
        "vitals_template": lambda age, sex: {
            "bp": f"{random.randint(118,132)}/{random.randint(74,84)}",
            "hr": random.randint(70, 86),
            "rr": random.randint(14, 18),
            "temp_c": round(random.uniform(36.4, 37.1), 1),
            "spo2": random.randint(96, 99),
            "weight_kg": round(random.uniform(54, 72), 1),
        },
        "labs": [
            ("CBC", "ResultsExternal", None, None, None, "Hb + WBC monitoring"),
            ("LFT", "ResultsExternal", None, None, None, "ALT + AST"),
            ("KFT", "ResultsExternal", None, None, None, "Creat"),
            ("ESR", "ResultsExternal", None, None, None, "Inflammation marker"),
            ("RF + Anti-CCP", "ResultsExternal", None, None, None, "RF positive, anti-CCP 78"),
        ],
    },
    11: {
        "name": "migraine_gerd",
        "comos": [("G43.909", "Migraine, unspecified, not intractable, without status migrainosus", "partial", "mild"),
                  ("K21.9", "Gastro-esophageal reflux disease without esophagitis", "partial", "mild")],
        "hx_min": 4, "hx_max": 6,
        "ccs": [
            ("Migraine 2x this week, sumatriptan worked", ["Migraine"], ["G43.909"], "Migraine — continue PRN sumatriptan; add propranolol prophylaxis."),
            ("Heartburn at night, 2 weeks", ["Heartburn"], ["K21.9"], "GERD — PPI step-up; lifestyle counseling."),
            ("Routine review", ["Migraine review"], ["G43.909"], "Migraine frequency down to 1/month on propranolol."),
        ],
        "rx_pool": [
            [("Sumatriptan 50mg", "1 tab", "PRN onset", "10 tabs", "PO, max 2 in 24h"),
             ("Pantoprazole 40mg", "1 tab", "OD empty stomach", "30 days", "PO")],
            [("Propranolol 40mg", "1 tab", "BID", "30 days", "PO"),
             ("Pantoprazole 40mg", "1 tab", "OD empty stomach", "30 days", "PO"),
             ("Sumatriptan 50mg", "1 tab", "PRN", "10 tabs", "PO, max 2 in 24h")],
        ],
        "vitals_template": lambda age, sex: {
            "bp": f"{random.randint(112,124)}/{random.randint(70,80)}",
            "hr": random.randint(64, 80),
            "rr": random.randint(14, 18),
            "temp_c": round(random.uniform(36.4, 36.9), 1),
            "spo2": random.randint(97, 99),
        },
        "labs": [],
    },
    12: {
        "name": "depression_anxiety",
        "comos": [("F33.1", "Major depressive disorder, recurrent, moderate", "partial", "moderate"),
                  ("F41.1", "Generalized anxiety disorder", "partial", "moderate")],
        "hx_min": 4, "hx_max": 7,
        "ccs": [
            ("Mood low, sleep poor, 3 weeks", ["Low mood"], ["F33.1"], "Recurrent MDD episode; titrate sertraline up."),
            ("Anxiety + palpitations, otherwise stable", ["Anxiety"], ["F41.1"], "GAD — sertraline ongoing; clonazepam PRN for acute episodes."),
            ("Routine psych follow-up", ["Psych review"], ["F33.1"], "Stable, PHQ-9 7. Continue sertraline 100mg."),
            ("Sleep difficulty on sertraline", ["Insomnia"], ["F33.1"], "Initial-insomnia side effect; switched to morning dosing."),
        ],
        "rx_pool": [
            [("Sertraline 50mg", "1 tab", "OD morning", "30 days", "PO")],
            [("Sertraline 100mg", "1 tab", "OD morning", "30 days", "PO"),
             ("Clonazepam 0.25mg", "1 tab", "PRN at bedtime", "14 tabs", "PO")],
        ],
        "vitals_template": lambda age, sex: {
            "bp": f"{random.randint(114,128)}/{random.randint(70,82)}",
            "hr": random.randint(72, 90),
            "rr": random.randint(14, 18),
            "temp_c": round(random.uniform(36.4, 36.9), 1),
            "spo2": random.randint(97, 99),
        },
        "labs": [],
    },
}

# ── Persona assignment ────────────────────────────────────────────────────
def pick_persona(p):
    """Assign a persona to a patient based on age, sex, row#. Deterministic."""
    n, age, sex = p["n"], p["age"], p["sex"]

    # Edge cases
    if age >= 100:  # patient 52 (age 120) — QA edge case
        return 1  # treat as healthy episodic, minimal content
    if p["n"] == 11:  # Sunita Krishnan — already has clinical content seeded
        return None  # skip

    # Complex showcase cases (10 patients)
    showcase_complex = {
        12: 8,   # Mohan Rao, 66M — post-MI polypharm (currently has iodine allergy)
        15: 5,   # Geetha Prasad, 55F — T2DM+HTN+CKD complex
        18: 8,   # Prakash Hegde, 61M — post-MI
        27: 5,   # Vikram Reddy, 71M — T2DM+HTN+CKD (currently noted ACE intolerance)
        28: 9,   # Hari Krishna, 68M — HF + AFib
        30: 6,   # Govindaraju Murthy, 74M — COPD smoker
        32: 9,   # Saraswati Bhat, 78F — HF + AFib
        40: 5,   # Patient 40, 67F — T2DM+HTN+CKD
        44: 5,   # Patient 44, 65F — T2DM+HTN+CKD
        45: 8,   # Patient 45, 70M — post-MI
    }
    if n in showcase_complex:
        return showcase_complex[n]

    # By age + sex
    if age < 19:
        return 2  # asthma + atopy (Bhavana Hegde, age 16 — has dust/pollen allergy noted)
    if age <= 30:
        return [1, 11, 2, 12][n % 4]  # healthy / migraine / asthma / depression
    if age <= 50 and sex == "F":
        return [3, 7, 10, 11, 12, 1][n % 6]
    if age <= 50:  # M
        return [3, 12, 1, 11][n % 4]
    if age <= 65 and sex == "F":
        return [3, 4, 7, 11][n % 4]
    if age <= 65:  # M
        return [3, 4, 6, 8][n % 4]
    # 65+
    if sex == "F":
        return [4, 5, 9, 7][n % 4]
    return [5, 8, 9, 6][n % 4]

# ── SQL emission ──────────────────────────────────────────────────────────
def sql_str(s):
    if s is None: return "NULL"
    return "'" + str(s).replace("'", "''") + "'"

def sql_array_text(arr):
    if not arr: return "NULL"
    return "ARRAY[" + ",".join(sql_str(x) for x in arr) + "]::text[]"

def sql_jsonb(d):
    import json as _j
    return "'" + _j.dumps(d).replace("'", "''") + "'::jsonb"

# Today (IST). Generator emits dates as DATE 'YYYY-MM-DD' literals.
TODAY = "2026-05-25"

# encounter_number suffix to mark v412 enrichment so it's identifiable + idempotent
TAG = "V412"

out = []
out.append("-- ────────────────────────────────────────────────────────────────")
out.append("-- v4.1.3 demo enrichment — generated by enrich/gen.py")
out.append("-- Seeds: persona-driven comorbidities (~50/72), 4-12 historical")
out.append("--        completed encounters per patient (clinical depth: vitals,")
out.append("--        ICD-10, Rx, lab orders + resulted values), allergies fill-in,")
out.append("--        and 16 new today encounters for V skewed for visible queue.")
out.append("-- Idempotent: encounter_number uses suffix " + TAG + ".")
out.append("--             Re-running deletes prior " + TAG + " content first.")
out.append("-- ────────────────────────────────────────────────────────────────")
out.append("BEGIN;")
out.append("")
out.append("-- 0. Clean prior v412 enrichment so this is re-runnable")
out.append("DELETE FROM prescriptions WHERE encounter_id IN (SELECT id FROM encounters WHERE encounter_number LIKE '%-" + TAG + "');")
out.append("DELETE FROM lab_results WHERE lab_order_id IN (SELECT id FROM lab_orders WHERE encounter_id IN (SELECT id FROM encounters WHERE encounter_number LIKE '%-" + TAG + "'));")
out.append("DELETE FROM lab_orders WHERE encounter_id IN (SELECT id FROM encounters WHERE encounter_number LIKE '%-" + TAG + "');")
out.append("DELETE FROM encounters WHERE encounter_number LIKE '%-" + TAG + "';")
out.append("")

# ── Pass A: comorbidities + allergy fill-in ─────────────────────────────
out.append("-- 1. Comorbidities (persona-driven)")
allergy_pool = [
    "Penicillin (rash, 2019)",
    "Sulfa drugs",
    "NSAIDs (gastric upset)",
    "Aspirin (urticaria)",
    "Iodine contrast (mild reaction 2022)",
    "Latex gloves",
    "Codeine (nausea)",
    "Pollen, dust mites",
    "Lactose intolerance",
    "Peanuts",
    "Shellfish",
    "Eggs (urticaria as child)",
    "Trimethoprim (rash)",
]
allergy_picks = list(allergy_pool)
random.shuffle(allergy_picks)
allergy_idx = 0
allergy_targets = 0  # how many empties to fill

# Target: ~35 patients with allergies. Currently ~14. Add to ~21 more empty rows.
empty_allergy_pids = [p["id"] for p in rows if not p["allergies"]]
random.shuffle(empty_allergy_pids)
allergy_fill_pids = empty_allergy_pids[:22]

for p in rows:
    persona_id = pick_persona(p)
    if persona_id is None:
        continue  # skip Sunita
    persona = PERSONAS[persona_id]
    for c in persona["comos"]:
        code, label, control, severity = c
        onset_days_ago = random.randint(180, 2200)
        out.append(
            f"INSERT INTO patient_comorbidities "
            f"(patient_id, code, label, onset_date, added_by_doctor_id, control_state, severity_state) "
            f"VALUES ({sql_str(p['id'])}, {sql_str(code)}, {sql_str(label)}, "
            f"NOW()::date - INTERVAL '{onset_days_ago} days', {sql_str(V_DOC)}, "
            f"{sql_str(control)}, {sql_str(severity)}) "
            f"ON CONFLICT (patient_id, code) DO UPDATE "
            f"SET control_state = EXCLUDED.control_state, severity_state = EXCLUDED.severity_state;")

out.append("")
out.append("-- 2. Allergies fill-in")
for pid in allergy_fill_pids:
    a = allergy_picks[allergy_idx % len(allergy_picks)]
    allergy_idx += 1
    out.append(f"UPDATE patients SET known_allergies = {sql_str(a)} WHERE id = {sql_str(pid)} AND (known_allergies IS NULL OR known_allergies = '');")
out.append("")

# ── Pass B: historical completed encounters ─────────────────────────────
# Date strategy: spread over last 365 days, weighted toward recent
out.append("-- 3. Historical completed encounters (4-12 each, clinical depth)")
enc_counter = 1
prescription_counter = 1
for p in rows:
    persona_id = pick_persona(p)
    if persona_id is None:
        continue
    persona = PERSONAS[persona_id]

    # Decide how many historical encounters this patient gets
    n_history = random.randint(persona["hx_min"], persona["hx_max"])
    # For 10-15 "showcase" patients, push to upper bound
    if p["n"] in (12, 15, 18, 27, 28, 30, 32, 40, 44, 45):
        n_history = random.randint(8, 12)

    # Generate spread dates over last 12 months
    days_ago_list = sorted(random.sample(range(15, 360), n_history), reverse=False)

    for i, days_ago in enumerate(days_ago_list):
        enc_counter += 1
        prescription_counter += 1

        # Pick a chief complaint + dx
        cc_idx = random.randrange(len(persona["ccs"]))
        cc_text, cc_chips, icd10, assess = persona["ccs"][cc_idx]

        # Vitals
        vitals = persona["vitals_template"](p["age"], p["sex"])

        # Rx
        rx_idx = random.randrange(len(persona["rx_pool"])) if persona["rx_pool"] else None

        enc_no = f"ENC-{TODAY.replace('-','')}-V{p['n']:03d}{i:02d}-{TAG}"
        enc_date_sql = f"(NOW()::date - INTERVAL '{days_ago} days')"
        completed_at_sql = f"(NOW() - INTERVAL '{days_ago} days' + INTERVAL '{random.randint(6,18)} hours')"

        # Build the prescription lines payload (jsonb)
        rx_lines = []
        if persona["rx_pool"] and rx_idx is not None:
            for line in persona["rx_pool"][rx_idx]:
                rx_lines.append({
                    "drug_name": line[0],
                    "dose": line[1],
                    "frequency": line[2],
                    "duration": line[3],
                    "instructions": line[4],
                })

        # Vitals JSONB
        v_json = {
            "bp": vitals.get("bp"),
            "hr": vitals.get("hr"),
            "rr": vitals.get("rr"),
            "temp_c": vitals.get("temp_c"),
            "spo2": vitals.get("spo2"),
        }
        if "weight_kg" in vitals: v_json["weight_kg"] = vitals["weight_kg"]
        if "peak_flow_lpm" in vitals: v_json["peak_flow_lpm"] = vitals["peak_flow_lpm"]

        # assessment_code_labels
        labels = {code: code for code in icd10}  # simple fallback

        out.append(
            f"WITH enc AS (INSERT INTO encounters "
            f"(encounter_number, patient_id, doctor_id, encounter_date, status, "
            f"started_at, completed_at, chief_complaint_chips, chief_complaint_text, "
            f"vitals, exam_findings, assessment_codes, assessment_code_labels, "
            f"assessment_text, disposition) "
            f"VALUES ({sql_str(enc_no)}, {sql_str(p['id'])}, {sql_str(V_DOC)}, "
            f"{enc_date_sql}, 'completed', {completed_at_sql} - INTERVAL '15 minutes', "
            f"{completed_at_sql}, {sql_array_text(cc_chips)}, {sql_str(cc_text)}, "
            f"{sql_jsonb(v_json)}, {sql_str('No acute distress. Exam: WNL for age.')}, "
            f"{sql_array_text(icd10)}, {sql_jsonb(labels)}, "
            f"{sql_str(assess)}, 'discharge_home'::disposition_kind) RETURNING id)"
        )
        if rx_lines:
            rx_no = f"RX-{TODAY.replace('-','')}-{p['n']:03d}{i:02d}-{TAG}"
            out.append(
                f", rx AS (INSERT INTO prescriptions (encounter_id, prescription_number, lines) "
                f"SELECT id, {sql_str(rx_no)}, {sql_jsonb(rx_lines)} FROM enc)"
            )

        # Lab orders + results for personas that have labs (~50% of visits)
        if persona["labs"] and random.random() < 0.6:
            lab = random.choice(persona["labs"])
            lab_name, lab_canon, _, _, _, lab_note = lab
            out.append(
                f", lab AS (INSERT INTO lab_orders (encounter_id, patient_id, ordering_doctor_id, raw_text, display_name, status, ordered_at, resulted_at) "
                f"SELECT id, {sql_str(p['id'])}, {sql_str(V_DOC)}, {sql_str(lab_name)}, {sql_str(lab_name)}, 'resulted', "
                f"{completed_at_sql} - INTERVAL '15 minutes', {completed_at_sql} - INTERVAL '5 minutes' FROM enc RETURNING id)"
            )
            # Insert a single resulted value (simplified)
            if lab_name == "HbA1c":
                # Progression for T2DM personas
                val = round(6.5 + (days_ago / 360.0) * 1.8, 1)  # higher when further back, improving recently
                out.append(
                    f"INSERT INTO lab_results (lab_order_id, patient_id, canonical_key, display_name, value_numeric, unit, reference_range, entered_by, entered_at) "
                    f"SELECT id, {sql_str(p['id'])}, 'hba1c', 'HbA1c', {val}, '%', '<7.0', {sql_str(V_DOC)}, {completed_at_sql} - INTERVAL '5 minutes' FROM lab;"
                )
            elif lab_name == "KFT":
                creat = round(random.uniform(0.9, 1.6), 2)
                out.append(
                    f"INSERT INTO lab_results (lab_order_id, patient_id, canonical_key, display_name, value_numeric, unit, reference_range, entered_by, entered_at) "
                    f"SELECT id, {sql_str(p['id'])}, 'creatinine', 'Creatinine', {creat}, 'mg/dL', '0.6-1.2', {sql_str(V_DOC)}, {completed_at_sql} - INTERVAL '5 minutes' FROM lab;"
                )
            elif lab_name == "TSH":
                tsh = round(random.uniform(1.2, 6.0), 2)
                out.append(
                    f"INSERT INTO lab_results (lab_order_id, patient_id, canonical_key, display_name, value_numeric, unit, reference_range, entered_by, entered_at) "
                    f"SELECT id, {sql_str(p['id'])}, 'tsh', 'TSH', {tsh}, 'mIU/L', '0.4-4.5', {sql_str(V_DOC)}, {completed_at_sql} - INTERVAL '5 minutes' FROM lab;"
                )
            elif lab_name == "Lipid panel":
                ldl = random.randint(85, 180)
                out.append(
                    f"INSERT INTO lab_results (lab_order_id, patient_id, canonical_key, display_name, value_numeric, unit, reference_range, entered_by, entered_at) "
                    f"SELECT id, {sql_str(p['id'])}, 'ldl', 'LDL cholesterol', {ldl}, 'mg/dL', '<100', {sql_str(V_DOC)}, {completed_at_sql} - INTERVAL '5 minutes' FROM lab;"
                )
            else:
                # Free-text result for non-numeric ones (Spirometry, ECG, etc.)
                out.append(
                    f"INSERT INTO lab_results (lab_order_id, patient_id, canonical_key, display_name, value_text, entered_by, entered_at) "
                    f"SELECT id, {sql_str(p['id'])}, {sql_str(lab_name.lower().replace(' ','_'))}, {sql_str(lab_name)}, {sql_str(lab_note)}, {sql_str(V_DOC)}, {completed_at_sql} - INTERVAL '5 minutes' FROM lab;"
                )
        else:
            # No lab — close the WITH chain with a dummy SELECT
            out.append("SELECT 1 FROM enc;")

# ── Pass C: 16 new today encounters for V (distributed for visibility) ──
out.append("")
out.append("-- 4. Bump V's today queue: 16 new encounters distributed waiting=8, paused=4, ready=4")
# Pick 16 patients that don't already have a today encounter
patients_with_today = set()  # we don't have today encs to dedupe against here; trust uniqueness via enc_no
# We pick patients deterministically by row id
today_patient_ids = [p["id"] for p in rows if p["n"] not in (52,)][:16]  # skip QA edge
today_distribution = (
    ["waiting_for_doctor"] * 8
    + ["paused_diagnostics"] * 4
    + ["ready_to_resume"] * 4
)
random.shuffle(today_distribution)

for i, pid in enumerate(today_patient_ids):
    status = today_distribution[i]
    enc_no = f"ENC-{TODAY.replace('-','')}-VT{i:02d}-{TAG}"
    # Pick a chief complaint from a generic pool
    ccs = [
        ("Routine follow-up, BP + DM review", ["Routine review"]),
        ("Cough x 1 week, no fever", ["Cough"]),
        ("Headache, recurrent", ["Headache"]),
        ("Back pain, mechanical", ["Back pain"]),
        ("Chest discomfort, atypical", ["Atypical chest"]),
        ("Thyroid follow-up", ["Thyroid review"]),
        ("Diabetes review", ["DM review"]),
        ("Ankle sprain, post-fall", ["Ankle injury"]),
        ("Allergic rhinitis flare", ["Rhinitis"]),
        ("Annual health check", ["Annual"]),
        ("Insomnia, 3 weeks", ["Insomnia"]),
        ("Dyspepsia, post-meal", ["Dyspepsia"]),
        ("Migraine, 2 episodes this month", ["Migraine"]),
        ("Eye redness + discharge", ["Conjunctivitis"]),
        ("Skin rash, 5 days", ["Rash"]),
        ("Knee pain, OA", ["Knee pain"]),
    ]
    cc_text, cc_chips = ccs[i % len(ccs)]

    vitals = {
        "bp": f"{random.randint(118,142)}/{random.randint(74,90)}",
        "hr": random.randint(68, 92),
        "rr": random.randint(14, 20),
        "temp_c": round(random.uniform(36.4, 37.4), 1),
        "spo2": random.randint(96, 99),
    }

    extras = ""
    paused = status == "paused_diagnostics"
    if paused:
        extras = ", paused_reason = 'lab_panel: routine review', pending_diagnostic_test = 'CBC + KFT panel'"

    out.append(
        f"INSERT INTO encounters (encounter_number, patient_id, doctor_id, encounter_date, status, "
        f"started_at, chief_complaint_chips, chief_complaint_text, vitals) "
        f"VALUES ({sql_str(enc_no)}, {sql_str(pid)}, {sql_str(V_DOC)}, "
        f"DATE '{TODAY}', '{status}'::encounter_status, NOW() - INTERVAL '{random.randint(20,300)} minutes', "
        f"{sql_array_text(cc_chips)}, {sql_str(cc_text)}, {sql_jsonb(vitals)});"
    )
    if paused:
        out.append(
            f"UPDATE encounters SET paused_reason='lab_panel: routine review', "
            f"pending_diagnostic_test='CBC + KFT panel' WHERE encounter_number = {sql_str(enc_no)};"
        )
        # Inject a fresh CBC lab order so the lab tech demo has work
        out.append(
            f"INSERT INTO lab_orders (encounter_id, patient_id, ordering_doctor_id, raw_text, display_name, status, ordered_at) "
            f"SELECT e.id, e.patient_id, e.doctor_id, 'CBC + KFT (panel review)', 'CBC + KFT (panel review)', 'pending', NOW() - INTERVAL '15 minutes' "
            f"FROM encounters e WHERE e.encounter_number = {sql_str(enc_no)};"
        )

out.append("")
out.append("COMMIT;")
out.append("")
out.append("-- Summary report")
out.append("SELECT 'patients_with_comorbidities' AS m, COUNT(DISTINCT patient_id)::text AS v FROM patient_comorbidities")
out.append(" UNION ALL SELECT 'patients_with_allergies', COUNT(*)::text FROM patients WHERE known_allergies IS NOT NULL AND known_allergies <> ''")
out.append(" UNION ALL SELECT 'total_completed_encs', COUNT(*)::text FROM encounters WHERE status='completed'")
out.append(" UNION ALL SELECT 'total_today_encs_all', COUNT(*)::text FROM encounters WHERE encounter_date = CURRENT_DATE")
out.append(" UNION ALL SELECT 'total_today_encs_V', COUNT(*)::text FROM encounters WHERE encounter_date = CURRENT_DATE AND doctor_id = " + sql_str(V_DOC))
out.append(" UNION ALL SELECT 'V_today_'||status::text, COUNT(*)::text FROM encounters WHERE encounter_date = CURRENT_DATE AND doctor_id = " + sql_str(V_DOC) + " GROUP BY status")
out.append(" UNION ALL SELECT 'avg_history_per_patient', ROUND(AVG(c)::numeric,2)::text FROM (SELECT COUNT(*) c FROM encounters WHERE status='completed' GROUP BY patient_id) x;")

Path("/tmp/opd2/enrich/enrich.sql").write_text("\n".join(out))
print("Generated:", "/tmp/opd2/enrich/enrich.sql")
print("Total lines:", len(out))
print("File size bytes:", len("\n".join(out)))
