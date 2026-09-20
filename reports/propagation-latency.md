# Propagation Latency

| Mode |Files |Symbols |p50 ms |p95 ms |min ms |max ms |
| --- |--- |--- |--- |--- |--- |--- |
| fullRebuild |6 |9 |331.98 |389.28 |308.92 |396.35 |
| incremental |6 |9 |230.08 |249.18 |212.40 |262.76 |

Incremental indexing is faster on this fixture by p50 (230.08 ms vs 331.98 ms).

This measures Repo.editFile through rebuild, diff, and event-level impact analysis. It does not include LLM inference latency.
