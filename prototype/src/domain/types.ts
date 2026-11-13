export type Severity = "Critical" | "High" | "Medium" | "Low";
export type Page =
  | "command"
  | "scope"
  | "discovery"
  | "assets"
  | "risk"
  | "threat"
  | "twin"
  | "paths"
  | "simulation"
  | "advisor"
  | "guardian"
  | "agents"
  | "models"
  | "reports"
  | "audit"
  | "settings";
export interface Asset {
  id: string;
  name: string;
  address: string;
  type: "Gateway" | "Server" | "Database" | "Endpoint" | "Cloud";
  environment: "Production" | "Staging" | "Corporate";
  criticality: Severity;
  exposure: "Internet" | "Internal" | "Isolated";
  owner: string;
  status: "Monitored" | "Review" | "Protected";
  services: string[];
  lastSeen: string;
  notes: string;
  x: number;
  y: number;
}
export interface Relationship {
  id: string;
  source: string;
  target: string;
  label: string;
  kind: "observed" | "inferred" | "hypothetical";
}
export interface Finding {
  id: string;
  title: string;
  assetId: string;
  severity: Severity;
  status: "Open" | "Investigating" | "Resolved";
  baseScore: number;
  evidence: string;
  factors: string[];
  description: string;
  cve?: string;
  technique?: string;
}
export interface WorkspaceEvent {
  id: string;
  title: string;
  detail: string;
  type: "finding" | "asset" | "workflow";
  timestamp: string;
  assetId?: string;
}
export interface Scenario {
  id: string;
  name: string;
  description: string;
  startAssetId: string;
  targetAssetId: string;
  assumptions: string[];
}
export interface ModelPath {
  id: string;
  assetIds: string[];
  relationshipIds: string[];
  assumptions: string[];
  impact: string;
}
export interface Simulation {
  id: string;
  scenarioId: string;
  startedAt: string;
  pathAssetIds: string[];
  relationshipIds: string[];
  outcome: "Potential exposure" | "No modeled path";
  steps: string[];
  riskScore: number;
  assumptions: string[];
}
export interface Recommendation {
  id: string;
  title: string;
  description: string;
  assetId: string;
  findingId?: string;
  riskReduction: number;
  disruption: number;
  effort: number;
  rationale: string;
  control: string;
  blockedRelationshipIds: string[];
}
export interface Approval {
  id: string;
  recommendationId: string;
  decision: "Approved" | "Rejected";
  notes: string;
  timestamp: string;
  reviewer: string;
  simulationId?: string;
}
export interface AuditRecord {
  id: string;
  action: string;
  detail: string;
  timestamp: string;
  category:
    | "Workspace"
    | "Asset"
    | "Simulation"
    | "Decision"
    | "Report"
    | "Discovery"
    | "Settings";
  relatedId?: string;
}
export interface Settings {
  analystName: string;
  compactMode: boolean;
  reducedMotion: boolean;
}
export interface ReportRecord {
  id: string;
  generatedAt: string;
  name: string;
  content: string;
}
export interface Workspace {
  version: 1;
  id: string;
  name: string;
  scope: string;
  assets: Asset[];
  relationships: Relationship[];
  findings: Finding[];
  events: WorkspaceEvent[];
  scenarios: Scenario[];
  simulations: Simulation[];
  recommendations: Recommendation[];
  approvals: Approval[];
  audit: AuditRecord[];
  reports: ReportRecord[];
  settings: Settings;
  lastDiscovery: string;
}
export interface RiskResult {
  score: number;
  level: Severity;
  base: number;
  exposure: number;
  criticality: number;
  explanation: string;
}
