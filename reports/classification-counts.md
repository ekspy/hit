# Compatibility classification counts (C31)

| Set |Changed symbols |Compatible |Incompatible |Unknown |Raw conflicts |Raw unknown |Logical |Logical w/ unknown |Logical only-unknown |FP |FP w/ unknown |FP only-unknown |
| --- |--- |--- |--- |--- |--- |--- |--- |--- |--- |--- |--- |--- |
| dev |18 |5 |11 |2 |26 |2 |13 |2 |0 |0 |0 |0 |
| heldout |6 |1 |2 |3 |13 |1 |7 |1 |0 |0 |0 |0 |

## dev

| Scenario |Changed symbols (classification) |Raw unknown |FP |FP w/ unknown |
| --- |--- |--- |--- |--- |
| 01-return-type-change |createPayment:breaking, PaymentResult:breaking |0 |0 |0 |
| 02-symbol-rename |- |0 |0 |0 |
| 03-removed-field |OrderRecord:breaking |0 |0 |0 |
| 04-symbol-move |- |0 |0 |0 |
| 05-optional-to-required |createPayment:breaking |0 |0 |0 |
| 06-widen-to-narrow-type |createPayment:unknown |1 |0 |0 |
| 07-async-contract-change |createPayment:breaking |0 |0 |0 |
| 08-import-path-change |- |0 |0 |0 |
| 09-union-value-removed |createPayment:breaking, PaymentResult:breaking |0 |0 |0 |
| 10-compatible-change-control |createPayment:compatible |0 |0 |0 |
| 11-added-optional-param-control |createPayment:compatible |0 |0 |0 |
| 12-added-optional-return-field-control |createPayment:compatible, PaymentResult:compatible |0 |0 |0 |
| 13-widened-param-type-control |createPayment:compatible |0 |0 |0 |
| 14-interface-field-rename |OrderRecord:breaking |0 |0 |0 |
| 15-enum-like-union-added-and-consumer-exhaustive |OrderRecord:unknown |1 |0 |0 |
| 16-two-producers-one-consumer |OrderRecord:breaking, createPayment:breaking, PaymentResult:breaking |0 |0 |0 |

## heldout

| Scenario |Changed symbols (classification) |Raw unknown |FP |FP w/ unknown |
| --- |--- |--- |--- |--- |
| h01-nested-optional-to-required |ShipmentOptions:unknown |1 |0 |0 |
| h02-generic-constraint-added |paginate:breaking |0 |0 |0 |
| h03-overload-removed |formatQuantity:breaking |0 |0 |0 |
| h04-default-to-named-export |- |0 |0 |0 |
| h05-two-hop-destructured-type-change |Item:unknown |0 |0 |0 |
| h06-two-conflicts-same-pair-no-symbol |- |0 |0 |0 |
| h07-overload-added-control |formatQuantity:compatible |0 |0 |0 |
| h08-required-to-optional-input-control |ShipmentOptions:unknown |0 |0 |0 |
