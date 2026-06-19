export function runAnalyses(): void {
  console.log('eval scaffold')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAnalyses()
}
