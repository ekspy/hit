# Detector Quality (test set)

Conflict-level precision: 1.00
Conflict-level recall: 1.00
Conflict-level F1: 1.00
Rule-attribution accuracy (strict, label rule only): 0.17 (1/6)
Rule-attribution accuracy (accepting acceptableRules): 0.67 (4/6)

| Scenario |Precision |Recall |F1 |TP |FP |FN |Rule (strict) |Rule (acceptable) |
| --- |--- |--- |--- |--- |--- |--- |--- |--- |
| t01-readonly-field-written |1.00 |1.00 |1.00 |1 |0 |0 |0/1 |0/1 |
| t02-two-hop-nullable-return |1.00 |1.00 |1.00 |1 |0 |0 |0/1 |1/1 |
| t03-reordered-positional-params |1.00 |1.00 |1.00 |1 |0 |0 |0/1 |1/1 |
| t04-callback-shape-change |1.00 |1.00 |1.00 |1 |0 |0 |0/1 |1/1 |
| t05-method-made-private |1.00 |1.00 |1.00 |1 |0 |0 |0/1 |0/1 |
| t06-barrel-reexport-removed |1.00 |1.00 |1.00 |1 |0 |0 |1/1 |1/1 |
| t07-optional-trailing-param-control |1.00 |1.00 |1.00 |0 |0 |0 |0/0 |0/0 |
| t08-widened-input-union-control |1.00 |1.00 |1.00 |0 |0 |0 |0/0 |0/0 |

## Raw Rule-Firing Table

| Rule |Expected |Actual |Matched |
| --- |--- |--- |--- |
| R9 |0 |4 |0 |
| R4 |2 |2 |0 |
| R1 |2 |3 |2 |
| R5 |1 |1 |0 |
| R3 |1 |1 |1 |
