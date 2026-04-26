/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * formulaParser.test.ts
 * =====================
 * Tests for the formula parser — the critical bridge between:
 *   - What the user types in the formula bar
 *   - What gets sent to the backend engine as operation_id + config
 *   - What gets saved to / loaded from pipeline JSON files
 *
 * These tests mirror the Python-side tests in test_formula_alignment.py
 * to ensure both sides of the boundary agree on the formula contract.
 */

import { describe, it, expect } from 'vitest';
import { parseFormula, buildFormula } from './formulaParser';
import type { OrchestrationMode } from './formulaParser';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. parseFormula — Parsing formula strings into structured data
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseFormula', () => {
  describe('basic parsing', () => {
    it('parses empty string as invalid', () => {
      const result = parseFormula('');
      expect(result.isValid).toBe(false);
      expect(result.operationId).toBeNull();
    });

    it('parses string without = prefix as invalid', () => {
      const result = parseFormula('fetch_videos(channel_url="test")');
      expect(result.isValid).toBe(false);
      expect(result.operationId).toBeNull();
    });

    it('parses incomplete formula (no parenthesis) as invalid', () => {
      const result = parseFormula('=fetch_videos');
      expect(result.isValid).toBe(false);
      expect(result.operationId).not.toBeNull(); // partial parse OK
    });

    it('parses incomplete formula (no closing paren) as invalid', () => {
      const result = parseFormula('=fetch_videos(channel_url="test"');
      expect(result.isValid).toBe(false);
      expect(result.operationId).toBe('fetch_videos');
      expect(result.args['channel_url']).toBe('test');
    });
  });

  describe('source operations', () => {
    it('parses source formula with orchestration modifier', () => {
      const result = parseFormula('=fetch_videos.source(channel_url="https://test.com")');
      expect(result.isValid).toBe(true);
      expect(result.operationId).toBe('fetch_videos');
      expect(result.orchestration).toBe('source');
      expect(result.args['channel_url']).toBe('https://test.com');
    });

    it('parses source formula without orchestration modifier', () => {
      const result = parseFormula('=fetch_videos(channel_url="https://test.com")');
      expect(result.isValid).toBe(true);
      expect(result.operationId).toBe('fetch_videos');
      expect(result.orchestration).toBeNull(); // no modifier — uses registered default
      expect(result.args['channel_url']).toBe('https://test.com');
    });
  });

  describe('map operations', () => {
    it('parses map formula with step reference', () => {
      const result = parseFormula('=extract_metadata.map(url=step1.url)');
      expect(result.isValid).toBe(true);
      expect(result.operationId).toBe('extract_metadata');
      expect(result.orchestration).toBe('map');
      expect(result.args['url']).toBe('step1.url');
    });
  });

  describe('filter operations', () => {
    it('parses filter formula with numeric arg', () => {
      const result = parseFormula('=is_popular.filter(views=step2.views, min_views=1000)');
      expect(result.isValid).toBe(true);
      expect(result.operationId).toBe('is_popular');
      expect(result.orchestration).toBe('filter');
      expect(result.args['views']).toBe('step2.views');
      expect(result.args['min_views']).toBe('1000');
    });
  });

  describe('dataframe operations', () => {
    it('parses dataframe formula with no args', () => {
      const result = parseFormula('=analyze_sentiment.dataframe()');
      expect(result.isValid).toBe(true);
      expect(result.operationId).toBe('analyze_sentiment');
      expect(result.orchestration).toBe('dataframe');
      expect(Object.keys(result.args)).toHaveLength(0);
    });
  });

  describe('argument edge cases', () => {
    it('handles quoted strings with commas inside', () => {
      const result = parseFormula('=my_op(text="hello, world")');
      expect(result.isValid).toBe(true);
      expect(result.args['text']).toBe('hello, world');
    });

    it('handles single-quoted strings', () => {
      const result = parseFormula("=my_op(text='hello')");
      expect(result.isValid).toBe(true);
      expect(result.args['text']).toBe('hello');
    });

    it('handles unquoted step references as arg values', () => {
      const result = parseFormula('=my_op(col=step1.column_name)');
      expect(result.isValid).toBe(true);
      expect(result.args['col']).toBe('step1.column_name');
    });

    it('handles multiple args', () => {
      const result = parseFormula('=my_op(a="1", b="2", c="3")');
      expect(result.isValid).toBe(true);
      expect(result.args['a']).toBe('1');
      expect(result.args['b']).toBe('2');
      expect(result.args['c']).toBe('3');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. buildFormula — Building formula strings from operation_id + config
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildFormula', () => {
  it('builds source formula', () => {
    const formula = buildFormula('fetch_videos', { channel_url: 'https://test.com' }, 'source');
    expect(formula).toBe('=fetch_videos.source(channel_url="https://test.com")');
  });

  it('builds map formula with step reference (unquoted)', () => {
    const formula = buildFormula('extract_metadata', { url: 'step1.url' }, 'map');
    // Step references are still strings so they get quoted by buildFormula
    // This is a known design choice — the engine resolves them
    expect(formula).toContain('extract_metadata');
    expect(formula).toContain('.map(');
    expect(formula).toContain('url=');
  });

  it('builds formula without orchestration modifier when null', () => {
    const formula = buildFormula('my_op', { key: 'value' }, null);
    expect(formula).toBe('=my_op(key="value")');
    expect(formula).not.toContain('.null');
  });

  it('returns empty string for noop', () => {
    const formula = buildFormula('noop', {}, null);
    expect(formula).toBe('');
  });

  it('returns ref string for passthrough', () => {
    const formula = buildFormula('passthrough', { _ref: 'step1.column' }, null);
    expect(formula).toBe('step1.column');
  });

  it('strips _-prefixed internal keys from args', () => {
    const formula = buildFormula('my_op', {
      channel_url: 'https://test.com',
      _orchestrator: 'source',
      _ref: 'something',
    }, 'source');
    expect(formula).not.toContain('_orchestrator');
    expect(formula).not.toContain('_ref');
    expect(formula).toContain('channel_url');
  });

  it('uses _orchestrator from config as fallback when orchestration arg is undefined', () => {
    const formula = buildFormula('my_op', {
      channel_url: 'test',
      _orchestrator: 'source',
    } as any);
    expect(formula).toContain('.source(');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Round-trip: buildFormula → parseFormula → same operation_id + args
// ═══════════════════════════════════════════════════════════════════════════════

describe('Formula round-trip', () => {
  const testCases: Array<{
    name: string;
    operationId: string;
    config: Record<string, any>;
    orchestration: OrchestrationMode | null;
  }> = [
    {
      name: 'source with URL',
      operationId: 'fetch_videos',
      config: { channel_url: 'https://example.com' },
      orchestration: 'source',
    },
    {
      name: 'map with column ref',
      operationId: 'extract_metadata',
      config: { url: 'step1.url' },
      orchestration: 'map',
    },
    {
      name: 'filter with numbers',
      operationId: 'is_popular',
      config: { min_views: '1000' },
      orchestration: 'filter',
    },
    {
      name: 'dataframe with no args',
      operationId: 'analyze_sentiment',
      config: {},
      orchestration: 'dataframe',
    },
    {
      name: 'no orchestration modifier',
      operationId: 'my_custom_op',
      config: { key: 'value' },
      orchestration: null,
    },
  ];

  testCases.forEach(({ name, operationId, config, orchestration }) => {
    it(`round-trips correctly: ${name}`, () => {
      const formula = buildFormula(operationId, config, orchestration);
      const parsed = parseFormula(formula);

      expect(parsed.isValid).toBe(true);
      expect(parsed.operationId).toBe(operationId);
      expect(parsed.orchestration).toBe(orchestration);

      // All config keys (non-internal) should survive the round-trip
      for (const [key, value] of Object.entries(config)) {
        if (key.startsWith('_')) continue;
        expect(parsed.args[key]).toBe(String(value));
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Pipeline JSON hydration — simulating hydrateStep from useWorkflow.ts
// ═══════════════════════════════════════════════════════════════════════════════

describe('Pipeline JSON hydration', () => {
  /**
   * Simulate hydrateStep: given a pipeline step config (as stored in JSON),
   * derive the formula that should appear in the formula bar.
   */
  function simulateHydrate(stepConfig: {
    step_id: string;
    operation_id: string;
    label: string;
    config: Record<string, any>;
    formula?: string;
  }) {
    const savedFormula = stepConfig.formula ?? '';
    const parsed = savedFormula ? parseFormula(savedFormula) : null;

    const processType =
      parsed?.isValid && parsed.operationId
        ? parsed.operationId
        : stepConfig.operation_id ?? 'noop';

    const formulaArgs = parsed?.isValid && parsed.args ? parsed.args : {};

    const internalKeys = Object.fromEntries(
      Object.entries(stepConfig.config ?? {}).filter(([k]) => k.startsWith('_'))
    );

    const legacyConfig =
      parsed?.isValid && Object.keys(formulaArgs).length > 0
        ? {}
        : Object.fromEntries(
            Object.entries(stepConfig.config ?? {}).filter(([k]) => !k.startsWith('_'))
          );

    const configuration = { ...internalKeys, ...legacyConfig, ...formulaArgs };

    const formula =
      savedFormula ||
      buildFormula(
        processType,
        configuration,
        (internalKeys._orchestrator as OrchestrationMode) ?? null
      );

    return { processType, configuration, formula };
  }

  it('hydrates step WITH saved formula correctly', () => {
    const result = simulateHydrate({
      step_id: 'step-001',
      operation_id: 'fetch_videos',
      label: 'Step 1',
      config: { channel_url: 'https://test.com', _orchestrator: 'source' },
      formula: '=fetch_videos.source(channel_url="https://test.com")',
    });

    expect(result.formula).toBe('=fetch_videos.source(channel_url="https://test.com")');
    expect(result.processType).toBe('fetch_videos');
    expect(result.configuration['channel_url']).toBe('https://test.com');
  });

  it('hydrates step WITHOUT saved formula — reconstructs from legacy fields', () => {
    const result = simulateHydrate({
      step_id: 'step-001',
      operation_id: 'fetch_videos',
      label: 'Step 1',
      config: { channel_url: 'https://test.com', _orchestrator: 'source' },
      // NO formula field — old save format
    });

    expect(result.formula).not.toBe('');
    expect(result.formula).toContain('fetch_videos');
    expect(result.formula).toContain('channel_url');
    expect(result.formula).toContain('source');
    expect(result.processType).toBe('fetch_videos');
  });

  it('reconstructed formula is parseable and produces correct operation_id', () => {
    const result = simulateHydrate({
      step_id: 'step-001',
      operation_id: 'extract_metadata',
      label: 'Step 2',
      config: { url: 'Step1', _orchestrator: 'map' },
    });

    const reparsed = parseFormula(result.formula);
    expect(reparsed.isValid).toBe(true);
    expect(reparsed.operationId).toBe('extract_metadata');
    expect(reparsed.orchestration).toBe('map');
  });

  it('hydrated noop step produces empty/noop formula', () => {
    const result = simulateHydrate({
      step_id: 'step-003',
      operation_id: 'noop',
      label: 'Empty Step',
      config: {},
    });

    expect(result.processType).toBe('noop');
    expect(result.formula).toBe('');
  });

  it('matches real pipeline JSON from sample-youtube-mock-analysis', () => {
    // This is the actual data from new-pipeline-sample-example1.json
    // It has NO formula field — the exact bug scenario
    const step = {
      step_id: 'step-02iqkl5',
      operation_id: 'yt_fetch_videos',
      label: 'Step 0',
      config: {
        channel_url: 'https://youtube.com/mock_channel',
        _orchestrator: 'source',
      },
      // NOTE: no formula field!
    };

    const result = simulateHydrate(step);

    // The formula bar MUST show the operation + args, not just "Step 0"
    expect(result.formula).toContain('yt_fetch_videos');
    expect(result.formula).toContain('channel_url');
    expect(result.formula).toContain('source');
    expect(result.formula).not.toBe('');

    // It must be parseable back to the correct operation
    const parsed = parseFormula(result.formula);
    expect(parsed.operationId).toBe('yt_fetch_videos');
    expect(parsed.args['channel_url']).toBe('https://youtube.com/mock_channel');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Formula → API payload alignment
// ═══════════════════════════════════════════════════════════════════════════════

describe('Formula to API payload', () => {
  /**
   * Simulate what happens when the user types a formula and clicks Run:
   * formula → parseFormula → { operation_id, config } → POST /api/run
   */
  function formulaToApiPayload(formula: string) {
    const parsed = parseFormula(formula);
    if (!parsed.isValid || !parsed.operationId) return null;

    const config: Record<string, any> = { ...parsed.args };
    if (parsed.orchestration) {
      config['_orchestrator'] = parsed.orchestration;
    }

    return {
      step_id: 'test-step',
      operation_id: parsed.operationId,
      config,
      input_ref_id: null,
      step_map: {},
    };
  }

  it('produces correct API payload for source operation', () => {
    const payload = formulaToApiPayload('=fetch_videos.source(channel_url="https://test.com")');
    expect(payload).not.toBeNull();
    expect(payload!.operation_id).toBe('fetch_videos');
    expect(payload!.config.channel_url).toBe('https://test.com');
    expect(payload!.config._orchestrator).toBe('source');
  });

  it('produces correct API payload for map operation', () => {
    const payload = formulaToApiPayload('=extract_metadata.map(url=step1.url)');
    expect(payload).not.toBeNull();
    expect(payload!.operation_id).toBe('extract_metadata');
    expect(payload!.config.url).toBe('step1.url');
    expect(payload!.config._orchestrator).toBe('map');
  });

  it('produces correct API payload without orchestration modifier', () => {
    const payload = formulaToApiPayload('=my_op(key="value")');
    expect(payload).not.toBeNull();
    expect(payload!.operation_id).toBe('my_op');
    expect(payload!.config.key).toBe('value');
    expect(payload!.config._orchestrator).toBeUndefined();
  });

  it('returns null for invalid formula', () => {
    expect(formulaToApiPayload('')).toBeNull();
    expect(formulaToApiPayload('not a formula')).toBeNull();
    expect(formulaToApiPayload('=incomplete')).toBeNull();
  });
});
