import type { Fact, Mapping, Section } from '../domain/model';
export type FieldKind =
  | 'text'
  | 'textarea'
  | 'date'
  | 'month'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'combobox'
  | 'unsupported';
export interface Field {
  id: string;
  signature: string;
  label: string;
  /** Bounded static label candidates; excludes control values. */
  context?: string[];
  /** False when a remembered mapping would rely only on generic or generated labels. */
  bindingStable?: boolean;
  kind: FieldKind;
  value: string;
  options: { label: string; value: string }[];
  autocomplete: string;
  section?: Section;
  index: number;
  blocked: boolean;
  reviewReason?: string;
  supportReason?: string;
}
export interface Scan {
  token: string;
  url: string;
  origin: string;
  adapter: string;
  fields: Field[];
}
export type ResultStatus = 'filled' | 'failed' | 'skipped' | 'review';
export interface FillResult {
  id: string;
  status: ResultStatus;
  reason: string;
}
export interface PlanItem {
  id: string;
  path: string;
  value: string;
  source: string;
  confidence: number;
  selected: boolean;
  /** Original layout text IDs supporting the AI interpretation; local validation only. */
  evidence?: string[];
}
export interface MatchContext {
  facts: Fact[];
  mappings: Mapping[];
  origin: string;
}
export interface SiteAdapter {
  id: string;
  name: string;
  matches: (url: URL) => boolean;
  sectionSelectors: string[];
  identify: (field: Field) => string | undefined;
}

export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface LayoutContainer {
  id: string;
  parentId: string | null;
  order: number;
  rect: LayoutRect;
}
export interface LayoutText extends LayoutContainer {
  text: string;
}
export interface LayoutControl extends LayoutContainer {
  kind: FieldKind;
  writable: boolean;
  occupied: boolean;
  reason?: string;
}
export interface LayoutSnapshot {
  containers: LayoutContainer[];
  texts: LayoutText[];
  controls: LayoutControl[];
  limitations: string[];
}
export interface LayoutScan extends Scan {
  layout: LayoutSnapshot;
}
