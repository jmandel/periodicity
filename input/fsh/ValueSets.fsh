ValueSet: MenstrualFlowValueSet
Id: menstrual-flow
Title: "Menstrual Flow"
Description: "Uncalibrated, patient-reported ordinal flow categories used by period-tracking applications."
* ^experimental = true
* include $CycleCS#flow-none
* include $CycleCS#flow-spotting
* include $CycleCS#flow-light
* include $CycleCS#flow-moderate
* include $CycleCS#flow-heavy

ValueSet: CommonTrackerSymptomsVS
Id: common-tracker-symptoms
Title: "Common Period-Tracking Symptoms"
Description: "A small, non-normative starter set of period-tracking symptoms that applications commonly record, offered so implementers can bootstrap a consistent symptom vocabulary. It includes SNOMED CT concepts where the fit is exact enough. It is NOT a closed or required binding: a fact's symptom value MAY use another SNOMED CT concept when the meaning is exact."
* ^experimental = true
* $SCT#431416001 "Menstrual cramp"
* $SCT#161891005 "Backache"
* $SCT#25064002 "Headache"
* $SCT#37796009 "Migraine"
* $SCT#271681002 "Stomach ache"
* $SCT#422587007 "Nausea"
* $SCT#55222007 "Breast tenderness"
* $SCT#43548008 "Ovulation pain"
* $SCT#84229001 "Fatigue"
* $SCT#116289008 "Abdominal bloating"
* $SCT#366979004 "Depressed mood"
* $SCT#55929007 "Feeling irritable"
* $SCT#73595000 "Stress"
* $SCT#71315007 "Dyspareunia"
