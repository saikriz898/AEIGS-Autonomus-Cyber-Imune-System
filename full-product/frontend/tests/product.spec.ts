import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Never initialize an arbitrary deployment. Run only against the documented,
// separate aegis-full-product-checks Compose project on port 3001 with this flag.
test.skip(
  process.env.AEGIS_E2E_ISOLATED !== '1',
  'Requires the isolated local verification stack.',
);
let account: { email: string; password: string };
const privateDirectory = path.resolve(process.cwd(), '../.e2e');
const accountPath = path.join(privateDirectory, 'checks-account.json');

test.beforeAll(async ({ request }) => {
  const response = await request.get('/api/auth/status');
  expect(response.ok(), 'The isolated verification API must be healthy').toBeTruthy();
  const status = await response.json();
  if (status.setup_required) {
    const environment = readFileSync(path.resolve(process.cwd(), '../.env'), 'utf8');
    const token = environment
      .split(/\r?\n/)
      .find((line) => line.startsWith('SETUP_TOKEN='))
      ?.slice('SETUP_TOKEN='.length)
      .trim();
    if (!token) throw new Error('The isolated local setup token is unavailable.');
    account = {
      email: `qa-${randomBytes(6).toString('hex')}@example.invalid`,
      password: randomBytes(30).toString('base64url'),
    };
    const setup = await request.post('/api/auth/setup', {
      headers: { 'X-Setup-Token': token },
      data: {
        ...account,
        name: 'Verification analyst',
        workspace_name: 'AEGIS verification workspace',
        scope:
          'Authorized synthetic documentation addresses and example domains. Isolated local product verification; no scans or external infrastructure actions.',
      },
    });
    expect(setup.ok(), await setup.text()).toBeTruthy();
    mkdirSync(privateDirectory, { recursive: true });
    writeFileSync(accountPath, JSON.stringify(account), { mode: 0o600 });
  } else {
    if (!existsSync(accountPath))
      throw new Error(
        'Verification database has an owner but no matching local test credentials. Do not run these setup tests against a personal workspace.',
      );
    account = JSON.parse(readFileSync(accountPath, 'utf8'));
  }
});

async function login(request: APIRequestContext) {
  const response = await request.post('/api/auth/login', { data: account });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

test('connected persisted analyst workflow and responsive workspace', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const auth = await login(page.request);
  const wid = auth.workspaces[0].id;
  await page.setViewportSize({ width: 1440, height: 1000 });
  const started = Date.now();
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Command Center', exact: true, level: 1 }),
  ).toBeVisible();
  const initialReadyMs = Date.now() - started;
  await page.screenshot({
    path: testInfo.outputPath('aegis-full-product-desktop.png'),
    fullPage: true,
  });
  const baseline = await (await page.request.get(`/api/workspaces/${wid}/bootstrap`)).json();
  const bootstrapTimings: number[] = [];
  for (let sample = 0; sample < 5; sample++) {
    const sampleStart = Date.now();
    const sampleResponse = await page.request.get(`/api/workspaces/${wid}/bootstrap`);
    expect(sampleResponse.ok()).toBeTruthy();
    await sampleResponse.body();
    bootstrapTimings.push(Date.now() - sampleStart);
  }
  expect(baseline.assets.length).toBe(12);
  expect(baseline.findings.length).toBe(10);
  const routeNames = [
    ['events', 'Security Events'],
    ['assets', 'Asset Inventory'],
    ['discovery', 'Discovery Runs'],
    ['scope', 'Scope & Workspace'],
    ['risk', 'Risk Intelligence'],
    ['threat', 'Threat Intelligence'],
    ['twin', 'Digital Twin'],
    ['snapshots', 'Snapshots'],
    ['paths', 'Attack Paths'],
    ['simulations', 'Simulations'],
    ['safehouse', 'Safehouse'],
    ['advisor', 'Defense Advisor'],
    ['guardian', 'Guardian Gate'],
    ['assistant', 'AI Assistant'],
    ['conversations', 'Conversations'],
    ['agents', 'Agent Center'],
    ['models', 'Model Center'],
    ['datasets', 'Datasets'],
    ['training', 'Training Runs'],
    ['registry', 'Model Registry'],
    ['reports', 'Reports'],
    ['jobs', 'Background Jobs'],
    ['audit', 'Audit Logs'],
    ['notifications', 'Notifications'],
    ['members', 'Members & Roles'],
    ['integrations', 'Integrations'],
    ['settings', 'Settings'],
  ];
  for (const [route] of routeNames) {
    await page.goto(`/#/${route}`);
    await expect(page.locator('nav a[aria-current="page"]')).toHaveAttribute('href', `#/${route}`);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.locator('main')).not.toContainText('Application error');
  }
  const csrf = { 'X-CSRF-Token': auth.csrf_token };
  const asset =
    baseline.assets.find((a: { name: string }) => a.name === 'web-prod-01') || baseline.assets[0];
  const update = await page.request.patch(`/api/workspaces/${wid}/assets/${asset.id}`, {
    headers: csrf,
    data: {
      owner: 'Verified analyst team',
      notes: 'Read-only seeded infrastructure metadata edited in isolated product verification.',
    },
  });
  expect(update.ok(), await update.text()).toBeTruthy();
  const scenario = baseline.scenarios[0];
  const simulation = await page.request.post(`/api/workspaces/${wid}/simulations`, {
    headers: csrf,
    data: { scenario_id: scenario.id },
  });
  expect(simulation.ok(), await simulation.text()).toBeTruthy();
  const result = await simulation.json();
  expect(result.path_asset_ids.length).toBeGreaterThan(1);
  const recommendation = baseline.recommendations[0];
  const decision = await page.request.post(
    `/api/workspaces/${wid}/recommendations/${recommendation.id}/decisions`,
    {
      headers: csrf,
      data: {
        decision: 'Approved',
        notes:
          'Reviewed the stored model and approved this recommendation for planning records only.',
      },
    },
  );
  expect(decision.ok(), await decision.text()).toBeTruthy();
  const report = await page.request.post(`/api/workspaces/${wid}/reports`, {
    headers: csrf,
    data: {
      name: 'Isolated connected workflow review',
      idempotency_key: `e2e-report-${Date.now()}`,
    },
  });
  expect(report.ok(), await report.text()).toBeTruthy();
  const queued = await report.json();
  const jobId = queued.job?.id || queued.id;
  await expect
    .poll(
      async () => {
        const r = await page.request.get(`/api/workspaces/${wid}/jobs/${jobId}`);
        return (await r.json()).status;
      },
      { timeout: 30000 },
    )
    .toBe('succeeded');
  const after = await (await page.request.get(`/api/workspaces/${wid}/bootstrap`)).json();
  expect(after.assets.find((a: { id: string }) => a.id === asset.id).owner).toBe(
    'Verified analyst team',
  );
  expect(
    after.approvals.some(
      (a: { recommendation_id: string }) => a.recommendation_id === recommendation.id,
    ),
  ).toBeTruthy();
  expect(after.reports.length).toBeGreaterThan(0);
  const reportText = after.reports[0].content || '';
  // Detail endpoints may intentionally omit report content from bootstrap.
  if (reportText) expect(reportText).toContain('Verified analyst team');
  const assistant = await (
    await page.request.get(`/api/workspaces/${wid}/assistant/status`)
  ).json();
  expect(assistant.configured).toBe(false);
  const candidates = await (
    await page.request.get(`/api/workspaces/${wid}/datasets/available-files`)
  ).json();
  const source = candidates.files.find((file: { path: string }) =>
    file.path.endsWith('/UNSW-NB15_Dataset2.csv'),
  );
  expect(source, 'The read-only UNSW dataset must be visible in the configured mount').toBeTruthy();
  const existingDatasets = await (await page.request.get(`/api/workspaces/${wid}/datasets`)).json();
  let dataset = existingDatasets.find((item: { files: { path: string }[] }) =>
    item.files.some((file) => file.path === source.path),
  );
  if (!dataset) {
    const registered = await page.request.post(`/api/workspaces/${wid}/datasets`, {
      headers: csrf,
      data: {
        name: 'QA bounded UNSW profile',
        path: source.path,
        task: 'network',
        license_status: 'unknown',
        source: '',
        citation: '',
      },
    });
    expect(registered.ok(), await registered.text()).toBeTruthy();
    dataset = await registered.json();
  }
  const mapped = await page.request.patch(`/api/workspaces/${wid}/datasets/${dataset.id}`, {
    headers: csrf,
    data: {
      task: 'network',
      mapping: {
        label_column: 'attack',
        feature_columns: ['dur', 'spkts', 'dpkts'],
        categorical_columns: [],
        split_strategy: 'stratified',
      },
    },
  });
  expect(mapped.ok(), await mapped.text()).toBeTruthy();
  const ingest = await page.request.post(`/api/workspaces/${wid}/datasets/${dataset.id}/ingest`, {
    headers: csrf,
    data: { row_limit: 2000, idempotency_key: `e2e-ingestion-${Date.now()}` },
  });
  expect(ingest.ok(), await ingest.text()).toBeTruthy();
  const ingestion = await ingest.json();
  await expect
    .poll(
      async () => {
        const r = await page.request.get(`/api/workspaces/${wid}/jobs/${ingestion.id}`);
        return (await r.json()).status;
      },
      { timeout: 30000 },
    )
    .toBe('succeeded');
  const blockedTraining = await page.request.post(
    `/api/workspaces/${wid}/datasets/${dataset.id}/train`,
    { headers: csrf, data: { algorithm: 'logistic_regression', row_limit: 2000 } },
  );
  expect(blockedTraining.status(), 'Unknown real-dataset permissions must prevent training').toBe(
    422,
  );
  const storedDataset = await (
    await page.request.get(`/api/workspaces/${wid}/datasets/${dataset.id}`)
  ).json();
  expect(storedDataset.license_status).toBe('unknown');
  expect(storedDataset.files[0].checksum).toBe(source.sha256);
  await page.goto('/#/jobs');
  await expect(
    page.getByRole('heading', { name: 'Background Jobs', exact: true, level: 1 }),
  ).toBeVisible();
  await page.getByRole('button', { name: `Open ${ingestion.id}`, exact: true }).click();
  const jobDetails = page.getByRole('dialog');
  await expect(jobDetails).toContainText(ingestion.id);
  await expect(jobDetails).toContainText('succeeded');
  await jobDetails.getByRole('button', { name: 'Close details', exact: true }).click();
  await page.goto('/#/twin');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole('heading', { name: 'Digital Twin', exact: true, level: 1 }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('.sidebar')
        .evaluate((element) => Math.round(element.getBoundingClientRect().right)),
    )
    .toBeLessThanOrEqual(1);
  await page.screenshot({
    path: testInfo.outputPath('aegis-full-product-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  for (const route of [
    'command',
    'assets',
    'events',
    'datasets',
    'models',
    'guardian',
    'settings',
  ]) {
    await page.goto(`/#/${route}`);
    await expect(page.locator('nav a[aria-current="page"]')).toHaveAttribute('href', `#/${route}`);
    await expect(page.locator('main h1')).toBeVisible();
    const width = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(width.page, `${route} must fit the mobile viewport`).toBeLessThanOrEqual(width.viewport);
  }
  expect(errors).toEqual([]);
  await testInfo.attach('timing', {
    body: JSON.stringify({
      initialAuthenticatedReadyMs: initialReadyMs,
      bootstrapRoundTripMs: bootstrapTimings,
      bootstrapMeanMs: Math.round(
        bootstrapTimings.reduce((sum, value) => sum + value, 0) / bootstrapTimings.length,
      ),
      viewport: '1440x1000',
      note: 'Local Docker verification, seeded 12-asset workspace.',
    }),
    contentType: 'application/json',
  });
});

test('unauthenticated access and security headers', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Sign in to your workspace/i })).toBeVisible();
  const response = await page.request.get('/api/workspaces');
  expect(response.status()).toBe(401);
  const headers = await page.request.get('/');
  expect(headers.headers()['content-security-policy']).toBeTruthy();
  expect(headers.headers()['x-content-type-options']).toBe('nosniff');
  await expect(page.getByRole('link', { name: 'Create account', exact: true })).toHaveAttribute(
    'href',
    '/register',
  );
});

test('registration creates a private workspace without joining an existing one', async ({
  page,
}, testInfo) => {
  const owner = await login(page.request);
  const originalWorkspace = owner.workspaces[0].id;
  await page.context().clearCookies();
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: 'Create an account', exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('aegis-full-product-registration.png'),
    fullPage: true,
    animations: 'disabled',
  });
  const password = randomBytes(24).toString('base64url');
  await page.getByLabel('Your name', { exact: true }).fill('New private analyst');
  await page
    .getByLabel('Email address', { exact: true })
    .fill(`register-${randomBytes(6).toString('hex')}@example.invalid`);
  await page.getByLabel('Password', { exact: false }).first().fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await page
    .getByLabel('Private workspace name', { exact: true })
    .fill('Private registration workspace');
  await page
    .getByLabel('Authorized demo scope', { exact: true })
    .fill(
      'Synthetic documentation assets only. This new private workspace performs no real discovery or infrastructure changes.',
    );
  await page
    .getByRole('button', { name: 'Create account & private workspace', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Command Center', exact: true, level: 1 }),
  ).toBeVisible();
  const session = await (await page.request.get('/api/auth/me')).json();
  expect(session.workspaces).toHaveLength(1);
  expect(session.workspaces[0].id).not.toBe(originalWorkspace);
  const forbidden = await page.request.get(`/api/workspaces/${originalWorkspace}/bootstrap`);
  expect(forbidden.status()).toBe(404);
  const privateWorkspace = session.workspaces[0].id;
  const catalogResponse = await page.request.get(`/api/workspaces/${privateWorkspace}/datasets`);
  expect(catalogResponse.ok(), await catalogResponse.text()).toBeTruthy();
  const catalog = await catalogResponse.json();
  expect(catalog, 'A new workspace should catalog the four mounted files as metadata').toHaveLength(
    4,
  );
  expect(new Set(catalog.map((dataset: { id: string }) => dataset.id)).size).toBe(4);
  const catalogFiles = catalog.flatMap((dataset: { files: { path: string }[] }) => dataset.files);
  expect(catalogFiles).toHaveLength(8);
  expect(new Set(catalogFiles.map((file: { path: string }) => file.path)).size).toBe(8);
  for (const dataset of catalog) {
    expect(dataset.task).toBe('unassigned');
    expect(dataset.license_status).toBe('unknown');
    expect(dataset.status).toBe('registered');
    expect(dataset.mapping).toEqual({});
  }
  const trainingSubmissions: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      /\/datasets\/[^/]+\/train$/.test(new URL(request.url()).pathname)
    )
      trainingSubmissions.push(request.url());
  });
  await page.goto('/#/training');
  await expect(
    page.getByRole('heading', { name: 'Training Runs', exact: true, level: 1 }),
  ).toBeVisible();
  const trainingForm = page.locator('section.panel').filter({
    has: page.getByRole('heading', { name: 'Create a training job', exact: true }),
  });
  const datasetSelector = trainingForm.getByRole('combobox').first();
  await expect(datasetSelector.locator('option')).toHaveCount(5);
  await expect(
    datasetSelector.locator('option', { hasText: 'Task selection required' }),
  ).toHaveCount(4);
  const selectedDataset = catalog[0];
  await datasetSelector.selectOption(selectedDataset.id);
  const readiness = page.locator('section.panel').filter({
    has: page.getByRole('heading', { name: 'Readiness checks', exact: true }),
  });
  await expect(
    readiness.locator('.readiness-list > div').filter({ hasText: 'Task pipeline selected' }),
  ).toContainText('Required');
  await expect(readiness).toContainText('Unassigned — explicit selection required');
  const selectedFile =
    selectedDataset.files.find(
      (file: { path: string }) => file.path === selectedDataset.quality?.canonical_path,
    ) ||
    selectedDataset.files.find(
      (file: { stats?: { duplicate_of?: string }; duplicate_of?: string }) =>
        !file.stats?.duplicate_of && !file.duplicate_of,
    ) ||
    selectedDataset.files[0];
  const selectedSchema = selectedFile.schema_json || selectedFile.schema || [];
  expect(
    selectedSchema.length,
    'Catalog metadata should include detected schema columns',
  ).toBeGreaterThan(0);
  await expect(
    readiness.getByText('Local file', { exact: true }).locator('..').locator('dd'),
  ).toHaveText(selectedFile.path);
  await expect(
    readiness.getByText('Detected columns', { exact: true }).locator('..').locator('dd'),
  ).toHaveText(`${selectedSchema.length} columns`);
  if (typeof selectedFile.row_count === 'number') {
    const rowLabel =
      selectedFile.stats?.profile_scope === 'bounded_prefix'
        ? 'Profiled rows (bounded prefix)'
        : 'Detected rows';
    await expect(
      readiness.getByText(rowLabel, { exact: true }).locator('..').locator('dd'),
    ).toHaveText(selectedFile.row_count.toLocaleString('en-US'));
  }
  await expect(
    trainingForm.getByRole('button', { name: 'Queue training job', exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath('aegis-full-product-training-readiness.png'),
    fullPage: true,
    animations: 'disabled',
  });
  const untouched = await (
    await page.request.get(`/api/workspaces/${privateWorkspace}/bootstrap`)
  ).json();
  expect(untouched.training_jobs).toHaveLength(0);
  expect(untouched.models).toHaveLength(0);
  expect(untouched.jobs.filter((job: { kind: string }) => job.kind === 'training')).toHaveLength(0);
  expect(trainingSubmissions).toEqual([]);
  await readiness
    .getByRole('button', {
      name: `Configure task pipeline selected for ${selectedDataset.name}`,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Dataset Management', exact: true, level: 1 }),
  ).toBeVisible();
  const editor = page.locator('#dataset-editor');
  await expect(
    editor.getByRole('heading', { name: `Configure ${selectedDataset.name}`, exact: true }),
  ).toBeVisible();
  await expect(editor.getByRole('combobox', { name: 'Task pipeline', exact: true })).toHaveValue(
    'unassigned',
  );
  await editor
    .getByRole('combobox', { name: 'Task pipeline', exact: true })
    .selectOption('network');
  await editor.getByRole('button', { name: 'Save task & mapping', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Dataset task and provenance saved');
  const configured = await (
    await page.request.get(`/api/workspaces/${privateWorkspace}/datasets/${selectedDataset.id}`)
  ).json();
  expect(configured.task).toBe('network');
  expect(configured.license_status).toBe('unknown');
  expect(configured.mapping).toEqual({});
  await page.goto('/#/training');
  await expect(
    page.getByRole('heading', { name: 'Training Runs', exact: true, level: 1 }),
  ).toBeVisible();
  await page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'Create a training job', exact: true }) })
    .getByRole('combobox')
    .first()
    .selectOption(selectedDataset.id);
  await expect(
    page.locator('.readiness-list > div').filter({ hasText: 'Task pipeline selected' }),
  ).toContainText('Recorded');
  await expect(
    page.getByRole('button', { name: 'Queue training job', exact: true }),
  ).toBeDisabled();
  await expect(page.getByText('No training job exists yet.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'View all job history', exact: false }).click();
  await expect(
    page.getByRole('heading', { name: 'Background Jobs', exact: true, level: 1 }),
  ).toBeVisible();
  await page.goto('/#/assets');
  await expect(
    page.getByRole('heading', { name: 'Asset Inventory', exact: true, level: 1 }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add manual asset', exact: true }).click();
  const manualForm = page.getByRole('dialog', { name: 'Add manual asset', exact: true });
  const assetName = `manual-qa-${randomBytes(4).toString('hex')}`;
  await manualForm.getByRole('textbox', { name: 'Asset name', exact: true }).fill(assetName);
  await manualForm
    .getByRole('textbox', { name: 'Asset owner', exact: true })
    .fill('Private QA owner');
  await manualForm
    .getByRole('combobox', { name: 'Asset type', exact: true })
    .selectOption('Database');
  await manualForm
    .getByRole('textbox', { name: 'Address (optional)', exact: false })
    .fill('manual-review.example.invalid');
  await manualForm
    .getByRole('textbox', { name: 'Asset notes', exact: true })
    .fill('Manual metadata only. No network activity is authorized or performed.');
  await manualForm.getByRole('button', { name: 'Save manual asset', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(assetName);
  const manualState = await (
    await page.request.get(`/api/workspaces/${privateWorkspace}/bootstrap`)
  ).json();
  const persisted = manualState.assets.find((asset: { name: string }) => asset.name === assetName);
  expect(persisted.provenance).toBe('manual');
  expect(persisted.risk_score).toBe(0);
  expect(
    manualState.relationships.some(
      (relationship: { source_id: string; target_id: string }) =>
        relationship.source_id === persisted.id || relationship.target_id === persisted.id,
    ),
  ).toBe(false);
  expect(
    manualState.audit.some(
      (entry: { action: string; detail: string }) =>
        entry.action === 'Manual asset created' &&
        entry.detail.includes(assetName) &&
        entry.detail.includes('No scan'),
    ),
  ).toBe(true);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close details', exact: true })
    .click();
  await page.reload();
  await page.getByRole('textbox', { name: 'Search assets', exact: true }).fill(assetName);
  await expect(page.locator('table tbody')).toContainText(assetName);
  await page.goto('/#/members');
  await expect(
    page.getByRole('heading', { name: 'Members & Roles', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.locator('table tbody')).toContainText('New private analyst');
  await expect(page.locator('table tbody')).toContainText(session.user.email);
  const ownerSession = await login(page.request);
  const grant = await page.request.post(`/api/workspaces/${originalWorkspace}/members/existing`, {
    headers: { 'X-CSRF-Token': ownerSession.csrf_token },
    data: { email: session.user.email, role: 'Viewer' },
  });
  expect(grant.ok(), await grant.text()).toBeTruthy();
  const newLogin = await page.request.post('/api/auth/login', {
    data: { email: session.user.email, password },
  });
  expect(newLogin.ok()).toBeTruthy();
  const membership = (await newLogin.json()).workspaces.find(
    (workspace: { id: string }) => workspace.id === originalWorkspace,
  );
  expect(membership.role).toBe('Viewer');
});

test('local workspace guide saves useful history and deterministic workflow executions stay inspectable', async ({
  page,
}, testInfo) => {
  const auth = await login(page.request);
  const workspaceId = auth.workspaces[0].id;
  const provider = await (
    await page.request.get(`/api/workspaces/${workspaceId}/assistant/status`)
  ).json();
  expect(provider.configured, 'The isolated checks stack deliberately has no AI provider').toBe(
    false,
  );
  await page.goto('/#/assistant');
  await expect(
    page.getByRole('heading', { name: 'AI Assistant', exact: true, level: 1 }),
  ).toBeVisible();
  await page.getByRole('combobox', { name: 'Assistance mode', exact: true }).selectOption('guide');
  const question = `Summarize workspace risk. History verification ${randomBytes(4).toString('hex')}`;
  await page.getByRole('textbox', { name: 'Message the assistant', exact: true }).fill(question);
  const guideResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/api/workspaces/${workspaceId}/assistant/guide`,
  );
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const guideResponse = await guideResponsePromise;
  expect(guideResponse.ok(), await guideResponse.text()).toBe(true);
  const guide = await guideResponse.json();
  expect(guide.llm_used).toBe(false);
  expect(guide.provider).toBe('workspace_guide');
  expect(guide.conversation.workspace_id).toBe(workspaceId);
  await expect(page.locator('.chat-message.user')).toContainText(question);
  await expect(page.locator('.chat-message.assistant')).toContainText('Workspace guide');
  await expect(page.locator('.chat-message.assistant')).toContainText('fixed-template');
  const saved = await (
    await page.request.get(
      `/api/workspaces/${workspaceId}/assistant/conversations/${guide.conversation.id}`,
    )
  ).json();
  expect(saved.messages).toHaveLength(2);
  const answer = saved.messages.find((message: { role: string }) => message.role === 'assistant');
  expect(answer.content.startsWith('Workspace guide')).toBe(true);
  expect(answer.references.length).toBeGreaterThan(0);
  for (const reference of answer.references) {
    const record = await page.request.get(
      `/api/workspaces/${workspaceId}/${reference.record_type}/${reference.id}`,
    );
    expect(
      record.ok(),
      `Guide reference ${reference.record_type}/${reference.id} belongs to the current workspace`,
    ).toBe(true);
    expect((await record.json()).workspace_id).toBe(workspaceId);
  }
  await page.reload();
  await page.goto('/#/conversations');
  await expect(
    page.getByRole('heading', { name: 'Conversation History', exact: true, level: 1 }),
  ).toBeVisible();
  await page
    .locator('.conversation-list')
    .getByRole('button')
    .filter({ hasText: question })
    .click();
  await expect(page.locator('.chat-message.user')).toContainText(question);
  await expect(page.locator('.chat-message.assistant')).toContainText(answer.content);
  await expect(page.getByRole('combobox', { name: 'Assistance mode', exact: true })).toHaveValue(
    'guide',
  );
  await page.screenshot({
    path: testInfo.outputPath('aegis-workspace-guide-history.png'),
    fullPage: true,
    animations: 'disabled',
  });
  const firstReference = answer.references[0];
  await page
    .locator('.chat-message.assistant .reference-chips')
    .getByRole('button')
    .first()
    .click();
  await expect(page.getByRole('dialog')).toContainText(firstReference.id);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close details', exact: true })
    .click();
  await page.goto('/#/agents');
  await expect(
    page.getByRole('heading', { name: 'Agent Center', exact: true, level: 1 }),
  ).toBeVisible();
  const executionResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.includes(`/api/workspaces/${workspaceId}/agents/`) &&
      new URL(response.url()).pathname.endsWith('/run'),
  );
  await page
    .getByRole('button', { name: 'Run deterministic workflow', exact: true })
    .filter({ visible: true })
    .first()
    .click();
  const executionResponse = await executionResponsePromise;
  expect(executionResponse.ok(), await executionResponse.text()).toBe(true);
  const execution = await executionResponse.json();
  expect(execution.status).toBe('succeeded');
  expect(
    execution.steps.some((step: { step: string }) =>
      step.step.includes('no LLM or external action'),
    ),
  ).toBe(true);
  await expect(page.getByRole('dialog')).toContainText(execution.id);
  await expect(page.getByRole('dialog')).toContainText('no LLM or external action');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close details', exact: true })
    .click();
  await page.reload();
  await expect(page.locator('table tbody')).toContainText(execution.id);
  await page.getByRole('button', { name: `Open ${execution.id}`, exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(execution.id);
});
