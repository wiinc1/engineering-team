Mandatory Instruction for all LLMs:
You MUST implement every required section for the chosen tier.
You MUST generate and commit all code, tests, configuration files, and diagrams listed below.
ZERO MANUAL TESTING ALLOWED — Every quality gate must be automated.
Incomplete delivery = story not done.

Template Tier (Choose one — mandatory)
 Simple → Tiny bugfix, refactor, one-file change
 Standard → Typical new endpoint, page, or service
 Complex → Cross-team, new major workflow, architectural impact
 Epic → Multi-sprint initiative
 Standards Verified → I have reviewed docs/AI_IMPLEMENTATION_CHECKLIST.md and docs/STANDARDS_ADHERENCE_REPORT.md before starting.
(Required sections are marked with ✅ per tier in each section header)

1. User Story ✅ All tiers
As a [role],
I want [feature],
so that [benefit].

Business Context & Success Metrics (why we're doing this + measurable outcome):

2. Acceptance Criteria ✅ All tiers
Use Given-When-Then format. Every single scenario MUST become an automated E2E test.

Must Have
Given … When … Then …
Nice to Have (optional)
3. Workflow & User Journey ✅ Standard | Complex | Epic
**User Journey (step-by-step)**
1. …
2. …

**System Flow (technical)**
1. → Component A → Component B → …

**Error & Edge Cases**
- …
(LLM must generate a Mermaid flowchart in /docs/diagrams/ named workflow-[story-id].mmd)

4. Automated Test Deliverables ✅ All tiers (NON-NEGOTIABLE)
LLM — you MUST generate these files and commit them

tests/
├── unit/                       → 95%+ coverage (up from 90%)
│   └── test_[feature].py|ts   → All new/changed code
├── integration/
│   └── test_[feature]_integration.py|ts
├── e2e/                       ← Playwright (TS) or Cypress
│   └── [feature].spec.ts      → One scenario per GWT in section 2
│   └── page-objects/
│       └── [feature]Page.ts
├── contract/                   ← NEW: API contract testing
│   └── pact-[service].spec.ts → Pact/Spring Cloud Contract
├── visual/                     ← NEW: Visual regression (no manual UI review)
│   └── [feature].visual.spec.ts → Playwright screenshots + Percy/Chromatic
├── accessibility/              ← NEW: Automated WCAG validation
│   └── [feature].a11y.spec.ts  → axe-core full page scan
├── performance/                ← NEW: Automated performance budgets
│   └── lighthouse-[page].spec.ts → LCP<2.5s, CLS<0.1, TBT<200ms
└── security/                   ← NEW: Automated security scanning
    └── [feature]-security.spec.ts → OWASP ZAP/Burp scan script

chaos/                          ← For Complex/Epic tiers
└── resilience-[feature].yml    → Chaos Mesh / Gremlin scenario

regression/                     
└── Tag new scenarios with @regression
Additional Test Requirements by Tier
✅ Simple:

Unit tests (95%+ coverage)
1 smoke E2E test (happy path)
Visual regression baseline
Accessibility smoke test (axe-core on main element)
✅ Standard:

Full matrix above
Negative test cases (invalid inputs, unauthorized access)
Mutation testing config (Stryker/PITest for 80%+ mutation score)
Performance test (Lighthouse CI)
✅ Complex:

All Standard requirements
Property-based testing (Hypothesis/fast-check for edge cases)
Chaos engineering scenario (network latency, pod failures)
Load testing (k6 script: 2x expected QPS for 10min)
✅ Epic:

All Complex requirements
Cross-service contract tests with all consumers
Soak testing (24hr sustained load)
Disaster recovery drill automation
Test Data Management
 Test fixtures committed to tests/fixtures/[feature]/
 Factory functions for test data generation
 Database seeding scripts for integration tests
 Anonymized production data samples (if applicable, GDPR-compliant)
5. Data Model & Schema (if applicable) ✅ Complex | Epic
Entities & Relationships

Generate Mermaid ER diagram → /docs/diagrams/schema-[story-id].mmd
Migration Strategy

Backwards compatibility approach (e.g., expand-contract pattern)
Rollback migration script (must be tested)
Validation Rules

DB constraints (NOT NULL, CHECK, FK)
Application-level validation (Zod/Joi/Pydantic schema)
Automated Schema Testing

 Migration test: apply → rollback → apply on empty DB
 Schema diff validation in CI (detects accidental changes)
6. Architecture & Integration ✅ Standard | Complex | Epic
Pattern

Architecture style (e.g., Clean Architecture, Feature-Sliced, Hexagonal, MVC)
New/Changed Components

Generate C4 context/container diagram → /docs/diagrams/architecture-[story-id].mmd
External Integrations

Third-party services (list APIs, SDKs)
Retry/timeout configuration
Circuit breaker settings
Feature Flag

Flag name: ff_[kebab-case-feature]
Platform: [LaunchDarkly / Unleash / Split.io]
Targeting rules: [environment, user segment, percentage]
7. API Design (if applicable) ✅ Standard | Complex | Epic
API Contract

OpenAPI 3.0 specification snippet OR GraphQL schema changes
Committed to /docs/api/[feature]-openapi.yml
Versioning Strategy

Approach: [URL versioning /v2/, header Accept-Version, content negotiation]
Deprecation timeline (if changing existing API)
Backwards Compatibility

Breaking changes: [list any]
Migration path for existing clients
Automated API Testing

 Postman/Newman collection OR REST-assured tests
 OpenAPI spec validation (Spectral linting)
 Contract tests with all known consumers
8. Security & Compliance ✅ Complex | Epic (Standard: bullet list only)
Authentication & Authorization

AuthN changes: [OAuth, JWT, session-based]
AuthZ: [RBAC roles, ABAC policies, resource permissions]
 Automated test: unauthorized access returns 403/401
Secrets Management

Secrets stored in: [Vault, AWS Secrets Manager, Azure Key Vault]
Rotation strategy
 No secrets in code/logs validated by pre-commit hook
Threat Model Top 3 risks + mitigations:

[Threat] → [Mitigation] → [Test that validates mitigation]
…
…
Compliance

Regulations: [GDPR, SOC2, HIPAA, PCI-DSS]
Data classification: [PII, PHI, PCI, Public]
Audit logging requirements
Automated Security Testing

 SAST: Semgrep/Snyk/SonarQube (0 high/critical findings)
 DAST: OWASP ZAP active scan (authenticated)
 Dependency scanning: 0 vulnerable deps
 Secrets scanning: TruffleHog/Gitleaks in pre-commit
8a. Standardized Error Logging ✅ ALL TIERS (MANDATORY)
Philosophy: All features MUST use the centralized error handling system to ensure consistent observability, structured logging, and automated error tracking. This is NON-NEGOTIABLE for all tiers.

🤖 AI AGENTS: READ THIS FIRST
You MUST implement error handling EXACTLY as shown in Section 8b. Do NOT skip to this section without reading 8b first. Section 8b contains the COMPLETE patterns you must copy.

Infrastructure Requirements

All API routes and service layer code MUST use the established standardized error handling infrastructure:

API Routes: Wrap ALL route handlers with withErrorHandling() from /src/lib/errors/wrapper.ts

import { withErrorHandling } from '@/lib/errors/wrapper';

export const POST = withErrorHandling(async (request: NextRequest) => {
  // Route logic - errors automatically caught, logged, and formatted
  // Returns StandardErrorResponse on error
});
Error Classes: Use standardized error classes (NO manual error responses)

import { 
  ValidationError, 
  AuthenticationError, 
  AuthorizationError, 
  NotFoundError,
  ConflictError,
  RateLimitError,
  DatabaseError,
  ExternalServiceError
} from '@/lib/errors';

// Throw errors - withErrorHandling will catch and format them
if (!resource) throw new NotFoundError('Resource', { resourceId });
if (!isAuthorized) throw new AuthorizationError('Insufficient permissions');
if (duplicate) throw new ConflictError('Resource already exists');
Structured Logging: Use log() from /src/lib/logger.ts (ZERO console.log or console.error)

import { log, logError } from '@/lib/logger';

log('info', 'Resource created successfully', { 
  resourceId, 
  userId, 
  tenantId, 
  action: 'create_resource'
});
// Errors automatically logged by withErrorHandling
Validation: Use validateRequest() from /src/lib/errors/validation.ts

import { validateRequest } from '@/lib/errors/validation';

const validation = validateRequest(schema, requestBody);
if (!validation.success) return validation.error; // Returns StandardErrorResponse
Reference Documentation

Error handling guide: /docs/error-handling.md (740 lines - comprehensive system documentation)
Migration guide: /docs/ERROR_HANDLING_MIGRATION_GUIDE.md (586 lines - step-by-step migration)
Current adoption: ~70% of API routes already migrated (287 references across 201 route files)
What's Handled Automatically

✅ Error catching and logging with context
✅ Error response formatting (StandardErrorResponse)
✅ HTTP status code mapping
✅ Prisma error classification
✅ Structured context logging (userId, tenantId, requestId, traceId)
✅ Request tracing with OpenTelemetry
✅ Error tracking integration (Sentry tags, error grouping)
Mandatory Testing Requirements (All Tiers)

 Unit tests verify error classes are thrown (not manual error responses)
 Integration tests verify all error responses match StandardErrorResponse format
 E2E tests validate all error scenarios return correct HTTP status codes
 Error handling unit tests cover all error classes used in the feature
 No manual try-catch blocks for error responses (use error classes instead)
Definition of Done Checklist (Added to Section 15)

These items will be added to Section 15's DoD checklist:

Standardized Error Logging (MANDATORY - All Tiers)
 All API routes use withErrorHandling() wrapper from /src/lib/errors/wrapper.ts

 All logging uses structured log() from /src/lib/logger.ts (ZERO console.log or console.error)

 All errors use standardized error classes (ValidationError, AuthenticationError, etc.)

 All error responses match StandardErrorResponse format

 Error handling tested in unit tests (verify error classes thrown)

 Integration tests verify error response format

 No manual try-catch blocks for error responses

Common Error Patterns by Feature Type

File Upload Features:

// Follow established file upload logging pattern
const startTime = performance.now();
log('info', 'Starting file upload', { fileName, fileSize, fileType, userId });

// ... upload logic ...

const duration = performance.now() - startTime;
log('info', 'File upload completed', { documentId, fileName, fileSize, duration });

// Error examples:
if (fileSize > MAX_SIZE) throw new ValidationError('File too large', { maxSize: MAX_SIZE, fileSize });
if (!ALLOWED_TYPES.includes(fileType)) throw new ValidationError('Invalid file type', { fileType });
External API Integrations:

import { ExternalServiceError } from '@/lib/errors';

try {
  const response = await externalAPI.call();
} catch (error) {
  throw new ExternalServiceError('ExternalService', 'API call failed', { 
    service: 'ExternalService',
    endpoint: '/api/resource',
    statusCode: error.response?.status 
  });
}
Database Operations:

import { DatabaseError, NotFoundError } from '@/lib/errors';

const resource = await prisma.resource.findUnique({ where: { id } });
if (!resource) throw new NotFoundError('Resource', { resourceId: id });

// Prisma errors automatically classified by withErrorHandling
8b. 🤖 AI Implementation Guide ✅ ALL TIERS (MANDATORY - READ FIRST)
CRITICAL: This section contains copy-paste ready patterns that AI agents MUST use when implementing ANY feature. Following these patterns prevents common errors and ensures compliance with the standardized error handling system.

⚠️ AI Pre-Implementation Checklist
Before writing ANY code, verify you understand:

 I will wrap ALL API routes with withErrorHandling()
 I will NEVER use console.log() or console.error()
 I will NEVER write manual try-catch blocks for API responses
 I will use error classes instead of manual error responses
 I will copy the complete patterns below, not write from scratch
 I will run validation scripts after implementation
🚫 NEVER DO THIS (Common AI Mistakes)
// ❌ WRONG - Manual try-catch with error response
export async function POST(request: NextRequest) {
  try {
    // ... code
  } catch (error) {
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

// ❌ WRONG - Console logging
console.log('Processing request...');
console.error('Error:', error);

// ❌ WRONG - Manual error response
if (!data) {
  return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
}

// ❌ WRONG - Generic error messages
throw new Error('Something went wrong');

// ❌ WRONG - Missing return for validation error
if (!validation.success) {
  validation.error; // Forgot return!
}
✅ COMPLETE API ROUTE PATTERN (Copy This Exactly)
// src/app/api/[your-feature]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { withErrorHandling } from '@/lib/errors/wrapper';
import { validateRequest } from '@/lib/errors/validation';
import { log } from '@/lib/logger';
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
  ConflictError,
  DatabaseError,
  ExternalServiceError
} from '@/lib/errors';
import { yourFeatureSchema } from '@/schemas/yourfeature';
import { prisma } from '@/lib/db';

export const POST = withErrorHandling(async (request: NextRequest) => {
  const startTime = performance.now();

  // 1. Authentication check (ALWAYS FIRST)
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session?.user?.tenantId) {
    throw new AuthenticationError('Authentication required');
  }

  const { id: userId, tenantId, role } = session.user;

  // 2. Parse and validate request
  const body = await request.json();
  const validation = validateRequest(yourFeatureSchema, body, {
    userId,
    tenantId,
    action: 'your_action_name'
  });

  if (!validation.success) {
    return validation.error; // MUST RETURN, not just call
  }

  // 3. Authorization check (if role-based)
  if (role !== 'ADMIN' && role !== 'PARTNER') {
    throw new AuthorizationError('Insufficient permissions', {
      userId,
      tenantId,
      requiredRole: 'ADMIN or PARTNER',
      actualRole: role
    });
  }

  // 4. Business logic - NO TRY-CATCH NEEDED (wrapper handles it)
  const resource = await prisma.resource.findFirst({
    where: {
      id: validation.data.resourceId,
      tenantId // ALWAYS filter by tenantId
    }
  });

  if (!resource) {
    throw new NotFoundError('Resource', {
      resourceId: validation.data.resourceId,
      tenantId
    });
  }

  // Check for conflicts
  const existing = await prisma.resource.findFirst({
    where: {
      name: validation.data.name,
      tenantId,
      id: { not: resource.id }
    }
  });

  if (existing) {
    throw new ConflictError('Resource with this name already exists', {
      name: validation.data.name,
      existingId: existing.id
    });
  }

  // Update resource
  const updated = await prisma.resource.update({
    where: { id: resource.id },
    data: validation.data
  });

  // 5. Log success with context and metrics
  const duration = performance.now() - startTime;
  log('info', 'Resource updated successfully', {
    userId,
    tenantId,
    resourceId: updated.id,
    action: 'update_resource',
    duration,
    changes: Object.keys(validation.data)
  });

  // 6. Return success response
  return NextResponse.json({
    success: true,
    data: updated
  }, { status: 200 });
});

// GET endpoint example
export const GET = withErrorHandling(async (request: NextRequest) => {
  const startTime = performance.now();

  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session?.user?.tenantId) {
    throw new AuthenticationError('Authentication required');
  }

  const { tenantId, userId } = session.user;

  // Parse query params
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '10');

  if (page < 1 || limit < 1 || limit > 100) {
    throw new ValidationError('Invalid pagination parameters', {
      page,
      limit,
      maxLimit: 100
    });
  }

  const resources = await prisma.resource.findMany({
    where: { tenantId },
    skip: (page - 1) * limit,
    take: limit,
    orderBy: { createdAt: 'desc' }
  });

  const total = await prisma.resource.count({
    where: { tenantId }
  });

  const duration = performance.now() - startTime;
  log('info', 'Resources fetched', {
    userId,
    tenantId,
    count: resources.length,
    page,
    limit,
    duration
  });

  return NextResponse.json({
    success: true,
    data: resources,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  });
});
✅ SERVICE LAYER PATTERN (For Complex Logic)
// src/services/yourfeature/yourFeatureService.ts
import { prisma } from '@/lib/db';
import { log } from '@/lib/logger';
import {
  NotFoundError,
  ConflictError,
  DatabaseError
} from '@/lib/errors';

export class YourFeatureService {
  async createResource(data: CreateResourceDto, tenantId: string, userId: string) {
    const startTime = performance.now();

    // Check for duplicates
    const existing = await prisma.resource.findFirst({
      where: {
        name: data.name,
        tenantId
      }
    });

    if (existing) {
      throw new ConflictError('Resource already exists', {
        name: data.name,
        tenantId
      });
    }

    // Use transaction for multiple operations
    const result = await prisma.$transaction(async (tx) => {
      const resource = await tx.resource.create({
        data: {
          ...data,
          tenantId,
          createdBy: userId
        }
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          action: 'RESOURCE_CREATED',
          resourceType: 'Resource',
          resourceId: resource.id,
          userId,
          tenantId,
          metadata: data
        }
      });

      return resource;
    });

    const duration = performance.now() - startTime;
    log('info', 'Resource created', {
      resourceId: result.id,
      userId,
      tenantId,
      duration
    });

    return result;
  }

  async getResourceById(id: string, tenantId: string) {
    const resource = await prisma.resource.findFirst({
      where: { id, tenantId }
    });

    if (!resource) {
      throw new NotFoundError('Resource', { id, tenantId });
    }

    return resource;
  }
}

// Export singleton instance
export const yourFeatureService = new YourFeatureService();
✅ REQUIRED TEST PATTERN (Copy This Exactly)
// __tests__/unit/api/yourfeature.test.ts
import { POST, GET } from '@/app/api/yourfeature/route';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/db';
import { NextRequest } from 'next/server';

jest.mock('next-auth');
jest.mock('@/lib/db', () => ({
  prisma: {
    resource: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn()
    }
  }
}));

const mockSession = {
  user: {
    id: 'user-1',
    tenantId: 'tenant-1',
    role: 'ADMIN'
  }
};

const createMockRequest = (body?: any, url?: string) => {
  return new NextRequest(
    url || 'http://localhost:3000/api/yourfeature',
    {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined
    }
  );
};

describe('YourFeature API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getServerSession).mockResolvedValue(mockSession);
  });

  describe('POST /api/yourfeature', () => {
    it('returns StandardErrorResponse for validation errors', async () => {
      const response = await POST(createMockRequest({ invalid: 'data' }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: expect.any(String)
      });
    });

    it('returns 401 for unauthenticated requests', async () => {
      jest.mocked(getServerSession).mockResolvedValue(null);

      const response = await POST(createMockRequest({
        name: 'Test',
        resourceId: 'res-1'
      }));
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error.code).toBe('AUTHENTICATION_ERROR');
    });

    it('returns 403 for unauthorized requests', async () => {
      jest.mocked(getServerSession).mockResolvedValue({
        user: { ...mockSession.user, role: 'VIEWER' }
      });

      const response = await POST(createMockRequest({
        name: 'Test',
        resourceId: 'res-1'
      }));
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('AUTHORIZATION_ERROR');
    });

    it('returns 404 for missing resources', async () => {
      jest.mocked(prisma.resource.findFirst).mockResolvedValue(null);

      const response = await POST(createMockRequest({
        name: 'Test',
        resourceId: 'res-1'
      }));
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error.code).toBe('NOT_FOUND_ERROR');
    });

    it('returns 409 for conflicts', async () => {
      jest.mocked(prisma.resource.findFirst)
        .mockResolvedValueOnce({ id: 'res-1', name: 'Old' }) // Resource exists
        .mockResolvedValueOnce({ id: 'res-2', name: 'Test' }); // Conflict exists

      const response = await POST(createMockRequest({
        name: 'Test',
        resourceId: 'res-1'
      }));
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data.error.code).toBe('CONFLICT_ERROR');
    });

    it('successfully updates resource', async () => {
      const mockResource = { id: 'res-1', name: 'Old', tenantId: 'tenant-1' };
      const updatedResource = { ...mockResource, name: 'New' };

      jest.mocked(prisma.resource.findFirst)
        .mockResolvedValueOnce(mockResource) // Resource exists
        .mockResolvedValueOnce(null); // No conflict
      jest.mocked(prisma.resource.update).mockResolvedValue(updatedResource);

      const response = await POST(createMockRequest({
        name: 'New',
        resourceId: 'res-1'
      }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toEqual(updatedResource);
    });
  });

  describe('GET /api/yourfeature', () => {
    it('returns paginated resources', async () => {
      const mockResources = [
        { id: 'res-1', name: 'Resource 1' },
        { id: 'res-2', name: 'Resource 2' }
      ];

      jest.mocked(prisma.resource.findMany).mockResolvedValue(mockResources);
      jest.mocked(prisma.resource.count).mockResolvedValue(10);

      const response = await GET(new NextRequest(
        'http://localhost:3000/api/yourfeature?page=1&limit=2'
      ));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toEqual(mockResources);
      expect(data.pagination).toEqual({
        page: 1,
        limit: 2,
        total: 10,
        pages: 5
      });
    });

    it('validates pagination parameters', async () => {
      const response = await GET(new NextRequest(
        'http://localhost:3000/api/yourfeature?page=0&limit=200'
      ));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
📋 File-by-File Implementation Checklist
For API Route Files (src/app/api/**/route.ts):
 Import withErrorHandling from @/lib/errors/wrapper
 Import error classes from @/lib/errors
 Import log from @/lib/logger
 Import validateRequest from @/lib/errors/validation
 Import getServerSession and authOptions
 Wrap EVERY export (GET, POST, PUT, DELETE, PATCH) with withErrorHandling
 Check authentication FIRST in every handler
 Validate request body/params with Zod schema
 Filter ALL database queries by tenantId
 Use error classes for ALL error cases
 Log success operations with context and duration
 Return consistent success response format
 NO manual try-catch blocks for error responses
 NO console.log or console.error statements
For Service Files (src/services/**/):
 Import error classes from @/lib/errors
 Import log from @/lib/logger
 Throw error classes for error conditions
 Use transactions for multi-step operations
 Include context in all errors
 Log important operations with metrics
 Handle Prisma unique constraints as ConflictError
 Export singleton instance or functions
For Test Files (__tests__/unit/api/**/*.test.ts):
 Test ALL error scenarios (401, 403, 404, 409, 400)
 Mock getServerSession for auth testing
 Mock prisma for database operations
 Verify StandardErrorResponse format
 Test success cases with proper assertions
 Check error.code matches expected error type
 Test with different user roles
 Test pagination/filtering if applicable
🔍 Validation Commands (Run After Implementation)
# Check for console usage (should return 0 results)
grep -r "console\.\(log\|error\)" src/app/api/yourfeature/

# Check for manual try-catch with error responses (should return 0)
grep -r "catch.*NextResponse\.json.*error" src/app/api/yourfeature/

# Verify withErrorHandling is used (should show all route files)
grep -l "withErrorHandling" src/app/api/yourfeature/*.ts

# Check for proper imports (all should be present)
grep -l "import.*withErrorHandling" src/app/api/yourfeature/route.ts
grep -l "import.*validateRequest" src/app/api/yourfeature/route.ts
grep -l "import.*log.*from.*logger" src/app/api/yourfeature/route.ts
grep -l "import.*Error.*from.*errors" src/app/api/yourfeature/route.ts

# Run the validation script
node scripts/validate-error-handling.cjs --feature yourfeature

# Run tests to verify implementation
npm run test:unit -- yourfeature.test.ts
⚡ Quick Decision Tree for Error Types
Authentication failed? → throw new AuthenticationError()
Permission denied? → throw new AuthorizationError()
Resource not found? → throw new NotFoundError()
Duplicate/exists? → throw new ConflictError()
Invalid input? → throw new ValidationError()
Rate limited? → throw new RateLimitError()
Database issue? → throw new DatabaseError()
External API failed? → throw new ExternalServiceError()
Anything else? → Let it bubble up (wrapper handles it)
🎯 Success Criteria for AI Implementation
Your implementation is COMPLETE when:

✅ All API routes wrapped with withErrorHandling()
✅ Zero console.log/console.error statements
✅ All errors use proper error classes
✅ All database queries filtered by tenantId
✅ Request validation uses Zod schemas
✅ Authentication checked in every endpoint
✅ Tests cover all error scenarios
✅ Validation script passes with no violations
✅ TypeScript compilation succeeds
✅ All tests pass
REMEMBER: Copy the patterns above exactly. Do not improvise or create your own patterns. The standardized system ensures consistency across the entire codebase.

9. Performance & Scalability ✅ Complex | Epic
Performance Budgets

Response time: p95 < [X]ms, p99 < [Y]ms
Client-side: LCP < 2.5s, FID < 100ms, CLS < 0.1
Database query time: p95 < [Z]ms
Expected Load

QPS: [current] → [expected after feature]
Concurrent users: [number]
Data volume: [rows/documents/events per day]
Caching Strategy

Cache layers: [Redis, CDN, browser, application]
TTL: [duration]
Invalidation strategy: [time-based, event-driven, manual]
Automated Performance Testing

 Load test: k6 script at tests/performance/[feature].js
 Baseline established (current p95/p99 recorded)
 Regression threshold: p95 increases < 10%
 Stress test: Find breaking point (requests/sec until errors)
Scalability Plan

Horizontal scaling triggers: [CPU > 70%, queue depth > 100]
Database scaling: [read replicas, sharding strategy]
10. UI/UX (if applicable) ✅ Standard | Complex | Epic
Design Assets

Figma link: [URL]
OR Wireframe description/sketch
Component Library

Components used: [Material-UI, shadcn/ui, custom]
New components created: [list]
Responsive Design

Breakpoints: 320px (mobile), 768px (tablet), 1024px (desktop), 1920px (large)
Visual Regression (MANDATORY — replaces manual UI review)

 Percy/Chromatic/Playwright baseline screenshots committed
 Threshold: 0.05% pixel diff tolerance
 All breakpoints covered
 All interactive states captured (hover, focus, error, disabled)
Accessibility Automation (NOT OPTIONAL)

 WCAG 2.2 Level AA compliance automated
 axe-core runs in every E2E test (0 violations allowed)
 Pa11y-ci in CI pipeline
 Keyboard navigation E2E test:
Tab order logical
Enter/Space activate buttons
Esc closes modals
Arrow keys work in lists/grids
 Screen reader testing:
All images have alt text
Form inputs have labels
ARIA roles/labels validated
Live regions for dynamic content
Interaction Recording (✅ Complex+)

 Playwright trace on failure → uploaded to S3/artifact storage
 Session replay tool tags: feature:[name]
 Funnel tracking: [list steps]
Automated UX Validation

 Click/tap targets ≥ 44x44px (validated by automated test)
 Color contrast ≥ 4.5:1 (validated by axe-core)
 Form validation messages tested (all error states)
11. Deployment & Release Strategy ✅ ALL TIERS (changed from Complex+)
Deployment Type

Strategy: [blue-green / canary / rolling update / feature flag toggle]
Progressive Rollout (NON-NEGOTIABLE — replaces manual testing)

 Feature flag created: ff_[feature] in [LaunchDarkly/Unleash/Split]
 Rollout stages: 1% → 5% → 25% → 50% → 100%
 Soak time at each stage: minimum 24h with zero alert fires
 Targeting strategy: [random / opt-in beta users / internal team / geography]
Automated Rollback Triggers (NO HUMAN DECISION REQUIRED)

 Error rate > 1% for 5 consecutive minutes → auto-rollback
 p95 latency > 2x baseline for 10 minutes → auto-rollback
 Custom business metric: [e.g., conversion rate drops > 5%] → auto-rollback
 Feature flag health check fails → auto-disable flag
Rollback Procedure

Automated: [feature flag flip to 0% / redeploy previous version]
Manual override: [command / dashboard button]
RTO: < [X minutes]
Synthetic Monitoring (Replaces manual smoke tests)

 Datadog/Checkly/Pingdom synthetic test runs every 5min
 Critical user path scripted: [list steps]
 Multi-region checks: [US-East, EU-West, AP-Southeast]
 Alert: PagerDuty P1 if synthetic fails 2x consecutive
Pre-Production Validation (Automated)

 Staging deployment successful
 Synthetic tests pass 3x on staging
 Canary deployment in prod (1% traffic) successful for 1hr
 No error rate increase detected
12. Monitoring & Observability ✅ ALL TIERS (changed from Complex+)
Service Level Objectives (MANDATORY)

 Availability SLO: [e.g., 99.9% uptime]
 Latency SLO: [e.g., p95 < 200ms]
 Error rate SLO: [e.g., < 0.1%]
 Error budget: [X requests/day allowed to fail]
Automated Anomaly Detection

 SLO burn rate alert (Prometheus/Grafana)
 Comparison to baseline (rolling 7-day average)
 Spike detection: > 3 std dev from mean
New Metrics (must be implemented)

# Format: metric_name{labels} - description
feature_[name]_requests_total{status, endpoint} - Request counter
feature_[name]_duration_seconds{endpoint} - Request duration histogram
feature_[name]_errors_total{type} - Error counter
feature_[name]_business_metric{dimension} - [e.g., items_added_to_cart]
New Logs (structured JSON)

{
  "level": "info|warn|error",
  "feature": "[feature-name]",
  "trace_id": "...",
  "user_id": "...",
  "action": "...",
  "outcome": "success|failure",
  "duration_ms": 123
}
Alerts (must be created)

 P0: [condition] → PagerDuty → wake up on-call
 P1: [condition] → Slack #incidents
 P2: [condition] → Email → review next business day
Dashboards

 Grafana dashboard JSON committed to /monitoring/dashboards/[feature].json
 Panels: request rate, error rate, latency (p50/p95/p99), business metrics
Real User Monitoring (RUM)

 Core Web Vitals tracked per route/feature:
LCP (Largest Contentful Paint)
FID (First Input Delay)
CLS (Cumulative Layout Shift)
 Sentry/Datadog session replay on errors (last 30s before error)
 Conversion funnel tracking: [list steps with expected drop-off %]
Distributed Tracing (✅ Standard+)

 OpenTelemetry spans for all async operations
 Jaeger/Tempo trace IDs in all logs
 Span attributes: user_id, feature_flag_variant, correlation_id
Error Tracking

 Sentry/Rollbar tags: feature:[name], release:[version]
 Error grouping rules configured
 Source maps uploaded
Self-Healing Signals (✅ Complex+)

 Circuit breaker: [X failures in Y seconds → open for Z seconds]
 Auto-scaling trigger: [p95 > Xms → +2 pods]
 Queue depth trigger: [> 100 messages → scale workers]
13. Cost & Resource Impact ✅ Epic (Complex: estimate only)
Monthly Cost Delta

Compute: $ [current] → $ [projected] ([% change])
Storage: $ [database, S3, etc.]
Third-party: $ [APIs, SaaS tools]
Total: $ [sum]
Cost Optimization Levers

[e.g., "Cache layer reduces DB queries by 80%"]
[e.g., "Async processing moves work to cheaper spot instances"]
Resource Quotas

CPU: [cores]
Memory: [GB]
Storage: [TB]
Rate limits: [requests/sec to external APIs]
14. Dependencies & Risks ✅ Complex | Epic
Blocking Dependencies

Stories: [list story IDs]
Teams: [team names + what we need from them]
External: [vendor timelines, hardware procurement]
Technical Risks

Risk	Impact	Probability	Mitigation	Owner
[e.g., Third-party API has 10s latency]	High	Medium	Cache responses for 5min, implement timeout<2s	@engineer
Technical Debt

Debt Added: [e.g., "Hardcoded config that should be DB-driven"]
Rationale: [speed to market]
Payback ticket: [JIRA-123]
Debt Paid: [e.g., "Removed deprecated API endpoint"]
15. Definition of Done (DoD) — LLM Checklist
All items must be committed and verified AUTOMATICALLY before marking done

Automated Quality Gates (CI/CD MUST BLOCK if any fail)
 Code coverage ≥ 95% (unit) + 100% coverage of critical paths (E2E)
 Mutation test score ≥ 80% (Stryker/PITest)
 Visual regression: 0 unreviewed pixel diffs (Percy/Chromatic approved)
 Accessibility: 0 axe-core violations (serious/critical)
 Security: 0 high/critical SAST findings (Snyk/Semgrep/SonarQube)
 Performance: Lighthouse score ≥ 90 (all categories: performance, accessibility, best practices, SEO)
 Contract tests: All consumer pacts verified (Pact Broker green)
 Load test: p95 < target under 2x expected QPS
 Chaos test passed (if applicable — pod killed, latency injected, no errors)
 API contract validated: OpenAPI spec valid + matches implementation
Code Quality
 Lint passes (ESLint/Pylint/Rubocop — 0 errors)
 Type checking passes (TypeScript strict mode / mypy --strict)
 Dependency vulnerabilities: 0 high/critical (npm audit / pip-audit)
 Code review approved by 2 engineers
 All TODO/FIXME comments have linked tickets
Documentation
 README updated (if new service/feature)
 OpenAPI spec committed (if API changes)
 Mermaid diagrams generated and committed to /docs/diagrams/:
Workflow diagram (section 3)
ER diagram (if section 5)
C4 architecture diagram (if section 6)
 Runbook auto-generated at /docs/runbooks/[feature].md:
How to verify feature is working
How to rollback
Common errors + resolutions
Dashboards + alert links
Deployment Gates
 Feature flag created + tested in staging: ff_[feature]
 Synthetic monitor deployed + passing (5min interval)
 SLO/error budget configured in monitoring system
 Alerts created + routed to correct channels
 Rollback procedure tested in staging (feature flag → 0%, verify no errors)
 Database migrations tested: apply → rollback → apply (on staging)
Infrastructure
 Infrastructure as Code committed (Terraform/Pulumi/CloudFormation)
 Secrets added to vault (no plaintext secrets in configs)
 Resource limits configured (CPU/memory/storage quotas)
 Auto-scaling rules defined + tested
16. Production Validation Strategy ✅ All tiers (NEW SECTION)
Philosophy: Production IS the final test environment
Since humans won't manually test, we rely on:

Automated pre-flight checks (Section 15)
Progressive rollout with automated rollback (Section 11)
Comprehensive observability (Section 12)
Observability-Driven Development
 Every error scenario has a unique error code

Format: ERR_[FEATURE]_[SCENARIO] (e.g., ERR_CHECKOUT_PAYMENT_TIMEOUT)
Logged with context (user_id, trace_id, input sanitized)
 Business metrics tracked in real-time:

[e.g., "Checkout completion rate per payment method"]
[e.g., "Search result click-through rate"]
Baseline: [X%] → Target: [Y%] → Alert if drops below: [Z%]
 Alerting SLA:

P0 (site down / data loss): < 5min detection → page on-call
P1 (feature broken): < 30min detection → Slack alert
P2 (degraded): < 2hr detection → email
Automatic Verification in Production
 Health check endpoint: /health/[feature]

Returns: {"status": "healthy", "checks": {...}}
Verifies: DB connection, external API reachable, cache hit rate > X%
 Smoke test API:

Endpoint: /api/internal/smoke-test/[feature]
Executes: Minimal happy path (read-only, idempotent)
Called by: Synthetic monitor every 5min
 Comparison testing (Shadow traffic / Dark launch):

5% of requests duplicated to new code path
Responses compared (old vs new)
Alert if: response diff > X% OR new code errors
Feedback Loops (User-Facing)
 Feature usage dashboard:

Tool: [Mixpanel / Amplitude / PostHog]
Metrics: DAU, feature adoption %, time spent
Review cadence: Daily for first week, then weekly
 User behavior analytics:

Rage click detection (LogRocket / FullStory)
Error click tracking (users clicking broken elements)
Alert if: > 10 rage clicks/day on feature
 User feedback:

In-app survey trigger: 24hr after feature interaction
NPS question: "How likely to recommend [feature]?"
Target: NPS > 50, alert if < 30
Escape Hatch (Emergency Controls)
 Kill Switch: Emergency feature flag to disable globally

Flag name: ff_[feature]_killswitch
Access: On-call engineer, Product Manager, CTO
SLA: < 2min to disable after decision
 Documented in runbook: /docs/runbooks/[feature]-emergency.md

Symptoms requiring kill switch
Command to execute
Notification steps (who to inform)
Post-mortem template
Post-Deployment Verification Checklist (Automated)
 Deployment successful (K8s/ECS/Vercel reports healthy)
 Synthetic test passes 3x post-deploy (spaced 5min apart)
 RUM shows no anomalies for 1hr:
Error rate < 0.1%
p95 latency within 10% of baseline
Core Web Vitals stable
 Gradual rollout schedule:
1% for 24h → 0 incidents
5% for 24h → 0 incidents
25% for 24h → 0 incidents
50% for 24h → 0 incidents
100% → full launch
 Business metrics stable or improved (compare to 7-day baseline)
 No spike in support tickets related to feature
17. Compliance & Handoff ✅ All tiers
Code Repository

 All code committed to: feature/[story-id]-[description]
 PR title: [STORY-ID] [Feature name]
 PR description links to this story
Artifact Locations

 Tests: /tests/[unit|integration|e2e|...]/[feature].*
 Diagrams: /docs/diagrams/[workflow|schema|architecture]-[story-id].mmd
 Runbook: /docs/runbooks/[feature].md
 Monitoring: /monitoring/dashboards/[feature].json, /monitoring/alerts/[feature].yml
Final Actions

 This user story file moved to /implemented/[story-id].md
 Feature flag state documented in /docs/feature-flags.md
 Post-deploy announcement sent to: [Slack #engineering-updates]
 Demo video recorded (optional, 2min screencast for team)
Continuous Improvement

 Retrospective notes captured: What went well? What to improve?
 Update this template if gaps found (submit PR to template repo)
LLM Final Checklist — DO NOT SKIP
Before marking this story as "DONE," verify:

Every section with ✅ for your tier is complete (not "TODO" or "N/A" unless truly not applicable)
All files listed in Section 4 exist and tests pass
All files listed in Section 15 exist (diagrams, runbooks, dashboards)
All checkboxes in Section 15 (DoD) are checked (CI confirms automatically)
Section 16 production validation is configured (health checks, synthetic monitors, alerts)
Feature flag ff_[feature] is created and tested
No manual testing occurred — quality is assured by automated gates only
If any of the above are false, the story is NOT done.

Template Philosophy
This template eliminates manual testing by requiring extensive automation upfront. The investment in test automation, monitoring, and progressive rollout is significantly higher than traditional development, but results in:

Faster iteration (no QA bottleneck)
Higher confidence (tests don't forget steps)
Better production reliability (issues caught early by monitors)
Continuous deployment capability (every green CI run can deploy)
The 60/40 Rule: Expect 60% of development time on automation, 40% on feature code.

Quick Reference: Tier Requirements
Simple Tier
Sections: 1, 2, 4 (basic), 11, 12, 15, 16, 17
Tests: Unit (95%), 1 E2E smoke, visual baseline, a11y smoke
Time estimate: 1-2 days (including automation)
Standard Tier
Sections: 1-4, 6-7, 10-12, 15-17
Tests: Full test matrix, mutation testing, contract tests
Time estimate: 3-7 days (including automation)
Complex Tier
Sections: 1-12, 14-17
Tests: All Standard + chaos, property-based, load tests
Time estimate: 1-3 weeks (including automation)
Epic Tier
All sections (1-17)
Tests: All Complex + soak tests, DR drills, multi-service contracts
Time estimate: 3+ weeks (including automation)