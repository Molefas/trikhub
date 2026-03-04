export {
  TrikLinter,
  type LinterConfig,
  type LintResult,
  findManifestPath,
  type ManifestLocation,
  type PackageType,
} from './linter.js';
export {
  scanCapabilities,
  crossCheckManifest,
  formatScanResult,
  type ScanResult,
  type SecurityTier,
  type CapabilityCategory,
  type CapabilityMatch,
  type CrossCheckResult,
} from './scanner.js';
