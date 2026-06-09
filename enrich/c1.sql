-- CHUNK 1: comorbidities + allergies
BEGIN;
DELETE FROM prescriptions WHERE encounter_id IN (SELECT id FROM encounters WHERE encounter_number LIKE '%-V412');
DELETE FROM lab_orders WHERE encounter_id IN (SELECT id FROM encounters WHERE encounter_number LIKE '%-V412');
DELETE FROM encounters WHERE encounter_number LIKE '%-V412';
-- 1. Comorbidities
INSERT INTO patient_comorbidities (patient_id,code,label,onset_date,added_by_doctor_id,control_state,severity_state) VALUES
('22027b9d-049c-4237-9b9e-99a26bd57075','G43.909','Migraine, unspecified, not intractable, without status migrainosus',NOW()::date - INTERVAL '1489 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('22027b9d-049c-4237-9b9e-99a26bd57075','K21.9','Gastro-esophageal reflux disease without esophagitis',NOW()::date - INTERVAL '408 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('bd92918f-47c0-4f61-aeb4-bf37b29cd32d','G43.909','Migraine, unspecified, not intractable, without status migrainosus',NOW()::date - INTERVAL '231 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('bd92918f-47c0-4f61-aeb4-bf37b29cd32d','K21.9','Gastro-esophageal reflux disease without esophagitis',NOW()::date - INTERVAL '1698 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('1187d7c0-210f-46ec-99ba-94eac9875a07','I10','Essential (primary) hypertension',NOW()::date - INTERVAL '743 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('1187d7c0-210f-46ec-99ba-94eac9875a07','E78.5','Hyperlipidemia, unspecified',NOW()::date - INTERVAL '681 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('5d408330-ede0-4c0a-8637-7decf7a4f292','J44.9','Chronic obstructive pulmonary disease, unspecified',NOW()::date - INTERVAL '637 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('5d408330-ede0-4c0a-8637-7decf7a4f292','F17.210','Nicotine dependence, cigarettes, uncomplicated',NOW()::date - INTERVAL '465 days','2a03f6df-6023-4250-92ad-bd8770196f08','uncontrolled','moderate'),
('f5b01768-84f2-4bae-a8ae-906ec7ad1eaf','F33.1','Major depressive disorder, recurrent, moderate',NOW()::date - INTERVAL '1688 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('f5b01768-84f2-4bae-a8ae-906ec7ad1eaf','F41.1','Generalized anxiety disorder',NOW()::date - INTERVAL '389 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('540f734b-0cda-4ab5-8b80-49fbf6ac7dfb','I10','Essential (primary) hypertension',NOW()::date - INTERVAL '1565 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('540f734b-0cda-4ab5-8b80-49fbf6ac7dfb','E78.5','Hyperlipidemia, unspecified',NOW()::date - INTERVAL '1696 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('c43f8f6d-2ed1-46f2-a753-2843b35954fd','G43.909','Migraine, unspecified, not intractable, without status migrainosus',NOW()::date - INTERVAL '2007 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('c43f8f6d-2ed1-46f2-a753-2843b35954fd','K21.9','Gastro-esophageal reflux disease without esophagitis',NOW()::date - INTERVAL '1296 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('f24bc475-7729-4d54-887d-186d2cfcb5b8','I25.10','Atherosclerotic heart disease of native coronary artery',NOW()::date - INTERVAL '358 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('f24bc475-7729-4d54-887d-186d2cfcb5b8','Z95.5','Presence of coronary angioplasty implant and graft',NOW()::date - INTERVAL '1389 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('f24bc475-7729-4d54-887d-186d2cfcb5b8','I10','Essential hypertension',NOW()::date - INTERVAL '1044 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('f24bc475-7729-4d54-887d-186d2cfcb5b8','E78.5','Hyperlipidemia, unspecified',NOW()::date - INTERVAL '245 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('2e556486-3115-43fc-bae1-d2a7dbf1e305','G43.909','Migraine, unspecified, not intractable, without status migrainosus',NOW()::date - INTERVAL '241 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('2e556486-3115-43fc-bae1-d2a7dbf1e305','K21.9','Gastro-esophageal reflux disease without esophagitis',NOW()::date - INTERVAL '371 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('10d3a712-9612-4fac-954d-e53404c25017','E11.22','Type 2 diabetes with diabetic chronic kidney disease',NOW()::date - INTERVAL '627 days','2a03f6df-6023-4250-92ad-bd8770196f08','uncontrolled','moderate'),
('10d3a712-9612-4fac-954d-e53404c25017','I12.9','Hypertensive chronic kidney disease without HF',NOW()::date - INTERVAL '656 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('10d3a712-9612-4fac-954d-e53404c25017','N18.3','Chronic kidney disease, stage 3',NOW()::date - INTERVAL '1214 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('10d3a712-9612-4fac-954d-e53404c25017','E78.5','Hyperlipidemia, unspecified',NOW()::date - INTERVAL '1412 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('c13925d8-d5f9-47a8-b736-074396616912','I10','Essential (primary) hypertension',NOW()::date - INTERVAL '234 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('c13925d8-d5f9-47a8-b736-074396616912','E78.5','Hyperlipidemia, unspecified',NOW()::date - INTERVAL '1329 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('778255f4-b6f1-41d6-9193-01ac0410b7df','G43.909','Migraine, unspecified, not intractable, without status migrainosus',NOW()::date - INTERVAL '587 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('778255f4-b6f1-41d6-9193-01ac0410b7df','K21.9','Gastro-esophageal reflux disease without esophagitis',NOW()::date - INTERVAL '1646 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('58179a29-4d1b-4499-a21f-0bb4e6eae494','I25.10','Atherosclerotic heart disease of native coronary artery',NOW()::date - INTERVAL '1510 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('58179a29-4d1b-4499-a21f-0bb4e6eae494','Z95.5','Presence of coronary angioplasty implant and graft',NOW()::date - INTERVAL '1616 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('58179a29-4d1b-4499-a21f-0bb4e6eae494','I10','Essential hypertension',NOW()::date - INTERVAL '1296 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('58179a29-4d1b-4499-a21f-0bb4e6eae494','E78.5','Hyperlipidemia, unspecified',NOW()::date - INTERVAL '1039 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('64abb0f6-8253-4996-80ec-a2fdcfb046ff','E03.9','Hypothyroidism, unspecified',NOW()::date - INTERVAL '631 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('d7ec66c5-a9e5-43e6-beba-fb425a8f749a','I10','Essential (primary) hypertension',NOW()::date - INTERVAL '1099 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('d7ec66c5-a9e5-43e6-beba-fb425a8f749a','E78.5','Hyperlipidemia, unspecified',NOW()::date - INTERVAL '1386 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('0cdc89ca-56e0-4db6-a4b5-aca5ede8b5b7','G43.909','Migraine, unspecified, not intractable, without status migrainosus',NOW()::date - INTERVAL '749 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('0cdc89ca-56e0-4db6-a4b5-aca5ede8b5b7','K21.9','Gastro-esophageal reflux disease without esophagitis',NOW()::date - INTERVAL '1837 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('a311202d-a824-4c77-8893-2dd56cbee544','J44.9','Chronic obstructive pulmonary disease, unspecified',NOW()::date - INTERVAL '1960 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('a311202d-a824-4c77-8893-2dd56cbee544','F17.210','Nicotine dependence, cigarettes, uncomplicated',NOW()::date - INTERVAL '193 days','2a03f6df-6023-4250-92ad-bd8770196f08','uncontrolled','moderate'),
('f4dbecd5-d59b-4701-93e9-9c1bfee55e8c','I10','Essential (primary) hypertension',NOW()::date - INTERVAL '1734 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('f4dbecd5-d59b-4701-93e9-9c1bfee55e8c','E78.5','Hyperlipidemia, unspecified',NOW()::date - INTERVAL '1830 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('13f7876c-3e58-44d2-83c3-5356da027252','G43.909','Migraine, unspecified, not intractable, without status migrainosus',NOW()::date - INTERVAL '506 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('13f7876c-3e58-44d2-83c3-5356da027252','K21.9','Gastro-esophageal reflux disease without esophagitis',NOW()::date - INTERVAL '1609 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('683ee795-07ca-49b0-9d79-a6ba0e7b073f','M05.79','Rheumatoid arthritis with rheumatoid factor',NOW()::date - INTERVAL '1045 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('683ee795-07ca-49b0-9d79-a6ba0e7b073f','E03.9','Hypothyroidism, unspecified',NOW()::date - INTERVAL '876 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('fafed5b7-08d9-4a34-baf6-84892c7f15b8','E11.22','Type 2 diabetes with diabetic chronic kidney disease',NOW()::date - INTERVAL '749 days','2a03f6df-6023-4250-92ad-bd8770196f08','uncontrolled','moderate'),
('fafed5b7-08d9-4a34-baf6-84892c7f15b8','I12.9','Hypertensive chronic kidney disease without HF',NOW()::date - INTERVAL '498 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('fafed5b7-08d9-4a34-baf6-84892c7f15b8','N18.3','Chronic kidney disease, stage 3',NOW()::date - INTERVAL '620 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('fafed5b7-08d9-4a34-baf6-84892c7f15b8','E78.5','Hyperlipidemia, unspecified',NOW()::date - INTERVAL '2140 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('08f1b3fa-db87-4cb6-860e-97995127425d','I50.9','Heart failure, unspecified',NOW()::date - INTERVAL '1743 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('08f1b3fa-db87-4cb6-860e-97995127425d','I48.91','Atrial fibrillation, unspecified',NOW()::date - INTERVAL '869 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('08f1b3fa-db87-4cb6-860e-97995127425d','I10','Essential hypertension',NOW()::date - INTERVAL '389 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('2dc41024-0a5a-470b-b2f5-dc8871f911e7','G43.909','Migraine, unspecified, not intractable, without status migrainosus',NOW()::date - INTERVAL '369 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('2dc41024-0a5a-470b-b2f5-dc8871f911e7','K21.9','Gastro-esophageal reflux disease without esophagitis',NOW()::date - INTERVAL '958 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('26d4515d-69a9-4313-b55e-b90d7fa42475','J44.9','Chronic obstructive pulmonary disease, unspecified',NOW()::date - INTERVAL '378 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('26d4515d-69a9-4313-b55e-b90d7fa42475','F17.210','Nicotine dependence, cigarettes, uncomplicated',NOW()::date - INTERVAL '915 days','2a03f6df-6023-4250-92ad-bd8770196f08','uncontrolled','moderate'),
('04431960-9339-4a94-831f-ae4f8904a830','J45.909','Asthma, unspecified',NOW()::date - INTERVAL '1915 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('04431960-9339-4a94-831f-ae4f8904a830','J30.1','Allergic rhinitis due to pollen',NOW()::date - INTERVAL '884 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('f2be882b-efd5-4f41-bdf5-7c0c8f745f2e','I50.9','Heart failure, unspecified',NOW()::date - INTERVAL '1416 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('f2be882b-efd5-4f41-bdf5-7c0c8f745f2e','I48.91','Atrial fibrillation, unspecified',NOW()::date - INTERVAL '721 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('f2be882b-efd5-4f41-bdf5-7c0c8f745f2e','I10','Essential hypertension',NOW()::date - INTERVAL '1832 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('6f8fd758-56d1-4702-8534-272153850305','F33.1','Major depressive disorder, recurrent, moderate',NOW()::date - INTERVAL '268 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('6f8fd758-56d1-4702-8534-272153850305','F41.1','Generalized anxiety disorder',NOW()::date - INTERVAL '1674 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('7a15332d-78c6-4e6c-9ebc-a244ff6abc9d','F33.1','Major depressive disorder, recurrent, moderate',NOW()::date - INTERVAL '1120 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('7a15332d-78c6-4e6c-9ebc-a244ff6abc9d','F41.1','Generalized anxiety disorder',NOW()::date - INTERVAL '1278 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('21106ebe-d01a-4533-b402-860d85119fd5','F33.1','Major depressive disorder, recurrent, moderate',NOW()::date - INTERVAL '435 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('21106ebe-d01a-4533-b402-860d85119fd5','F41.1','Generalized anxiety disorder',NOW()::date - INTERVAL '2172 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('951f3b25-c328-4bf6-8b8a-9f805cfde08b','I10','Essential (primary) hypertension',NOW()::date - INTERVAL '2068 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('951f3b25-c328-4bf6-8b8a-9f805cfde08b','E78.5','Hyperlipidemia, unspecified',NOW()::date - INTERVAL '955 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('51554cff-b3a8-477f-a9d6-2a282f9a1a83','F33.1','Major depressive disorder, recurrent, moderate',NOW()::date - INTERVAL '341 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('51554cff-b3a8-477f-a9d6-2a282f9a1a83','F41.1','Generalized anxiety disorder',NOW()::date - INTERVAL '1310 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('91ecfa82-7747-488f-8842-2457bec59814','M05.79','Rheumatoid arthritis with rheumatoid factor',NOW()::date - INTERVAL '780 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('91ecfa82-7747-488f-8842-2457bec59814','E03.9','Hypothyroidism, unspecified',NOW()::date - INTERVAL '1878 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('39203b5e-18ac-4d1c-9673-e41ae5f1808b','I25.10','Atherosclerotic heart disease of native coronary artery',NOW()::date - INTERVAL '1467 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('39203b5e-18ac-4d1c-9673-e41ae5f1808b','Z95.5','Presence of coronary angioplasty implant and graft',NOW()::date - INTERVAL '1446 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('39203b5e-18ac-4d1c-9673-e41ae5f1808b','I10','Essential hypertension',NOW()::date - INTERVAL '1993 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('39203b5e-18ac-4d1c-9673-e41ae5f1808b','E78.5','Hyperlipidemia, unspecified',NOW()::date - INTERVAL '1944 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('000026d0-dcff-4ea2-9c4c-86c8f93062d6','E11.22','Type 2 diabetes with diabetic chronic kidney disease',NOW()::date - INTERVAL '920 days','2a03f6df-6023-4250-92ad-bd8770196f08','uncontrolled','moderate'),
('000026d0-dcff-4ea2-9c4c-86c8f93062d6','I12.9','Hypertensive chronic kidney disease without HF',NOW()::date - INTERVAL '1362 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('000026d0-dcff-4ea2-9c4c-86c8f93062d6','N18.3','Chronic kidney disease, stage 3',NOW()::date - INTERVAL '573 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('000026d0-dcff-4ea2-9c4c-86c8f93062d6','E78.5','Hyperlipidemia, unspecified',NOW()::date - INTERVAL '1622 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('511e045c-458c-41a2-a092-a95a0599ca3c','F33.1','Major depressive disorder, recurrent, moderate',NOW()::date - INTERVAL '322 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('511e045c-458c-41a2-a092-a95a0599ca3c','F41.1','Generalized anxiety disorder',NOW()::date - INTERVAL '273 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('74e977e2-a467-4bd2-b968-ba08be8d15fe','I10','Essential (primary) hypertension',NOW()::date - INTERVAL '1534 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('74e977e2-a467-4bd2-b968-ba08be8d15fe','E78.5','Hyperlipidemia, unspecified',NOW()::date - INTERVAL '646 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('d0f5a84e-61da-4873-a151-0d2bb92961dd','F33.1','Major depressive disorder, recurrent, moderate',NOW()::date - INTERVAL '1763 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('d0f5a84e-61da-4873-a151-0d2bb92961dd','F41.1','Generalized anxiety disorder',NOW()::date - INTERVAL '772 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('b00ad264-a147-4658-826e-c24f4236b643','E11.22','Type 2 diabetes with diabetic chronic kidney disease',NOW()::date - INTERVAL '2197 days','2a03f6df-6023-4250-92ad-bd8770196f08','uncontrolled','moderate'),
('b00ad264-a147-4658-826e-c24f4236b643','I12.9','Hypertensive chronic kidney disease without HF',NOW()::date - INTERVAL '343 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('b00ad264-a147-4658-826e-c24f4236b643','N18.3','Chronic kidney disease, stage 3',NOW()::date - INTERVAL '1931 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('b00ad264-a147-4658-826e-c24f4236b643','E78.5','Hyperlipidemia, unspecified',NOW()::date - INTERVAL '656 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('c977fbe4-875b-47e5-94b2-361541dd7a8c','I25.10','Atherosclerotic heart disease of native coronary artery',NOW()::date - INTERVAL '1954 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('c977fbe4-875b-47e5-94b2-361541dd7a8c','Z95.5','Presence of coronary angioplasty implant and graft',NOW()::date - INTERVAL '386 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('c977fbe4-875b-47e5-94b2-361541dd7a8c','I10','Essential hypertension',NOW()::date - INTERVAL '958 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('c977fbe4-875b-47e5-94b2-361541dd7a8c','E78.5','Hyperlipidemia, unspecified',NOW()::date - INTERVAL '749 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('551f4945-ed81-41ef-8ef3-4cb0bdcb7100','F33.1','Major depressive disorder, recurrent, moderate',NOW()::date - INTERVAL '1108 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('551f4945-ed81-41ef-8ef3-4cb0bdcb7100','F41.1','Generalized anxiety disorder',NOW()::date - INTERVAL '1481 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('b1bc5599-17e9-4058-8391-b732455d6fd3','G43.909','Migraine, unspecified, not intractable, without status migrainosus',NOW()::date - INTERVAL '1888 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('b1bc5599-17e9-4058-8391-b732455d6fd3','K21.9','Gastro-esophageal reflux disease without esophagitis',NOW()::date - INTERVAL '927 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('a2665c8e-293e-45ab-9bfd-e27773853066','E03.9','Hypothyroidism, unspecified',NOW()::date - INTERVAL '513 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('101385f1-dee4-42e1-a842-b22e9d41fc18','J44.9','Chronic obstructive pulmonary disease, unspecified',NOW()::date - INTERVAL '938 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('101385f1-dee4-42e1-a842-b22e9d41fc18','F17.210','Nicotine dependence, cigarettes, uncomplicated',NOW()::date - INTERVAL '907 days','2a03f6df-6023-4250-92ad-bd8770196f08','uncontrolled','moderate'),
('0d2ef565-7acf-41df-84d5-3db69bf7781d','G43.909','Migraine, unspecified, not intractable, without status migrainosus',NOW()::date - INTERVAL '609 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('0d2ef565-7acf-41df-84d5-3db69bf7781d','K21.9','Gastro-esophageal reflux disease without esophagitis',NOW()::date - INTERVAL '1552 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('60a0d2dc-d814-49d3-8d6f-6b1b4a6310fe','G43.909','Migraine, unspecified, not intractable, without status migrainosus',NOW()::date - INTERVAL '726 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('60a0d2dc-d814-49d3-8d6f-6b1b4a6310fe','K21.9','Gastro-esophageal reflux disease without esophagitis',NOW()::date - INTERVAL '1617 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('cd2967dc-52db-4b5e-bf2a-5680788af6cd','I10','Essential (primary) hypertension',NOW()::date - INTERVAL '2098 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('cd2967dc-52db-4b5e-bf2a-5680788af6cd','E78.5','Hyperlipidemia, unspecified',NOW()::date - INTERVAL '1579 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('9fdaa41b-a0f5-4bf8-9ac2-5f86f9f83509','G43.909','Migraine, unspecified, not intractable, without status migrainosus',NOW()::date - INTERVAL '1507 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('9fdaa41b-a0f5-4bf8-9ac2-5f86f9f83509','K21.9','Gastro-esophageal reflux disease without esophagitis',NOW()::date - INTERVAL '326 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('7e4685d8-23ed-4821-b532-9d08a930354e','F33.1','Major depressive disorder, recurrent, moderate',NOW()::date - INTERVAL '1427 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('7e4685d8-23ed-4821-b532-9d08a930354e','F41.1','Generalized anxiety disorder',NOW()::date - INTERVAL '1480 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('aa4943d1-1a1d-4609-bef8-b90246e3b7a0','F33.1','Major depressive disorder, recurrent, moderate',NOW()::date - INTERVAL '530 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('aa4943d1-1a1d-4609-bef8-b90246e3b7a0','F41.1','Generalized anxiety disorder',NOW()::date - INTERVAL '1273 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('a428ad0b-4e1b-43a7-aaad-fb055249efc5','I25.10','Atherosclerotic heart disease of native coronary artery',NOW()::date - INTERVAL '1673 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('a428ad0b-4e1b-43a7-aaad-fb055249efc5','Z95.5','Presence of coronary angioplasty implant and graft',NOW()::date - INTERVAL '681 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('a428ad0b-4e1b-43a7-aaad-fb055249efc5','I10','Essential hypertension',NOW()::date - INTERVAL '514 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('a428ad0b-4e1b-43a7-aaad-fb055249efc5','E78.5','Hyperlipidemia, unspecified',NOW()::date - INTERVAL '1126 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('3529a07b-7e84-44c0-a4c1-2ff00ccad15a','F33.1','Major depressive disorder, recurrent, moderate',NOW()::date - INTERVAL '957 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('3529a07b-7e84-44c0-a4c1-2ff00ccad15a','F41.1','Generalized anxiety disorder',NOW()::date - INTERVAL '732 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('0c8f4ab0-7d23-4b9c-8806-3df3eab26dc1','M05.79','Rheumatoid arthritis with rheumatoid factor',NOW()::date - INTERVAL '2075 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('0c8f4ab0-7d23-4b9c-8806-3df3eab26dc1','E03.9','Hypothyroidism, unspecified',NOW()::date - INTERVAL '1490 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('d13568cc-9f0e-4969-96af-3cfd19fec059','G43.909','Migraine, unspecified, not intractable, without status migrainosus',NOW()::date - INTERVAL '1589 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('d13568cc-9f0e-4969-96af-3cfd19fec059','K21.9','Gastro-esophageal reflux disease without esophagitis',NOW()::date - INTERVAL '1320 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('a61cec1f-cb0e-4b5c-93e3-d2914891dc1a','F33.1','Major depressive disorder, recurrent, moderate',NOW()::date - INTERVAL '629 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('a61cec1f-cb0e-4b5c-93e3-d2914891dc1a','F41.1','Generalized anxiety disorder',NOW()::date - INTERVAL '1582 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('8b7d7f54-ae0e-4bab-993f-66fc1bbf7aa4','F33.1','Major depressive disorder, recurrent, moderate',NOW()::date - INTERVAL '844 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('8b7d7f54-ae0e-4bab-993f-66fc1bbf7aa4','F41.1','Generalized anxiety disorder',NOW()::date - INTERVAL '1906 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('e7b71c51-0c8f-4249-9e18-1b930c77e52f','I10','Essential (primary) hypertension',NOW()::date - INTERVAL '1753 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('e7b71c51-0c8f-4249-9e18-1b930c77e52f','E78.5','Hyperlipidemia, unspecified',NOW()::date - INTERVAL '1769 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild'),
('c34d135a-6e41-4d90-ada2-818a1f53b499','G43.909','Migraine, unspecified, not intractable, without status migrainosus',NOW()::date - INTERVAL '294 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('c34d135a-6e41-4d90-ada2-818a1f53b499','K21.9','Gastro-esophageal reflux disease without esophagitis',NOW()::date - INTERVAL '649 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('dba3d86b-ad36-490e-ad61-9278b165dbb9','G43.909','Migraine, unspecified, not intractable, without status migrainosus',NOW()::date - INTERVAL '1863 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('dba3d86b-ad36-490e-ad61-9278b165dbb9','K21.9','Gastro-esophageal reflux disease without esophagitis',NOW()::date - INTERVAL '245 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','mild'),
('070d7e08-bb1a-4a3f-a4d1-0ed147cfe92e','I10','Essential (primary) hypertension',NOW()::date - INTERVAL '1828 days','2a03f6df-6023-4250-92ad-bd8770196f08','partial','moderate'),
('070d7e08-bb1a-4a3f-a4d1-0ed147cfe92e','E78.5','Hyperlipidemia, unspecified',NOW()::date - INTERVAL '826 days','2a03f6df-6023-4250-92ad-bd8770196f08','well','mild')
ON CONFLICT (patient_id,code) DO UPDATE SET control_state=EXCLUDED.control_state, severity_state=EXCLUDED.severity_state;

-- 2. Allergies fill-in
UPDATE patients SET known_allergies='NSAIDs (gastric upset)' WHERE id='778255f4-b6f1-41d6-9193-01ac0410b7df' AND (known_allergies IS NULL OR known_allergies='');
UPDATE patients SET known_allergies='Shellfish' WHERE id='f4dbecd5-d59b-4701-93e9-9c1bfee55e8c' AND (known_allergies IS NULL OR known_allergies='');
UPDATE patients SET known_allergies='Penicillin (rash, 2019)' WHERE id='dba3d86b-ad36-490e-ad61-9278b165dbb9' AND (known_allergies IS NULL OR known_allergies='');
UPDATE patients SET known_allergies='Eggs (urticaria as child)' WHERE id='cd2967dc-52db-4b5e-bf2a-5680788af6cd' AND (known_allergies IS NULL OR known_allergies='');
UPDATE patients SET known_allergies='Trimethoprim (rash)' WHERE id='30d9e7fe-5f08-496e-a7be-86d0eff9fe39' AND (known_allergies IS NULL OR known_allergies='');
UPDATE patients SET known_allergies='Pollen, dust mites' WHERE id='7e4685d8-23ed-4821-b532-9d08a930354e' AND (known_allergies IS NULL OR known_allergies='');
UPDATE patients SET known_allergies='Lactose intolerance' WHERE id='afce6eb6-96b3-431a-ae6c-2cc8f6327a6d' AND (known_allergies IS NULL OR known_allergies='');
UPDATE patients SET known_allergies='Peanuts' WHERE id='bd92918f-47c0-4f61-aeb4-bf37b29cd32d' AND (known_allergies IS NULL OR known_allergies='');
UPDATE patients SET known_allergies='Latex gloves' WHERE id='b00ad264-a147-4658-826e-c24f4236b643' AND (known_allergies IS NULL OR known_allergies='');
UPDATE patients SET known_allergies='Aspirin (urticaria)' WHERE id='1187d7c0-210f-46ec-99ba-94eac9875a07' AND (known_allergies IS NULL OR known_allergies='');
UPDATE patients SET known_allergies='Sulfa drugs' WHERE id='f2be882b-efd5-4f41-bdf5-7c0c8f745f2e' AND (known_allergies IS NULL OR known_allergies='');
UPDATE patients SET known_allergies='Iodine contrast (mild reaction 2022)' WHERE id='c34d135a-6e41-4d90-ada2-818a1f53b499' AND (known_allergies IS NULL OR known_allergies='');
UPDATE patients SET known_allergies='Codeine (nausea)' WHERE id='951f3b25-c328-4bf6-8b8a-9f805cfde08b' AND (known_allergies IS NULL OR known_allergies='');
UPDATE patients SET known_allergies='NSAIDs (gastric upset)' WHERE id='c13925d8-d5f9-47a8-b736-074396616912' AND (known_allergies IS NULL OR known_allergies='');
UPDATE patients SET known_allergies='Shellfish' WHERE id='39203b5e-18ac-4d1c-9673-e41ae5f1808b' AND (known_allergies IS NULL OR known_allergies='');
UPDATE patients SET known_allergies='Penicillin (rash, 2019)' WHERE id='eb78bda3-9f5f-4dec-b175-0c62447574cc' AND (known_allergies IS NULL OR known_allergies='');
UPDATE patients SET known_allergies='Eggs (urticaria as child)' WHERE id='2b15666d-8958-4c28-b48c-b3dea67b95fe' AND (known_allergies IS NULL OR known_allergies='');
UPDATE patients SET known_allergies='Trimethoprim (rash)' WHERE id='58179a29-4d1b-4499-a21f-0bb4e6eae494' AND (known_allergies IS NULL OR known_allergies='');
UPDATE patients SET known_allergies='Pollen, dust mites' WHERE id='60a0d2dc-d814-49d3-8d6f-6b1b4a6310fe' AND (known_allergies IS NULL OR known_allergies='');
UPDATE patients SET known_allergies='Lactose intolerance' WHERE id='c9a6eec5-4154-42e4-ab94-337ecd6df19e' AND (known_allergies IS NULL OR known_allergies='');
UPDATE patients SET known_allergies='Peanuts' WHERE id='d13568cc-9f0e-4969-96af-3cfd19fec059' AND (known_allergies IS NULL OR known_allergies='');
UPDATE patients SET known_allergies='Latex gloves' WHERE id='13f7876c-3e58-44d2-83c3-5356da027252' AND (known_allergies IS NULL OR known_allergies='');
COMMIT;
