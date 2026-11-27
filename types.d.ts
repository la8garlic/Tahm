type ReviewLevel = "rebuild" | "manual";
interface Advice {
  label: string;
  reason: string;
  review: ReviewLevel | null;
}
interface ScanItem {
  disk: { bytes: number; charged: number; unknown: number };
  bytes: number;
  path: string;
  directory: boolean;
  files: number;
  modified: number | null;
  kind: string;
  advice: Advice;
}
type SpaceMetric = "logical" | "allocated";
interface ReclaimEstimate {
  blocked: RecycleResult[];
  reclaimable: number;
  retained: number;
  retained_files: number;
  unknown: number;
}
type ReviewFilter = { level: ReviewLevel; query: string; category: string | null; labels: string[] };
type SelectionOrder =
  | { kind: "reviews"; filter: ReviewFilter }
  | { kind: "directory"; path: string; query: string; metric: SpaceMetric }
  | { kind: "files"; query: string; extension: string | null; minimum: number };
interface Totals {
  bytes: number;
  files: number;
  folders: number;
  errors: number;
  skipped: number;
}
interface ProgressUpdate {
  bytes: number;
  files: number;
  folders: number;
  path: string;
}
interface ScanReport {
  generation: number;
  extensions: { name: string; bytes: number; files: number }[];
  direct_file_bytes: number;
  root: string;
  root_info: ScanItem;
  elapsed_ms: number;
  totals: Totals;
  types: [string, number][];
  children: ScanItem[];
  files: ScanItem[];
  folders: ScanItem[];
  reviews: Record<ReviewLevel, { items: ScanItem[]; count: number; categories: Record<string, number> }>;
  issues: string[];
}
interface FolderPage {
  folder: ScanItem;
  rows: ScanItem[];
  dirs: ScanItem[];
  offset: number;
  matches: number;
}
interface MapPage {
  previews: Record<string, ScanItem[]>;
  folder: ScanItem;
  tiles: ScanItem[];
  map_offset: number;
  rest_bytes: number;
  rest_count: number;
}
interface RecycleResult {
  path: string;
  error: string | null;
}
interface RecycleProgress {
  phase: "verify" | "shell";
  index: number;
  total: number;
  checked: number;
  files: number;
  path: string;
}
interface CopyReport {
  checked: number;
  matches: number;
  skipped: number;
  items: ScanItem[];
  issues: string[];
  cancelled: boolean;
}
interface CopyProgress {
  checked: number;
  compared_bytes: number;
}
type Provider = "deepseek" | "openai" | "anthropic" | "local";
interface ModelSettings {
  provider: Provider;
  model: string;
  key: string;
  port: number;
}
interface Assessment {
  purpose: string;
  verdict: "keep" | "conditional" | "unknown";
  condition: string;
  evidence: number[];
}
interface Window {
  __TAURI__: {
    window: {
      getCurrentWindow(): {
        setTitle(title: string): Promise<void>;
        minimize(): Promise<void>;
        isMaximized(): Promise<boolean>;
        toggleMaximize(): Promise<void>;
        close(): Promise<void>;
      };
    };
    core: {
      invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
      Channel: new <T>(onmessage: (message: T) => void) => { onmessage: (message: T) => void };
    };
  };
}
