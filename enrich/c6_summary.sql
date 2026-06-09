SELECT 'patients_with_comorbidities' AS m, COUNT(DISTINCT patient_id)::text AS v FROM patient_comorbidities
 UNION ALL SELECT 'patients_with_allergies', COUNT(*)::text FROM patients WHERE known_allergies IS NOT NULL AND known_allergies <> ''
 UNION ALL SELECT 'total_completed_encs', COUNT(*)::text FROM encounters WHERE status='completed'
 UNION ALL SELECT 'V_today_'||status::text, COUNT(*)::text FROM encounters WHERE encounter_date = CURRENT_DATE AND doctor_id = '2a03f6df-6023-4250-92ad-bd8770196f08' GROUP BY status
 UNION ALL SELECT 'avg_history_per_patient', ROUND(AVG(c)::numeric,2)::text FROM (SELECT COUNT(*) c FROM encounters WHERE status='completed' GROUP BY patient_id) x;