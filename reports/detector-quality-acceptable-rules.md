# Detector Quality (dev set)

Conflict-level precision: 1.00
Conflict-level recall: 1.00
Conflict-level F1: 1.00
Rule-attribution accuracy (strict, label rule only): 0.92 (12/13)
Rule-attribution accuracy (accepting acceptableRules): 1.00 (13/13)

| Scenario |Precision |Recall |F1 |TP |FP |FN |Rule (strict) |Rule (acceptable) |
| --- |--- |--- |--- |--- |--- |--- |--- |--- |
| 01-return-type-change |1.00 |1.00 |1.00 |1 |0 |0 |1/1 |1/1 |
| 02-symbol-rename |1.00 |1.00 |1.00 |1 |0 |0 |1/1 |1/1 |
| 03-removed-field |1.00 |1.00 |1.00 |1 |0 |0 |1/1 |1/1 |
| 04-symbol-move |1.00 |1.00 |1.00 |1 |0 |0 |1/1 |1/1 |
| 05-optional-to-required |1.00 |1.00 |1.00 |1 |0 |0 |1/1 |1/1 |
| 06-widen-to-narrow-type |1.00 |1.00 |1.00 |1 |0 |0 |1/1 |1/1 |
| 07-async-contract-change |1.00 |1.00 |1.00 |1 |0 |0 |1/1 |1/1 |
| 08-import-path-change |1.00 |1.00 |1.00 |1 |0 |0 |1/1 |1/1 |
| 09-union-value-removed |1.00 |1.00 |1.00 |1 |0 |0 |0/1 |1/1 |
| 10-compatible-change-control |1.00 |1.00 |1.00 |0 |0 |0 |0/0 |0/0 |
| 11-added-optional-param-control |1.00 |1.00 |1.00 |0 |0 |0 |0/0 |0/0 |
| 12-added-optional-return-field-control |1.00 |1.00 |1.00 |0 |0 |0 |0/0 |0/0 |
| 13-widened-param-type-control |1.00 |1.00 |1.00 |0 |0 |0 |0/0 |0/0 |
| 14-interface-field-rename |1.00 |1.00 |1.00 |1 |0 |0 |1/1 |1/1 |
| 15-enum-like-union-added-and-consumer-exhaustive |1.00 |1.00 |1.00 |1 |0 |0 |1/1 |1/1 |
| 16-two-producers-one-consumer |1.00 |1.00 |1.00 |2 |0 |0 |2/2 |2/2 |

## Raw Rule-Firing Table

| Rule |Expected |Actual |Matched |
| --- |--- |--- |--- |
| R1 |3 |7 |3 |
| R4 |6 |9 |1 |
| R5 |0 |3 |0 |
| R2 |2 |2 |2 |
| R3 |1 |3 |0 |
| R6 |1 |1 |1 |
| R9 |0 |1 |0 |
