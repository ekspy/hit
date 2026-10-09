# Detector Quality (heldout set)

Conflict-level precision: 0.24
Conflict-level recall: 0.57
Conflict-level F1: 0.33
Rule-attribution accuracy: 0.75

| Scenario |Precision |Recall |F1 |TP |FP |FN |
| --- |--- |--- |--- |--- |--- |--- |
| h01-nested-optional-to-required |0.50 |1.00 |0.67 |1 |1 |0 |
| h02-generic-constraint-added |1.00 |1.00 |1.00 |1 |0 |0 |
| h03-overload-removed |0.00 |0.00 |0.00 |0 |2 |1 |
| h04-default-to-named-export |0.00 |0.00 |0.00 |0 |2 |1 |
| h05-two-hop-destructured-type-change |0.00 |0.00 |0.00 |0 |3 |1 |
| h06-two-conflicts-same-pair-no-symbol |0.50 |1.00 |0.67 |2 |2 |0 |
| h07-overload-added-control |0.00 |1.00 |0.00 |0 |1 |0 |
| h08-required-to-optional-input-control |0.00 |1.00 |0.00 |0 |2 |0 |

## Raw Rule-Firing Table

| Rule |Expected |Actual |Matched |
| --- |--- |--- |--- |
| R1 |1 |12 |0 |
| R4 |4 |6 |0 |
| R5 |0 |8 |0 |
| R6 |1 |0 |0 |
| R9 |0 |3 |0 |
| R3 |1 |0 |0 |
