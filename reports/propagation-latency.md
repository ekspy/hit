# Propagation Latency

| Mode |Files |Symbols |p50 ms |p95 ms |min ms |max ms |
| --- |--- |--- |--- |--- |--- |--- |
| fullRebuild |6 |9 |357.66 |389.83 |326.92 |435.99 |
| incremental |6 |9 |243.05 |249.24 |221.64 |302.58 |

Incremental indexing is faster on this fixture by p50 (243.05 ms vs 357.66 ms).

This measures Repo.editFile through rebuild, diff, and event-level impact analysis. It does not include LLM inference latency.
