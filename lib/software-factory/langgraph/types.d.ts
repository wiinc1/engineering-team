export interface FactoryArtifactReference {
  kind: string;
  reference: string;
  checksum: `sha256:${string}`;
}

export interface FactoryDecision {
  code: string;
  outcome: 'approved' | 'rejected' | 'deferred';
}

export type FactoryLifecycleStatus =
  | 'running' | 'retrying' | 'waiting' | 'succeeded' | 'failed' | 'dead_letter' | 'cancelled';

export interface FactoryChildRun {
  id: string;
  status: 'blocked' | 'ready' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  dependencies: string[];
  attempt: number;
  namespace: `child:${string}`;
}

export interface FactoryGraphStateV1 {
  schemaVersion: 1;
  graphVersion: 'factory-v1';
  tenantId: string;
  factoryRunId: string;
  threadId: `lg_${string}`;
  lifecycleNode: string | null;
  completedNodes: string[];
  artifacts: FactoryArtifactReference[];
  decisions: FactoryDecision[];
  attempt: number;
  updatedAt: string;
  lifecycleStatus: FactoryLifecycleStatus;
  qaOutcome: 'pass' | 'fail' | null;
  qaAttempts: number;
  terminalReason: string | null;
  nodeAttempts: Record<string, number>;
  childRuns: FactoryChildRun[];
}

export interface FactoryDomainNode {
  name: string;
  execute(state: Readonly<FactoryGraphStateV1>): Promise<Partial<FactoryGraphStateV1>> | Partial<FactoryGraphStateV1>;
}
