export interface FactoryArtifactReference {
  kind: string;
  reference: string;
  checksum: `sha256:${string}`;
}

export interface FactoryDecision {
  code: string;
  outcome: 'approved' | 'rejected' | 'deferred';
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
}

export interface FactoryDomainNode {
  name: string;
  execute(state: Readonly<FactoryGraphStateV1>): Promise<Partial<FactoryGraphStateV1>> | Partial<FactoryGraphStateV1>;
}
