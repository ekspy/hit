# Convergence (property-based)

Seed 1701; 500 generated cases per replica count; 10 to 40 steps per case (local operations on random replicas interleaved with random pairwise syncs);
3 random final synchronisation orders per case (two rounds, each a random permutation of all replica pairs with random direction), each applied to an independent copy of the diverged replicas.

State level: equal Automerge heads and equal state when materialised from scratch (save/load). View level: equal in-memory view after incremental merges (what the runtime reads).

| Replicas |Cases |State-level pass/fail |View-level pass/fail |First view failure (case index) |Steps/case (min/med/max) |Applied ops/case (min/med/max) |Applied ops total |Intermediate syncs |Final orders tested |Distinct final orders (possible) |
| --- |--- |--- |--- |--- |--- |--- |--- |--- |--- |--- |
| 2 |500 |500/0 |500/0 |- |10/24/40 |3/13.5/28 |7012 |1600 |1500 |4 (4) |
| 3 |500 |500/0 |498/2 |235 |10/24/40 |2/14/30 |7106 |1616 |1500 |1103 (2304) |

| Replicas |Cases w/ concurrent same-file edits |Concurrent same-region edit pairs |Cases w/ same-region edits |Concurrent same-path creates |Cases w/ same-path creates |Cases w/ concurrent claims (same task) |Cases w/ edit/delete race |
| --- |--- |--- |--- |--- |--- |--- |--- |
| 2 |374 |363 |215 |56 |53 |164 |135 |
| 3 |440 |805 |339 |120 |94 |242 |178 |

Operations by kind: 2 replicas: {"edit":3774,"claim":1583,"rename":214,"delete":389,"create":823,"release":229}; 3 replicas: {"edit":3960,"claim":1604,"delete":329,"create":851,"rename":187,"release":175}

Minimal view-level counterexample (3 replicas, 38 shrinks): steps [{"kind":"delete","replica":0,"file":1},{"kind":"delete","replica":1,"file":1},{"kind":"create","replica":0,"file":1,"content":""},{"kind":"create","replica":1,"file":1,"content":""},{"kind":"release","replica":0,"task":0},{"kind":"rename","replica":0,"file":0,"to":0},{"kind":"sync","left":0,"right":2},{"kind":"release","replica":0,"task":0},{"kind":"release","replica":0,"task":0},{"kind":"rename","replica":0,"file":1,"to":2},{"kind":"edit","replica":0,"file":0,"region":0,"offset":0,"deleteCount":0,"insert":""},{"kind":"release","replica":0,"task":0},{"kind":"create","replica":0,"file":1,"content":"a"},{"kind":"edit","replica":0,"file":0,"region":0,"offset":0,"deleteCount":0,"insert":""}]; orders [[[0,1],[1,2],[0,2],[0,1],[1,2],[0,2]],[[0,1],[0,2],[1,2],[1,2],[0,2],[0,1]],[[1,2],[0,1],[0,2],[0,1],[0,2],[1,2]]]
