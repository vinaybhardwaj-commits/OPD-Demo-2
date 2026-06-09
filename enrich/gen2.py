#!/usr/bin/env python3
"""
Demo enrichment v2 — bulk-insert version.

Same content as gen.py, but emits compact INSERT...VALUES bulk statements
instead of one INSERT per row. Output target: <100KB so it pastes into
Neon's SQL editor cleanly in one chunk.

Strategy:
  - Comorbidities: one bulk INSERT with VALUES list
  - Encounters: one bulk INSERT with VALUES list  (4-8 historical each)
  - Prescriptions: INSERT...SELECT joining encounters by encounter_number
                   from a VALUES list of (number, lines_json) pairs
  - Lab orders: INSERT...SELECT joining encounters similarly
  - Lab results: skipped for compactness — the route's KB-grounded
                 ask-the-chart rail will surface "no labs resulted yet"
                 which is more honest than scattershot single values
  - Today encounters: bulk INSERT
  - Allergies: bulk UPDATE via VALUES join

Idempotent: encounter_number suffix V412 makes re-runs safe.
"""
import random, json
from pathlib import Path

random.seed(42)
V_DOC = "2a03f6df-6023-4250-92ad-bd8770196f08"
TODAY = "2026-05-25"
TAG = "V412"

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

# ── Persona definitions (compacted) ─────────────────────────────────────
# Tuple format: (name, comorbidities[], hx_min, hx_max, vitals_fn, ccs[],
#                rx_pool[], lab_pool[])
PERSONAS = {
    1: dict(
        name="healthy_episodic",
        comos=[],
        hx=(3, 6),
        vitals=lambda: dict(bp=f"{random.randint(110,128)}/{random.randint(70,82)}", hr=random.randint(68,88), rr=random.randint(14,18), temp_c=round(random.uniform(36.4,37.4),1), spo2=random.randint(97,99)),
        ccs=[
            ("Cough + sore throat, 3 days", ["Cough"], ["J06.9"], "Acute viral URTI"),
            ("Loose stools, 24 hours", ["Diarrhea"], ["K59.1"], "Acute gastroenteritis, viral"),
            ("Dysmenorrhea, paracetamol working", ["Dysmenorrhea"], ["N94.4"], "Primary dysmenorrhea"),
            ("Back pain after gym, 2 days", ["Back pain"], ["M54.5"], "Acute mechanical low back pain"),
            ("Headache + nausea, this morning", ["Headache"], ["G44.1"], "Tension-type headache"),
            ("Routine health check, no complaints", ["Annual check"], ["Z00.0"], "Routine adult health exam, no findings"),
        ],
        rx=[
            [("Paracetamol 500mg","1 tab","TID","3 days","PO")],
            [("Levocetirizine 5mg","1 tab","HS","5 days","PO")],
            [("ORS sachet","1 in 200ml","after each stool","as needed","PO"),("Probiotic","1 cap","BID","5 days","PO")],
            [("Ibuprofen 400mg","1 tab","BID","3 days","PO with food")],
            [],
        ],
        labs=[],
    ),
    2: dict(
        name="asthma_atopy",
        comos=[("J45.909","Asthma, unspecified","partial","mild"),("J30.1","Allergic rhinitis due to pollen","partial","mild")],
        hx=(4, 7),
        vitals=lambda: dict(bp=f"{random.randint(110,124)}/{random.randint(68,78)}", hr=random.randint(78,96), rr=random.randint(18,24), temp_c=round(random.uniform(36.5,37.1),1), spo2=random.randint(95,98), peak_flow_lpm=random.randint(280,420)),
        ccs=[
            ("Wheeze + nocturnal cough, worse this week", ["Wheeze","Cough"], ["J45.909"], "Asthma exacerbation, mild — step up controller"),
            ("Allergic rhinitis flare, post-nasal drip", ["Sneezing","Rhinorrhea"], ["J30.1"], "Allergic rhinitis flare — seasonal"),
            ("Routine asthma review, well-controlled", ["Asthma review"], ["J45.909"], "Asthma — well controlled on current regimen"),
        ],
        rx=[
            [("Budesonide-Formoterol 200/6 inhaler","2 puffs","BID","30 days","Inhaled, rinse mouth")],
            [("Salbutamol 100mcg inhaler","2 puffs","PRN","30 days","Inhaled, max 4/day"),("Levocetirizine 5mg","1 tab","HS","10 days","PO")],
            [("Montelukast 10mg","1 tab","HS","30 days","PO")],
        ],
        labs=["Spirometry"],
    ),
    3: dict(
        name="htn_dyslipidemia",
        comos=[("I10","Essential (primary) hypertension","partial","moderate"),("E78.5","Hyperlipidemia, unspecified","well","mild")],
        hx=(5, 8),
        vitals=lambda: dict(bp=f"{random.randint(132,150)}/{random.randint(82,96)}", hr=random.randint(70,84), rr=random.randint(14,18), temp_c=round(random.uniform(36.4,36.9),1), spo2=random.randint(96,99), weight_kg=round(random.uniform(66,84),1)),
        ccs=[
            ("Routine BP review", ["BP check"], ["I10"], "Essential HTN, controlled. Continue."),
            ("Occasional headaches", ["Headache"], ["I10","G44.1"], "Headache likely tension; BP 138/86 — at target."),
            ("Dizziness on standing", ["Postural dizziness"], ["I10"], "Mild orthostatic; reduced amlodipine."),
            ("Lipid review, fasting", ["Lipid follow-up"], ["E78.5"], "LDL 110 → statin titrated up."),
        ],
        rx=[
            [("Telmisartan 40mg","1 tab","OD morning","30 days","PO"),("Atorvastatin 10mg","1 tab","HS","30 days","PO")],
            [("Amlodipine 5mg","1 tab","OD morning","30 days","PO"),("Atorvastatin 20mg","1 tab","HS","30 days","PO")],
            [("Telmisartan-Amlodipine 40/5","1 tab","OD morning","30 days","PO"),("Atorvastatin 10mg","1 tab","HS","30 days","PO")],
        ],
        labs=["Lipid panel","KFT"],
    ),
    4: dict(
        name="t2dm_uncomplicated",
        comos=[("E11.9","Type 2 diabetes mellitus without complications","partial","moderate"),("E78.5","Hyperlipidemia, unspecified","partial","mild")],
        hx=(6, 10),
        vitals=lambda: dict(bp=f"{random.randint(124,140)}/{random.randint(78,88)}", hr=random.randint(70,86), rr=random.randint(14,18), temp_c=round(random.uniform(36.4,36.9),1), spo2=random.randint(96,99), weight_kg=round(random.uniform(70,92),1)),
        ccs=[
            ("HbA1c follow-up, 3-month review", ["HbA1c review"], ["E11.9"], "T2DM — reinforce diet, continue metformin."),
            ("Polyuria + thirst, 2 weeks", ["Polyuria","Polydipsia"], ["E11.9"], "Suboptimal control; add second OHA."),
            ("Foot tingling, no ulcer", ["Foot paraesthesia"], ["E11.40"], "Early diabetic neuropathy."),
            ("Routine quarterly DM review", ["Diabetes review"], ["E11.9"], "T2DM — A1c 6.9%, at target."),
        ],
        rx=[
            [("Metformin 1000mg","1 tab","BID after meals","30 days","PO")],
            [("Metformin 1000mg","1 tab","BID","30 days","PO"),("Glimepiride 2mg","1 tab","OD before breakfast","30 days","PO")],
            [("Metformin 1000mg","1 tab","BID","30 days","PO"),("Vildagliptin 50mg","1 tab","BID","30 days","PO"),("Atorvastatin 10mg","1 tab","HS","30 days","PO")],
        ],
        labs=["HbA1c","Fasting glucose","Lipid panel","KFT"],
    ),
    5: dict(
        name="t2dm_htn_ckd",
        comos=[("E11.22","Type 2 diabetes with diabetic chronic kidney disease","uncontrolled","moderate"),("I12.9","Hypertensive chronic kidney disease without HF","partial","moderate"),("N18.3","Chronic kidney disease, stage 3","partial","moderate"),("E78.5","Hyperlipidemia, unspecified","well","mild")],
        hx=(8, 12),
        vitals=lambda: dict(bp=f"{random.randint(138,160)}/{random.randint(84,98)}", hr=random.randint(72,88), rr=random.randint(14,20), temp_c=round(random.uniform(36.4,36.9),1), spo2=random.randint(95,98), weight_kg=round(random.uniform(72,96),1)),
        ccs=[
            ("Quarterly DM + CKD review", ["Diabetes review","CKD review"], ["E11.22","N18.3"], "T2DM+CKD3 — A1c 7.6%, eGFR 48. Hold metformin if eGFR<45."),
            ("Leg swelling at end of day", ["Pedal edema"], ["N18.3","I12.9"], "Pedal edema; furosemide added; restrict salt."),
            ("BP rise to 168/96 at home", ["Severe HTN"], ["I12.9"], "Uncontrolled HTN; titrate amlodipine."),
            ("Foot ulcer screening", ["Diabetic foot check"], ["E11.621"], "No ulcer; reinforce footcare."),
        ],
        rx=[
            [("Telmisartan 40mg","1 tab","OD morning","30 days","PO"),("Amlodipine 5mg","1 tab","OD morning","30 days","PO"),("Metformin 500mg (renal)","1 tab","BID","30 days","PO"),("Atorvastatin 20mg","1 tab","HS","30 days","PO")],
            [("Telmisartan 80mg","1 tab","OD morning","30 days","PO"),("Amlodipine 10mg","1 tab","OD morning","30 days","PO"),("Linagliptin 5mg","1 tab","OD","30 days","PO"),("Atorvastatin 40mg","1 tab","HS","30 days","PO"),("Furosemide 20mg","1 tab","OD morning","30 days","PO")],
        ],
        labs=["HbA1c","KFT","Urine ACR","Lipid panel","CBC"],
    ),
    6: dict(
        name="copd_smoker",
        comos=[("J44.9","Chronic obstructive pulmonary disease, unspecified","partial","moderate"),("F17.210","Nicotine dependence, cigarettes, uncomplicated","uncontrolled","moderate")],
        hx=(5, 8),
        vitals=lambda: dict(bp=f"{random.randint(122,138)}/{random.randint(76,86)}", hr=random.randint(84,102), rr=random.randint(18,26), temp_c=round(random.uniform(36.6,37.6),1), spo2=random.randint(90,95)),
        ccs=[
            ("Increasing dyspnea on exertion, 4 weeks", ["Dyspnea"], ["J44.9"], "COPD — moderate worsening. Step up to LAMA+LABA."),
            ("Cough with white sputum, smoker", ["Cough","Sputum"], ["J44.9"], "Stable COPD; reinforce smoking cessation."),
            ("AECOPD: dyspnea + green sputum", ["AECOPD"], ["J44.1"], "AECOPD; oral steroids + amoxiclav."),
        ],
        rx=[
            [("Tiotropium 18mcg inhaler","1 cap","OD","30 days","Inhaled via Rotahaler"),("Salbutamol 100mcg","2 puffs","PRN","30 days","Inhaled")],
            [("Tiotropium-Formoterol 9/12","1 cap","BID","30 days","Inhaled"),("Prednisolone 40mg","1 tab","OD morning","5 days","PO with food"),("Amoxicillin-Clav 625mg","1 tab","TID","7 days","PO")],
        ],
        labs=["Spirometry","Chest X-ray"],
    ),
    7: dict(
        name="hypothyroid",
        comos=[("E03.9","Hypothyroidism, unspecified","well","mild")],
        hx=(4, 7),
        vitals=lambda: dict(bp=f"{random.randint(112,126)}/{random.randint(70,80)}", hr=random.randint(58,76), rr=random.randint(12,16), temp_c=round(random.uniform(36.3,36.8),1), spo2=random.randint(97,99), weight_kg=round(random.uniform(58,76),1)),
        ccs=[
            ("TSH check, on Eltroxin", ["TSH review"], ["E03.9"], "Hypothyroid — TSH 2.4, in range."),
            ("Cold intolerance, weight gain", ["Cold intolerance"], ["E03.9"], "TSH 8.6 — increased dose."),
            ("Routine thyroid review", ["Thyroid review"], ["E03.9"], "Stable, continue thyroxine."),
        ],
        rx=[
            [("Levothyroxine 50mcg","1 tab","OD empty stomach","30 days","PO 30 min before food")],
            [("Levothyroxine 75mcg","1 tab","OD empty stomach","30 days","PO")],
            [("Levothyroxine 100mcg","1 tab","OD empty stomach","30 days","PO")],
        ],
        labs=["TSH","Free T4"],
    ),
    8: dict(
        name="post_mi_polypharm",
        comos=[("I25.10","Atherosclerotic heart disease of native coronary artery","partial","moderate"),("Z95.5","Presence of coronary angioplasty implant and graft","well","mild"),("I10","Essential hypertension","partial","moderate"),("E78.5","Hyperlipidemia, unspecified","well","mild")],
        hx=(7, 11),
        vitals=lambda: dict(bp=f"{random.randint(124,144)}/{random.randint(78,90)}", hr=random.randint(58,72), rr=random.randint(14,18), temp_c=round(random.uniform(36.4,36.9),1), spo2=random.randint(96,99), weight_kg=round(random.uniform(70,86),1)),
        ccs=[
            ("Routine post-PCI review", ["Cardio review"], ["I25.10","Z95.5"], "Stable post-PCI 2024; DAPT continued; LDL at target."),
            ("Mild dyspnea on stairs", ["Dyspnea on exertion"], ["I25.10"], "Stress test — no inducible ischemia. Optimize meds."),
            ("Bleeding gums on DAPT", ["Gum bleeding"], ["Z79.02"], "Reduced clopidogrel at 12-mo mark."),
            ("Annual LDL check", ["Lipid follow-up"], ["E78.5"], "LDL 65 — excellent on high-intensity statin."),
        ],
        rx=[
            [("Aspirin 75mg","1 tab","OD after lunch","30 days","PO"),("Clopidogrel 75mg","1 tab","OD after dinner","30 days","PO"),("Atorvastatin 40mg","1 tab","HS","30 days","PO"),("Metoprolol succinate 50mg","1 tab","OD morning","30 days","PO"),("Ramipril 5mg","1 tab","OD morning","30 days","PO")],
            [("Aspirin 75mg","1 tab","OD after lunch","30 days","PO"),("Atorvastatin 80mg","1 tab","HS","30 days","PO"),("Bisoprolol 5mg","1 tab","OD morning","30 days","PO"),("Telmisartan 40mg","1 tab","OD morning","30 days","PO")],
        ],
        labs=["Lipid panel","KFT","LFT","ECG"],
    ),
    9: dict(
        name="hf_afib",
        comos=[("I50.9","Heart failure, unspecified","partial","moderate"),("I48.91","Atrial fibrillation, unspecified","partial","moderate"),("I10","Essential hypertension","well","mild")],
        hx=(6, 10),
        vitals=lambda: dict(bp=f"{random.randint(110,128)}/{random.randint(66,78)}", hr=random.randint(72,96), rr=random.randint(16,22), temp_c=round(random.uniform(36.4,36.8),1), spo2=random.randint(94,97), weight_kg=round(random.uniform(64,84),1)),
        ccs=[
            ("Routine HF/AFib follow-up", ["HF review"], ["I50.9","I48.91"], "Stable HFrEF 35%; rate-controlled. Continue apixaban."),
            ("Weight +2 kg / 1 wk, mild dyspnea", ["Weight gain","Dyspnea"], ["I50.9"], "Mild fluid retention; up furosemide 5 days."),
            ("Bruise on shin, on apixaban", ["Bruising"], ["I48.91"], "Apixaban ecchymosis; continue."),
            ("Echo annual review", ["Echo"], ["I50.9"], "LVEF 38% — stable. Maintain GDMT."),
        ],
        rx=[
            [("Apixaban 5mg","1 tab","BID","30 days","PO"),("Bisoprolol 5mg","1 tab","OD morning","30 days","PO"),("Furosemide 40mg","1 tab","OD morning","30 days","PO"),("Spironolactone 25mg","1 tab","OD morning","30 days","PO"),("Sacubitril-Valsartan 49/51","1 tab","BID","30 days","PO")],
        ],
        labs=["NT-proBNP","KFT","TSH","ECG"],
    ),
    10: dict(
        name="ra_methotrexate",
        comos=[("M05.79","Rheumatoid arthritis with rheumatoid factor","partial","moderate"),("E03.9","Hypothyroidism, unspecified","well","mild")],
        hx=(6, 9),
        vitals=lambda: dict(bp=f"{random.randint(118,132)}/{random.randint(74,84)}", hr=random.randint(70,86), rr=random.randint(14,18), temp_c=round(random.uniform(36.4,37.1),1), spo2=random.randint(96,99), weight_kg=round(random.uniform(54,72),1)),
        ccs=[
            ("Monthly MTX review", ["RA review"], ["M05.79"], "RA — DAS28 3.1, low activity. Continue MTX 15mg weekly."),
            ("Mouth ulcers on MTX", ["Mouth ulcers"], ["M05.79"], "Folate-deficiency stomatitis; up folic acid."),
            ("Morning stiffness >1 hour, flare", ["Joint stiffness"], ["M05.79"], "RA flare; short prednisolone taper."),
        ],
        rx=[
            [("Methotrexate 15mg","1 tab","OD weekly Sunday","30 days","PO"),("Folic acid 5mg","1 tab","OD except MTX day","30 days","PO"),("Hydroxychloroquine 200mg","1 tab","BID after meals","30 days","PO")],
            [("Methotrexate 20mg","1 tab","OD weekly","30 days","PO"),("Folic acid 5mg","1 tab","OD","30 days","PO"),("Prednisolone 10mg","1 tab","OD morning, taper","14 days","PO")],
        ],
        labs=["CBC","LFT","KFT","ESR"],
    ),
    11: dict(
        name="migraine_gerd",
        comos=[("G43.909","Migraine, unspecified, not intractable, without status migrainosus","partial","mild"),("K21.9","Gastro-esophageal reflux disease without esophagitis","partial","mild")],
        hx=(4, 6),
        vitals=lambda: dict(bp=f"{random.randint(112,124)}/{random.randint(70,80)}", hr=random.randint(64,80), rr=random.randint(14,18), temp_c=round(random.uniform(36.4,36.9),1), spo2=random.randint(97,99)),
        ccs=[
            ("Migraine 2x this week, sumatriptan worked", ["Migraine"], ["G43.909"], "Migraine — continue PRN; add propranolol prophylaxis."),
            ("Heartburn at night, 2 weeks", ["Heartburn"], ["K21.9"], "GERD — PPI step-up; lifestyle counseling."),
            ("Routine review", ["Migraine review"], ["G43.909"], "Migraine frequency 1/month on propranolol."),
        ],
        rx=[
            [("Sumatriptan 50mg","1 tab","PRN onset","10 tabs","PO max 2/24h"),("Pantoprazole 40mg","1 tab","OD empty stomach","30 days","PO")],
            [("Propranolol 40mg","1 tab","BID","30 days","PO"),("Pantoprazole 40mg","1 tab","OD","30 days","PO"),("Sumatriptan 50mg","1 tab","PRN","10 tabs","PO max 2/24h")],
        ],
        labs=[],
    ),
    12: dict(
        name="depression_anxiety",
        comos=[("F33.1","Major depressive disorder, recurrent, moderate","partial","moderate"),("F41.1","Generalized anxiety disorder","partial","moderate")],
        hx=(4, 7),
        vitals=lambda: dict(bp=f"{random.randint(114,128)}/{random.randint(70,82)}", hr=random.randint(72,90), rr=random.randint(14,18), temp_c=round(random.uniform(36.4,36.9),1), spo2=random.randint(97,99)),
        ccs=[
            ("Mood low, sleep poor, 3 weeks", ["Low mood"], ["F33.1"], "Recurrent MDD episode; titrate sertraline up."),
            ("Anxiety + palpitations", ["Anxiety"], ["F41.1"], "GAD — sertraline ongoing; clonazepam PRN."),
            ("Routine psych follow-up", ["Psych review"], ["F33.1"], "Stable, PHQ-9 7. Continue sertraline 100mg."),
        ],
        rx=[
            [("Sertraline 50mg","1 tab","OD morning","30 days","PO")],
            [("Sertraline 100mg","1 tab","OD morning","30 days","PO"),("Clonazepam 0.25mg","1 tab","PRN at bedtime","14 tabs","PO")],
        ],
        labs=[],
    ),
}

def pick_persona(p):
    n, age, sex = p["n"], p["age"], p["sex"]
    if age >= 100: return 1
    if n == 11: return None  # Sunita
    showcase = {12:8, 15:5, 18:8, 27:5, 28:9, 30:6, 32:9, 40:5, 44:5, 45:8}
    if n in showcase: return showcase[n]
    if age < 19: return 2
    if age <= 30: return [1,11,2,12][n % 4]
    if age <= 50 and sex == "F": return [3,7,10,11,12,1][n % 6]
    if age <= 50: return [3,12,1,11][n % 4]
    if age <= 65 and sex == "F": return [3,4,7,11][n % 4]
    if age <= 65: return [3,4,6,8][n % 4]
    if sex == "F": return [4,5,9,7][n % 4]
    return [5,8,9,6][n % 4]

def q(s):
    if s is None: return "NULL"
    return "'" + str(s).replace("'", "''") + "'"

def qjson(d):
    return "'" + json.dumps(d, separators=(",",":")).replace("'", "''") + "'::jsonb"

def qarr(arr):
    if not arr: return "NULL"
    return "ARRAY[" + ",".join(q(x) for x in arr) + "]::text[]"

out = []
out.append("-- v4.1.3 demo enrichment (bulk, gen2.py)")
out.append("BEGIN;")
out.append("-- 0. Clean prior v412 enrichment for re-runnability")
out.append(f"DELETE FROM prescriptions WHERE encounter_id IN (SELECT id FROM encounters WHERE encounter_number LIKE '%-{TAG}');")
out.append(f"DELETE FROM lab_orders WHERE encounter_id IN (SELECT id FROM encounters WHERE encounter_number LIKE '%-{TAG}');")
out.append(f"DELETE FROM encounters WHERE encounter_number LIKE '%-{TAG}';")

# ── 1. Comorbidities bulk ────────────────────────────────────────────────
out.append("\n-- 1. Comorbidities")
como_rows = []
for p in rows:
    pid = pick_persona(p)
    if pid is None: continue
    for c in PERSONAS[pid]["comos"]:
        code, label, ctrl, sev = c
        ago = random.randint(180, 2200)
        como_rows.append(f"({q(p['id'])},{q(code)},{q(label)},NOW()::date - INTERVAL '{ago} days',{q(V_DOC)},{q(ctrl)},{q(sev)})")
if como_rows:
    out.append(
        "INSERT INTO patient_comorbidities (patient_id,code,label,onset_date,added_by_doctor_id,control_state,severity_state) VALUES\n"
        + ",\n".join(como_rows)
        + "\nON CONFLICT (patient_id,code) DO UPDATE SET control_state=EXCLUDED.control_state, severity_state=EXCLUDED.severity_state;"
    )

# ── 2. Allergies bulk update ─────────────────────────────────────────────
out.append("\n-- 2. Allergies fill-in")
allergy_pool = [
    "Penicillin (rash, 2019)", "Sulfa drugs", "NSAIDs (gastric upset)",
    "Aspirin (urticaria)", "Iodine contrast (mild reaction 2022)",
    "Latex gloves", "Codeine (nausea)", "Pollen, dust mites",
    "Lactose intolerance", "Peanuts", "Shellfish",
    "Eggs (urticaria as child)", "Trimethoprim (rash)",
]
allergy_picks = list(allergy_pool); random.shuffle(allergy_picks)
empty_ids = [p["id"] for p in rows if not p["allergies"] and p["n"] != 52]
random.shuffle(empty_ids)
for i, pid in enumerate(empty_ids[:22]):
    out.append(f"UPDATE patients SET known_allergies={q(allergy_picks[i % len(allergy_picks)])} WHERE id={q(pid)} AND (known_allergies IS NULL OR known_allergies='');")

# ── 3. Historical encounters bulk ────────────────────────────────────────
out.append("\n-- 3. Historical completed encounters")
enc_values = []
prescription_values = []  # (encounter_number, rx_no, lines_json)
lab_values = []  # (encounter_number, display_name, ordered_offset_min, resulted_offset_min)

for p in rows:
    pid = pick_persona(p)
    if pid is None: continue
    persona = PERSONAS[pid]
    n_hx = random.randint(*persona["hx"])
    if p["n"] in (12,15,18,27,28,30,32,40,44,45): n_hx = random.randint(8, 12)
    days_ago_list = sorted(random.sample(range(15, 360), n_hx))
    for i, days_ago in enumerate(days_ago_list):
        cc_text, cc_chips, icd10, assess = persona["ccs"][i % len(persona["ccs"])]
        vitals = persona["vitals"]()
        enc_no = f"ENC-{TODAY.replace('-','')}-V{p['n']:03d}{i:02d}-{TAG}"
        enc_date_expr = f"(NOW()::date - INTERVAL '{days_ago} days')"
        compl_at_expr = f"(NOW() - INTERVAL '{days_ago} days' + INTERVAL '{random.randint(6,18)} hours')"
        started_at_expr = compl_at_expr + " - INTERVAL '15 minutes'"
        labels = {c: c for c in icd10}
        enc_values.append(
            f"({q(enc_no)},{q(p['id'])},{q(V_DOC)},{enc_date_expr},'completed','active'::encounter_status_ignored,{started_at_expr},{compl_at_expr},{qarr(cc_chips)},{q(cc_text)},{qjson(vitals)},{q('No acute distress. Exam: WNL for age.')},{qarr(icd10)},{qjson(labels)},{q(assess)},'discharge_home'::disposition_kind)"
            .replace(",'active'::encounter_status_ignored,", ",")  # we'll fix below
        )
        # The fancy column override above was a placeholder; let me redo: enc_values needs to match the INSERT column list. I'll fix in the final emit.
        # Rx
        if persona["rx"]:
            rx = persona["rx"][i % len(persona["rx"])]
            if rx:
                lines = [{"drug_name":r[0],"dose":r[1],"frequency":r[2],"duration":r[3],"instructions":r[4]} for r in rx]
                rx_no = f"RX-{TODAY.replace('-','')}-{p['n']:03d}{i:02d}-{TAG}"
                prescription_values.append((enc_no, rx_no, qjson(lines)))
        # Lab (50% chance for personas with labs)
        if persona["labs"] and random.random() < 0.5:
            lab_name = random.choice(persona["labs"])
            lab_values.append((enc_no, lab_name, days_ago))

# Emit encounters bulk
# Columns: encounter_number, patient_id, doctor_id, encounter_date, status,
#          started_at, completed_at, chief_complaint_chips, chief_complaint_text,
#          vitals, exam_findings, assessment_codes, assessment_code_labels,
#          assessment_text, disposition
# I built enc_values with a wrong format (had the placeholder). Rebuild cleanly:
enc_values = []
for p in rows:
    pid = pick_persona(p)
    if pid is None: continue
    persona = PERSONAS[pid]
    # Re-roll same content with the same seed-state... but we already consumed RNG.
    # Easier: just rebuild deterministically via a separate seed per patient.
    pass  # we'll rebuild below using a deterministic approach

# Actually simplest: redo the loop, building enc_values+prescription_values+lab_values cleanly
random.seed(42)
enc_values = []
prescription_values = []
lab_values = []
for p in rows:
    pid = pick_persona(p)
    if pid is None: continue
    persona = PERSONAS[pid]
    # Restore RNG advancement from the matching first loop to use random
    # (re-rolling some values is fine since we just need realism)

# OK, going to simplify: one clean pass building all three.
random.seed(42)
enc_values = []
prescription_values = []
lab_values = []
for p in rows:
    pid = pick_persona(p)
    if pid is None: continue
    persona = PERSONAS[pid]
    n_hx = random.randint(*persona["hx"])
    if p["n"] in (12,15,18,27,28,30,32,40,44,45): n_hx = random.randint(8, 12)
    days_ago_list = sorted(random.sample(range(15, 360), n_hx))
    for i, days_ago in enumerate(days_ago_list):
        cc_text, cc_chips, icd10, assess = persona["ccs"][i % len(persona["ccs"])]
        vitals = persona["vitals"]()
        enc_no = f"ENC-{TODAY.replace('-','')}-V{p['n']:03d}{i:02d}-{TAG}"
        enc_date_expr = f"(NOW()::date - INTERVAL '{days_ago} days')"
        compl_at_expr = f"(NOW() - INTERVAL '{days_ago} days' + INTERVAL '{random.randint(6,18)} hours')"
        started_at_expr = f"({compl_at_expr} - INTERVAL '15 minutes')"
        labels = {c: c for c in icd10}
        enc_values.append(
            "(" + ",".join([
                q(enc_no), q(p["id"]), q(V_DOC), enc_date_expr,
                "'completed'::encounter_status",
                started_at_expr, compl_at_expr,
                qarr(cc_chips), q(cc_text), qjson(vitals),
                q("No acute distress. Exam: WNL for age."),
                qarr(icd10), qjson(labels), q(assess),
                "'discharge_home'::disposition_kind",
            ]) + ")"
        )
        if persona["rx"]:
            rx = persona["rx"][i % len(persona["rx"])]
            if rx:
                lines = [{"drug_name":r[0],"dose":r[1],"frequency":r[2],"duration":r[3],"instructions":r[4]} for r in rx]
                rx_no = f"RX-{TODAY.replace('-','')}-{p['n']:03d}{i:02d}-{TAG}"
                prescription_values.append((enc_no, rx_no, qjson(lines)))
        if persona["labs"] and random.random() < 0.5:
            lab_name = random.choice(persona["labs"])
            lab_values.append((enc_no, lab_name, days_ago))

# Bulk INSERT for encounters
if enc_values:
    out.append(
        "INSERT INTO encounters "
        "(encounter_number,patient_id,doctor_id,encounter_date,status,started_at,completed_at,"
        "chief_complaint_chips,chief_complaint_text,vitals,exam_findings,assessment_codes,"
        "assessment_code_labels,assessment_text,disposition) VALUES\n"
        + ",\n".join(enc_values) + ";"
    )

# Bulk INSERT for prescriptions (resolve encounter_id by encounter_number)
if prescription_values:
    out.append("\n-- 4. Prescriptions for historical encounters")
    rx_values = [f"({q(en)},{q(rxn)},{rx_json})" for en, rxn, rx_json in prescription_values]
    out.append(
        "INSERT INTO prescriptions (encounter_id, prescription_number, lines)\n"
        "SELECT e.id, v.rxn, v.lines FROM (VALUES\n"
        + ",\n".join(rx_values)
        + ") AS v(enc_no,rxn,lines) JOIN encounters e ON e.encounter_number = v.enc_no;"
    )

# Bulk INSERT for lab_orders (resulted)
if lab_values:
    out.append("\n-- 5. Lab orders (resulted) for historical encounters")
    lo_values = [f"({q(en)},{q(ln)},{da})" for en, ln, da in lab_values]
    out.append(
        "INSERT INTO lab_orders (encounter_id, patient_id, ordering_doctor_id, raw_text, display_name, status, ordered_at, resulted_at)\n"
        "SELECT e.id, e.patient_id, e.doctor_id, v.lab_name, v.lab_name, 'resulted', "
        "(NOW() - INTERVAL '1 days' * v.days_ago + INTERVAL '5 hours'), "
        "(NOW() - INTERVAL '1 days' * v.days_ago + INTERVAL '7 hours') FROM (VALUES\n"
        + ",\n".join(lo_values)
        + ") AS v(enc_no,lab_name,days_ago) JOIN encounters e ON e.encounter_number = v.enc_no;"
    )

# ── 6. Today encounters bump for V ───────────────────────────────────────
out.append("\n-- 6. New today encounters for V (16 new — 8 waiting, 4 paused, 4 ready)")
today_pids = [p["id"] for p in rows if p["n"] not in (52,)][:16]
distribution = ["waiting_for_doctor"]*8 + ["paused_diagnostics"]*4 + ["ready_to_resume"]*4
random.shuffle(distribution)
ccs_today = [
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
today_enc_values = []
paused_enc_numbers = []
for i, pid in enumerate(today_pids):
    status = distribution[i]
    enc_no = f"ENC-{TODAY.replace('-','')}-VT{i:02d}-{TAG}"
    cc_text, cc_chips = ccs_today[i % len(ccs_today)]
    vitals = dict(bp=f"{random.randint(118,142)}/{random.randint(74,90)}", hr=random.randint(68,92), rr=random.randint(14,20), temp_c=round(random.uniform(36.4,37.4),1), spo2=random.randint(96,99))
    paused_reason_v = "'lab_panel: routine review'" if status == "paused_diagnostics" else "NULL"
    pending_test_v  = "'CBC + KFT panel'" if status == "paused_diagnostics" else "NULL"
    today_enc_values.append(
        "(" + ",".join([
            q(enc_no), q(pid), q(V_DOC), f"DATE '{TODAY}'",
            f"'{status}'::encounter_status",
            f"NOW() - INTERVAL '{random.randint(20,300)} minutes'",
            qarr(cc_chips), q(cc_text), qjson(vitals),
            paused_reason_v, pending_test_v,
        ]) + ")"
    )
    if status == "paused_diagnostics":
        paused_enc_numbers.append(enc_no)

out.append(
    "INSERT INTO encounters (encounter_number,patient_id,doctor_id,encounter_date,status,started_at,chief_complaint_chips,chief_complaint_text,vitals,paused_reason,pending_diagnostic_test) VALUES\n"
    + ",\n".join(today_enc_values) + ";"
)

# Inject lab orders for the paused ones
if paused_enc_numbers:
    out.append("\n-- 7. Fresh CBC+KFT lab orders for the 4 new paused today-encounters")
    out.append(
        "INSERT INTO lab_orders (encounter_id, patient_id, ordering_doctor_id, raw_text, display_name, status, ordered_at)\n"
        "SELECT e.id, e.patient_id, e.doctor_id, 'CBC + KFT (panel review)', 'CBC + KFT (panel review)', 'pending', NOW() - INTERVAL '15 minutes' "
        f"FROM encounters e WHERE e.encounter_number IN ({','.join(q(en) for en in paused_enc_numbers)});"
    )

out.append("\nCOMMIT;")
out.append("\n-- Summary")
out.append("SELECT 'patients_with_comorbidities' AS m, COUNT(DISTINCT patient_id)::text AS v FROM patient_comorbidities")
out.append(" UNION ALL SELECT 'patients_with_allergies', COUNT(*)::text FROM patients WHERE known_allergies IS NOT NULL AND known_allergies <> ''")
out.append(" UNION ALL SELECT 'total_completed_encs', COUNT(*)::text FROM encounters WHERE status='completed'")
out.append(" UNION ALL SELECT 'total_today_encs_all', COUNT(*)::text FROM encounters WHERE encounter_date = CURRENT_DATE")
out.append(" UNION ALL SELECT 'V_today_'||status::text, COUNT(*)::text FROM encounters WHERE encounter_date = CURRENT_DATE AND doctor_id = " + q(V_DOC) + " GROUP BY status")
out.append(" UNION ALL SELECT 'avg_history_per_patient', ROUND(AVG(c)::numeric,2)::text FROM (SELECT COUNT(*) c FROM encounters WHERE status='completed' GROUP BY patient_id) x;")

path = "/tmp/opd2/enrich/enrich2.sql"
Path(path).write_text("\n".join(out))
print("Generated:", path)
print("Total lines:", len(out))
print("File size bytes:", len("\n".join(out)))
