# Detector Quality (heldout set)

Conflict-level precision: 1.00
Conflict-level recall: 1.00
Conflict-level F1: 1.00
Rule-attribution accuracy (strict, label rule only): 1.00 (7/7)
Rule-attribution accuracy (accepting acceptableRules): 1.00 (7/7)

| Scenario |Precision |Recall |F1 |TP |FP |FN |Rule (strict) |Rule (acceptable) |
| --- |--- |--- |--- |--- |--- |--- |--- |--- |
| h01-nested-optional-to-required |1.00 |1.00 |1.00 |1 |0 |0 |1/1 |1/1 |
| h02-generic-constraint-added |1.00 |1.00 |1.00 |1 |0 |0 |1/1 |1/1 |
| h03-overload-removed |1.00 |1.00 |1.00 |1 |0 |0 |1/1 |1/1 |
| h04-default-to-named-export |1.00 |1.00 |1.00 |1 |0 |0 |1/1 |1/1 |
| h05-two-hop-destructured-type-change |1.00 |1.00 |1.00 |1 |0 |0 |1/1 |1/1 |
| h06-two-conflicts-same-pair-no-symbol |1.00 |1.00 |1.00 |2 |0 |0 |2/2 |2/2 |
| h07-overload-added-control |1.00 |1.00 |1.00 |0 |0 |0 |0/0 |0/0 |
| h08-required-to-optional-input-control |1.00 |1.00 |1.00 |0 |0 |0 |0/0 |0/0 |

## Raw Rule-Firing Table

| Rule |Expected |Actual |Matched |
| --- |--- |--- |--- |
| R1 |1 |3 |1 |
| R4 |4 |7 |0 |
| R6 |1 |1 |1 |
| R3 |1 |1 |1 |
| R9 |0 |1 |0 |
