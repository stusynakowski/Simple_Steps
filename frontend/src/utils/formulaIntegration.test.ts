/**
 * formulaIntegration.test.ts
 * ===========================
 * Integration tests for the formula bar ↔ UI ↔ backend contract.
 *
 * These tests verify the CRITICAL integration between:
 *   1. Loading a workflow → formula bar shows the correct formula
 *   2. Formula bar ↔ details-tab UI bidirectional sync
 *   3. Save/load round-trip preserves formulas, operation_id, and config
 *   4. Step references remain unquoted in formulas and resolve correctly
 *   5. The formula is the canonical source of truth at every stage
 *
 * The formula bar syntax mirrors Python decorated function calls:
 *   =operation_id.orchestration_mode(arg1="value", arg2=step1.col)
 *
 * Think of it like LangGraph/MCP tool decorators — the formula bar is how
 * the user "calls" a registered backend function.
 */

import { describe, it, expect } from 'vitest';
import {
  parseFormula,
  buildFormula,
  isStepReference,
  formatFormulaValue,
} from './formulaParser';
import type { OrchestrationMode } from './formulaParser';

// ═══════════════════════════════════════════════════════════════════════════════
// Helper: simulate hydrateStep (from useWorkflow.ts)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Mirrors the hydrateStep function from useWorkflow.ts.
 * Given a saved pipeline step config (JSON on disk), produce the runtime Step
 * that drives the formula bar, details tab, and execution.
 */
function hydrateStep(s: {
  step_id: string;
  operation_id: string;
  label: string;
  config: Record<string, any>;
  formula?: string;
}, i: number) {
  const savedFormula = s.formula ?? '';
  const parsed = savedFormula ? parseFormula(savedFormula) : null;
  const formulaIsUsable = parsed?.isValid && !!parsed.operationId;

  const processType = formulaIsUsable
    ? parsed!.operationId!
    : (s.operation_id ?? 'noop');

  const formulaArgs = formulaIsUsable ? (parsed!.args ?? {}) : {};

  const internalKeys = Object.fromEntries(
    Object.entries(s.config ?? {}).filter(([k]) => k.startsWith('_'))
  );

  const legacyConfig = (formulaIsUsable && Object.keys(formulaArgs).length > 0)
    ? {}
    : Object.fromEntries(
        Object.entries(s.config ?? {}).filter(([k]) => !k.startsWith('_'))
      );

  const configuration = { ...internalKeys, ...legacyConfig, ...formulaArgs };

  const formula = formulaIsUsable
    ? savedFormula
    : buildFormula(processType, configuration,
        (internalKeys._orchestrator as OrchestrationMode) ?? null,
      );

  return {
    id: s.step_id,
    sequence_index: i,
    label: s.label || `Step ${i + 1}`,
    formula,
    process_type: processType,
    configuration,
    operation: formula,  // legacy field kept in sync
  };
}

/**
 * Simulate handleFormulaUpdate from OperationColumn.tsx.
 * User types/edits formula → derive process_type + configuration.
 */
function simulateFormulaUpdate(
  currentStep: { configuration: Record<string, any> },
  formula: string,
): { formula: string; operation: string; process_type?: string; configuration?: Record<string, any> } {
  const parsed = parseFormula(formula);
  if (parsed.isValid && parsed.operationId) {
    const internalKeys = Object.fromEntries(
      Object.entries(currentStep.configuration).filter(([k]) => k.startsWith('_'))
    );
    const orchConfig = parsed.orchestration
      ? { ...internalKeys, _orchestrator: parsed.orchestration, ...parsed.args }
      : { ...internalKeys, ...parsed.args };
    return {
      formula,
      operation: formula,
      process_type: parsed.operationId,
      configuration: orchConfig,
    };
  }
  return { formula, operation: formula };
}

/**
 * Simulate handleUiUpdate from OperationColumn.tsx.
 * User changes operation dropdown or parameter in the details tab →
 * rebuild the formula and update everything.
 */
function simulateUiUpdate(
  currentStep: {
    process_type: string;
    configuration: Record<string, any>;
    formula: string;
  },
  updates: { process_type?: string; configuration?: Record<string, any> },
) {
  const newOpId = updates.process_type ?? currentStep.process_type;
  const newConfig = updates.configuration ?? currentStep.configuration;
  const existingParsed = currentStep.formula ? parseFormula(currentStep.formula) : null;
  const orchMode = (newConfig._orchestrator as OrchestrationMode | undefined)
    ?? existingParsed?.orchestration
    ?? null;
  const newFormula = buildFormula(newOpId, newConfig, orchMode);
  return {
    formula: newFormula,
    operation: newFormula,
    process_type: newOpId,
    configuration: newConfig,
  };
}

/**
 * Simulate saving a step to pipeline JSON and loading it back.
 */
function roundTripStep(step: {
  id: string;
  process_type: string;
  label: string;
  configuration: Record<string, any>;
  formula: string;
}) {
  // Save
  const saved = {
    step_id: step.id,
    operation_id: step.process_type,
    label: step.label,
    config: step.configuration,
    formula: step.formula,
  };
  // Load
  return hydrateStep(saved, 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. isStepReference — identifies step reference tokens
// ═══════════════════════════════════════════════════════════════════════════════

describe('isStepReference', () => {
  it('recognizes positional step references', () => {
    expect(isStepReference('step1.url')).toBe(true);
    expect(isStepReference('step2.views')).toBe(true);
    expect(isStepReference('step10.column_name')).toBe(true);
  });

  it('recognizes step-ID references', () => {
    expect(isStepReference('step-02iqkl5.url')).toBe(true);
    expect(isStepReference('step-abc123.column')).toBe(true);
  });

  it('rejects non-step-reference strings', () => {
    expect(isStepReference('https://example.com')).toBe(false);
    expect(isStepReference('hello world')).toBe(false);
    expect(isStepReference('just_a_word')).toBe(false);
    expect(isStepReference(42)).toBe(false);
    expect(isStepReference(null)).toBe(false);
    expect(isStepReference('')).toBe(false);
  });

  it('rejects URL-like strings with dots', () => {
    expect(isStepReference('www.example.com')).toBe(false);
    expect(isStepReference('file.txt')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. formatFormulaValue — correct quoting rules
// ═══════════════════════════════════════════════════════════════════════════════

describe('formatFormulaValue', () => {
  it('leaves step references unquoted', () => {
    expect(formatFormulaValue('step1.url')).toBe('step1.url');
    expect(formatFormulaValue('step-abc.column')).toBe('step-abc.column');
  });

  it('leaves numbers unquoted', () => {
    expect(formatFormulaValue(42)).toBe('42');
    expect(formatFormulaValue(3.14)).toBe('3.14');
    expect(formatFormulaValue('1000')).toBe('1000');
  });

  it('leaves booleans unquoted', () => {
    expect(formatFormulaValue(true)).toBe('true');
    expect(formatFormulaValue(false)).toBe('false');
  });

  it('quotes regular strings', () => {
    expect(formatFormulaValue('https://example.com')).toBe('"https://example.com"');
    expect(formatFormulaValue('hello world')).toBe('"hello world"');
    expect(formatFormulaValue('some_value')).toBe('"some_value"');
  });

  it('handles null/undefined', () => {
    expect(formatFormulaValue(null)).toBe('');
    expect(formatFormulaValue(undefined)).toBe('');
  });

  it('passes through formula references (starting with =)', () => {
    expect(formatFormulaValue('=other_op()')).toBe('=other_op()');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. buildFormula — step references are NOT quoted
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildFormula step reference handling', () => {
  it('does NOT quote step references in formula output', () => {
    const formula = buildFormula('extract_metadata', { url: 'step1.url' }, 'map');
    expect(formula).toBe('=extract_metadata.map(url=step1.url)');
    // This is critical: step1.url must NOT be "step1.url"
    expect(formula).not.toContain('"step1');
  });

  it('quotes regular string values', () => {
    const formula = buildFormula('fetch_videos', { channel_url: 'https://test.com' }, 'source');
    expect(formula).toBe('=fetch_videos.source(channel_url="https://test.com")');
  });

  it('mixes quoted and unquoted args correctly', () => {
    const formula = buildFormula('my_op', {
      url: 'step1.url',
      channel_url: 'https://example.com',
      min_views: 1000,
    }, 'map');
    expect(formula).toContain('url=step1.url');
    expect(formula).toContain('channel_url="https://example.com"');
    expect(formula).toContain('min_views=1000');
  });

  it('handles step-ID references with hyphens', () => {
    const formula = buildFormula('my_op', { col: 'step-abc123.views' }, 'map');
    expect(formula).toBe('=my_op.map(col=step-abc123.views)');
    expect(formula).not.toContain('"step-abc123');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Round-trip with step references — buildFormula → parseFormula
// ═══════════════════════════════════════════════════════════════════════════════

describe('Step reference round-trip', () => {
  it('step reference survives build→parse round-trip', () => {
    const formula = buildFormula('extract_metadata', { url: 'step1.url' }, 'map');
    const parsed = parseFormula(formula);
    expect(parsed.isValid).toBe(true);
    expect(parsed.operationId).toBe('extract_metadata');
    expect(parsed.orchestration).toBe('map');
    expect(parsed.args['url']).toBe('step1.url');
  });

  it('mixed step references and strings survive round-trip', () => {
    const config = {
      url: 'step1.url',
      output_name: 'my_results',
      min_views: '500',
    };
    const formula = buildFormula('my_op', config, 'map');
    const parsed = parseFormula(formula);
    expect(parsed.isValid).toBe(true);
    expect(parsed.args['url']).toBe('step1.url');
    expect(parsed.args['output_name']).toBe('my_results');
    expect(parsed.args['min_views']).toBe('500');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Workflow loading → formula bar shows correct formula
// ═══════════════════════════════════════════════════════════════════════════════

describe('Workflow loading (hydrateStep)', () => {
  it('loads step with saved formula — formula bar shows the saved formula', () => {
    const step = hydrateStep({
      step_id: 'step-001',
      operation_id: 'yt_fetch_videos',
      label: 'Fetch Videos',
      config: {
        channel_url: 'https://youtube.com/mock_channel',
        _orchestrator: 'source',
      },
      formula: '=yt_fetch_videos.source(channel_url="https://youtube.com/mock_channel")',
    }, 0);

    expect(step.formula).toBe('=yt_fetch_videos.source(channel_url="https://youtube.com/mock_channel")');
    expect(step.process_type).toBe('yt_fetch_videos');
    expect(step.configuration['channel_url']).toBe('https://youtube.com/mock_channel');
    expect(step.configuration['_orchestrator']).toBe('source');
  });

  it('loads step WITHOUT formula — reconstructs from operation_id + config', () => {
    const step = hydrateStep({
      step_id: 'step-001',
      operation_id: 'yt_fetch_videos',
      label: 'Fetch Videos',
      config: {
        channel_url: 'https://youtube.com/mock_channel',
        _orchestrator: 'source',
      },
      // No formula field — old save format
    }, 0);

    // Formula bar MUST show the complete formula, not just the step name
    expect(step.formula).toContain('yt_fetch_videos');
    expect(step.formula).toContain('.source');
    expect(step.formula).toContain('channel_url');
    expect(step.process_type).toBe('yt_fetch_videos');
    expect(step.configuration['channel_url']).toBe('https://youtube.com/mock_channel');

    // The reconstructed formula must be parseable
    const reparsed = parseFormula(step.formula);
    expect(reparsed.isValid).toBe(true);
    expect(reparsed.operationId).toBe('yt_fetch_videos');
    expect(reparsed.orchestration).toBe('source');
  });

  it('loads step with step-reference arguments — formula shows unquoted refs', () => {
    const step = hydrateStep({
      step_id: 'step-002',
      operation_id: 'extract_metadata',
      label: 'Extract Metadata',
      config: {
        url: 'step1.url',
        _orchestrator: 'map',
      },
      formula: '=extract_metadata.map(url=step1.url)',
    }, 1);

    // Formula bar should show unquoted step reference
    expect(step.formula).toBe('=extract_metadata.map(url=step1.url)');
    expect(step.process_type).toBe('extract_metadata');
    expect(step.configuration['url']).toBe('step1.url');
    expect(step.configuration['_orchestrator']).toBe('map');
  });

  it('loads step with NO formula and step-reference args — reconstructs correctly', () => {
    const step = hydrateStep({
      step_id: 'step-002',
      operation_id: 'extract_metadata',
      label: 'Extract Metadata',
      config: {
        url: 'step1.url',
        _orchestrator: 'map',
      },
      // No formula field
    }, 1);

    // Reconstructed formula should have unquoted step reference
    expect(step.formula).toContain('extract_metadata');
    expect(step.formula).toContain('.map');
    expect(step.formula).toContain('url=step1.url');
    expect(step.formula).not.toContain('"step1.url"');
    expect(step.process_type).toBe('extract_metadata');
  });

  it('loads noop step — empty formula, process_type is noop', () => {
    const step = hydrateStep({
      step_id: 'step-003',
      operation_id: 'noop',
      label: 'Empty Step',
      config: {},
    }, 2);

    expect(step.formula).toBe('');
    expect(step.process_type).toBe('noop');
  });

  it('loads a multi-step pipeline — all formulas populated correctly', () => {
    const pipelineSteps = [
      {
        step_id: 'step-001',
        operation_id: 'yt_fetch_videos',
        label: 'Fetch Videos',
        config: { channel_url: 'https://youtube.com/@TestChannel', _orchestrator: 'source' },
        formula: '=yt_fetch_videos.source(channel_url="https://youtube.com/@TestChannel")',
      },
      {
        step_id: 'step-002',
        operation_id: 'yt_extract_metadata',
        label: 'Extract Metadata',
        config: { url: 'step1.url', _orchestrator: 'map' },
        formula: '=yt_extract_metadata.map(url=step1.url)',
      },
      {
        step_id: 'step-003',
        operation_id: 'is_popular',
        label: 'Filter Popular',
        config: { views: 'step2.views', min_views: '1000', _orchestrator: 'filter' },
        formula: '=is_popular.filter(views=step2.views, min_views=1000)',
      },
    ];

    const hydrated = pipelineSteps.map(hydrateStep);

    // Step 0: source
    expect(hydrated[0].formula).toContain('yt_fetch_videos');
    expect(hydrated[0].process_type).toBe('yt_fetch_videos');

    // Step 1: map with step reference
    expect(hydrated[1].formula).toContain('url=step1.url');
    expect(hydrated[1].process_type).toBe('yt_extract_metadata');
    expect(hydrated[1].configuration['url']).toBe('step1.url');

    // Step 2: filter with step reference and numeric arg
    expect(hydrated[2].formula).toContain('views=step2.views');
    expect(hydrated[2].formula).toContain('min_views=1000');
    expect(hydrated[2].process_type).toBe('is_popular');
    expect(hydrated[2].configuration['views']).toBe('step2.views');
    expect(hydrated[2].configuration['min_views']).toBe('1000');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Formula bar → UI sync (typing in formula bar updates details tab)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Formula bar → UI details tab sync', () => {
  it('typing a complete formula populates process_type and configuration', () => {
    const currentStep = { configuration: {} };
    const result = simulateFormulaUpdate(
      currentStep,
      '=fetch_videos.source(channel_url="https://test.com")',
    );

    expect(result.process_type).toBe('fetch_videos');
    expect(result.configuration!['channel_url']).toBe('https://test.com');
    expect(result.configuration!['_orchestrator']).toBe('source');
    expect(result.formula).toBe('=fetch_videos.source(channel_url="https://test.com")');
  });

  it('typing formula with step reference populates config correctly', () => {
    const currentStep = { configuration: {} };
    const result = simulateFormulaUpdate(
      currentStep,
      '=extract_metadata.map(url=step1.url)',
    );

    expect(result.process_type).toBe('extract_metadata');
    expect(result.configuration!['url']).toBe('step1.url');
    expect(result.configuration!['_orchestrator']).toBe('map');
  });

  it('typing formula WITHOUT orchestration modifier — no _orchestrator in config', () => {
    const currentStep = { configuration: {} };
    const result = simulateFormulaUpdate(
      currentStep,
      '=my_op(key="value")',
    );

    expect(result.process_type).toBe('my_op');
    expect(result.configuration!['key']).toBe('value');
    expect(result.configuration!['_orchestrator']).toBeUndefined();
  });

  it('preserves existing _-prefixed internal keys in config', () => {
    const currentStep = { configuration: { _orchestrator: 'source', _custom: 'keep_me' } };
    const result = simulateFormulaUpdate(
      currentStep,
      '=new_op.map(arg="val")',
    );

    // _orchestrator is REPLACED by what's in the formula
    expect(result.configuration!['_orchestrator']).toBe('map');
    // Other internal keys are preserved
    expect(result.configuration!['_custom']).toBe('keep_me');
    expect(result.configuration!['arg']).toBe('val');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. UI details tab → Formula bar sync (changing params updates formula)
// ═══════════════════════════════════════════════════════════════════════════════

describe('UI details tab → Formula bar sync', () => {
  it('changing a parameter in the UI rebuilds the formula', () => {
    const currentStep = {
      process_type: 'fetch_videos',
      configuration: { channel_url: 'https://old.com', _orchestrator: 'source' },
      formula: '=fetch_videos.source(channel_url="https://old.com")',
    };

    const result = simulateUiUpdate(currentStep, {
      configuration: { channel_url: 'https://new.com', _orchestrator: 'source' },
    });

    expect(result.formula).toBe('=fetch_videos.source(channel_url="https://new.com")');
    expect(result.process_type).toBe('fetch_videos');
  });

  it('changing the operation in the UI rebuilds the formula', () => {
    const currentStep = {
      process_type: 'old_op',
      configuration: { key: 'value' },
      formula: '=old_op(key="value")',
    };

    const result = simulateUiUpdate(currentStep, {
      process_type: 'new_op',
      configuration: {},
    });

    expect(result.formula).toBe('=new_op()');
    expect(result.process_type).toBe('new_op');
  });

  it('changing a parameter to a step reference — formula shows unquoted ref', () => {
    const currentStep = {
      process_type: 'extract_metadata',
      configuration: { url: 'manual_value', _orchestrator: 'map' },
      formula: '=extract_metadata.map(url="manual_value")',
    };

    const result = simulateUiUpdate(currentStep, {
      configuration: { url: 'step1.url', _orchestrator: 'map' },
    });

    // The formula must NOT quote step references
    expect(result.formula).toBe('=extract_metadata.map(url=step1.url)');
    expect(result.formula).not.toContain('"step1.url"');
  });

  it('changing orchestration mode rebuilds formula with new modifier', () => {
    const currentStep = {
      process_type: 'my_op',
      configuration: { key: 'value', _orchestrator: 'map' },
      formula: '=my_op.map(key="value")',
    };

    const result = simulateUiUpdate(currentStep, {
      configuration: { key: 'value', _orchestrator: 'dataframe' },
    });

    expect(result.formula).toBe('=my_op.dataframe(key="value")');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Full bidirectional round-trip: formula bar → UI → formula bar
// ═══════════════════════════════════════════════════════════════════════════════

describe('Bidirectional formula ↔ UI round-trip', () => {
  it('formula → config → formula produces identical formula', () => {
    const originalFormula = '=fetch_videos.source(channel_url="https://test.com")';

    // Step 1: User types formula → derives config
    const afterFormula = simulateFormulaUpdate({ configuration: {} }, originalFormula);

    // Step 2: Re-derive formula from the config (as if UI triggered an update)
    const rebuilt = simulateUiUpdate(
      {
        process_type: afterFormula.process_type!,
        configuration: afterFormula.configuration!,
        formula: afterFormula.formula,
      },
      { configuration: afterFormula.configuration },
    );

    expect(rebuilt.formula).toBe(originalFormula);
  });

  it('formula with step ref → config → formula preserves unquoted ref', () => {
    const originalFormula = '=extract_metadata.map(url=step1.url)';

    // Step 1: User types formula
    const afterFormula = simulateFormulaUpdate({ configuration: {} }, originalFormula);
    expect(afterFormula.configuration!['url']).toBe('step1.url');

    // Step 2: Re-derive formula from config
    const rebuilt = simulateUiUpdate(
      {
        process_type: afterFormula.process_type!,
        configuration: afterFormula.configuration!,
        formula: afterFormula.formula,
      },
      { configuration: afterFormula.configuration },
    );

    expect(rebuilt.formula).toBe(originalFormula);
    expect(rebuilt.formula).not.toContain('"step1.url"');
  });

  it('formula with mixed args → config → formula round-trips correctly', () => {
    const originalFormula = '=my_op.filter(views=step2.views, min_views=1000, output="results")';

    const afterFormula = simulateFormulaUpdate({ configuration: {} }, originalFormula);
    expect(afterFormula.configuration!['views']).toBe('step2.views');
    expect(afterFormula.configuration!['min_views']).toBe('1000');
    expect(afterFormula.configuration!['output']).toBe('results');

    const rebuilt = simulateUiUpdate(
      {
        process_type: afterFormula.process_type!,
        configuration: afterFormula.configuration!,
        formula: afterFormula.formula,
      },
      { configuration: afterFormula.configuration },
    );

    // Parse both to compare semantically (arg order may differ)
    const parsedOriginal = parseFormula(originalFormula);
    const parsedRebuilt = parseFormula(rebuilt.formula);
    expect(parsedRebuilt.operationId).toBe(parsedOriginal.operationId);
    expect(parsedRebuilt.orchestration).toBe(parsedOriginal.orchestration);
    expect(parsedRebuilt.args).toEqual(parsedOriginal.args);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Save → Load round-trip
// ═══════════════════════════════════════════════════════════════════════════════

describe('Save → Load round-trip', () => {
  it('source step survives save/load round-trip', () => {
    const original = {
      id: 'step-001',
      process_type: 'yt_fetch_videos',
      label: 'Fetch Videos',
      configuration: {
        channel_url: 'https://youtube.com/@TestChannel',
        _orchestrator: 'source',
      },
      formula: '=yt_fetch_videos.source(channel_url="https://youtube.com/@TestChannel")',
    };

    const loaded = roundTripStep(original);

    expect(loaded.formula).toBe(original.formula);
    expect(loaded.process_type).toBe(original.process_type);
    expect(loaded.configuration['channel_url']).toBe('https://youtube.com/@TestChannel');
    expect(loaded.configuration['_orchestrator']).toBe('source');
  });

  it('map step with step reference survives save/load round-trip', () => {
    const original = {
      id: 'step-002',
      process_type: 'extract_metadata',
      label: 'Extract Metadata',
      configuration: { url: 'step1.url', _orchestrator: 'map' },
      formula: '=extract_metadata.map(url=step1.url)',
    };

    const loaded = roundTripStep(original);

    expect(loaded.formula).toBe(original.formula);
    expect(loaded.process_type).toBe('extract_metadata');
    expect(loaded.configuration['url']).toBe('step1.url');

    // The formula bar should NOT show quotes around the step ref
    expect(loaded.formula).not.toContain('"step1.url"');
  });

  it('filter step with mixed args survives save/load', () => {
    const original = {
      id: 'step-003',
      process_type: 'is_popular',
      label: 'Filter Popular',
      configuration: {
        views: 'step2.views',
        min_views: '1000',
        _orchestrator: 'filter',
      },
      formula: '=is_popular.filter(views=step2.views, min_views=1000)',
    };

    const loaded = roundTripStep(original);

    expect(loaded.formula).toBe(original.formula);
    expect(loaded.process_type).toBe('is_popular');
    expect(loaded.configuration['views']).toBe('step2.views');
    expect(loaded.configuration['min_views']).toBe('1000');
  });

  it('noop step survives save/load', () => {
    const original = {
      id: 'step-004',
      process_type: 'noop',
      label: 'Empty',
      configuration: {},
      formula: '',
    };

    const loaded = roundTripStep(original);

    expect(loaded.formula).toBe('');
    expect(loaded.process_type).toBe('noop');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Formula = Python function call — the "eval" contract
// ═══════════════════════════════════════════════════════════════════════════════

describe('Formula mirrors Python decorated function call syntax', () => {
  /**
   * The formula bar syntax should look identical to calling a @simple_step
   * decorated function in Python (minus the `=` prefix).
   *
   * Python:    fetch_videos.source(channel_url="https://...")
   * Formula:   =fetch_videos.source(channel_url="https://...")
   *
   * The `.source` is the orchestration modifier — in Python, this would be
   * like calling a method on the function object. The key insight is that
   * the formula string (after removing `=`) should be valid Python-like syntax.
   */

  it('source operation formula reads like Python function call', () => {
    const formula = buildFormula(
      'fetch_channel_videos',
      { channel_url: 'https://www.youtube.com/@TestChannel' },
      'source',
    );
    expect(formula).toBe('=fetch_channel_videos.source(channel_url="https://www.youtube.com/@TestChannel")');

    // Remove the `=` prefix — it should look like a Python call
    const pythonLike = formula.slice(1);
    expect(pythonLike).toMatch(/^\w+\.\w+\(.*\)$/);
  });

  it('map operation formula with step reference reads like Python attribute access', () => {
    const formula = buildFormula(
      'extract_metadata',
      { url: 'step1.url' },
      'map',
    );
    expect(formula).toBe('=extract_metadata.map(url=step1.url)');

    // In Python, step1.url would be attribute access — unquoted is correct
    const pythonLike = formula.slice(1);
    expect(pythonLike).toMatch(/^\w+\.\w+\(.*\)$/);
    expect(pythonLike).toContain('url=step1.url');
  });

  it('filter operation with numeric arg reads like Python call with default arg', () => {
    const formula = buildFormula(
      'is_popular',
      { views: 'step2.views', min_views: 1000 },
      'filter',
    );
    // Numbers should NOT be quoted — same as Python
    expect(formula).toBe('=is_popular.filter(views=step2.views, min_views=1000)');
  });

  it('dataframe operation with no args reads like Python call', () => {
    const formula = buildFormula('analyze_sentiment', {}, 'dataframe');
    expect(formula).toBe('=analyze_sentiment.dataframe()');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Real pipeline JSON scenarios from the projects/ directory
// ═══════════════════════════════════════════════════════════════════════════════

describe('Real pipeline JSON scenarios', () => {
  it('hydrates sample-youtube-mock-analysis pipeline correctly', () => {
    // Exact data from new-pipeline-sample-example1.json
    const pipeline = {
      id: 'new-pipeline-sample-example1',
      name: 'new-pipeline_sample_example1',
      steps: [
        {
          step_id: 'step-02iqkl5',
          operation_id: 'yt_fetch_videos',
          label: 'Step 0',
          config: {
            channel_url: 'https://youtube.com/mock_channel',
            _orchestrator: 'source',
          },
          formula: '=yt_fetch_videos.source(channel_url="https://youtube.com/mock_channel")',
        },
        {
          step_id: 'step-dxzodwi',
          operation_id: 'yt_extract_metadata',
          label: 'Step 1',
          config: {
            _orchestrator: 'map',
            url: 'Step1',
          },
          formula: '=yt_extract_metadata.map(url="Step1")',
        },
      ],
    };

    const hydrated = pipeline.steps.map(hydrateStep);

    // Step 0: formula bar should show the full formula with all args
    expect(hydrated[0].formula).toBe('=yt_fetch_videos.source(channel_url="https://youtube.com/mock_channel")');
    expect(hydrated[0].process_type).toBe('yt_fetch_videos');
    expect(hydrated[0].configuration['channel_url']).toBe('https://youtube.com/mock_channel');
    expect(hydrated[0].configuration['_orchestrator']).toBe('source');

    // Step 1: formula bar should show the formula with url argument
    expect(hydrated[1].formula).toBe('=yt_extract_metadata.map(url="Step1")');
    expect(hydrated[1].process_type).toBe('yt_extract_metadata');
    expect(hydrated[1].configuration['url']).toBe('Step1');
    expect(hydrated[1].configuration['_orchestrator']).toBe('map');
  });

  it('hydrates pipeline with missing formula field (legacy format)', () => {
    const pipeline = {
      steps: [
        {
          step_id: 'step-001',
          operation_id: 'yt_fetch_videos',
          label: 'Step 0',
          config: {
            channel_url: 'https://youtube.com/mock_channel',
            _orchestrator: 'source',
          },
          // NO formula field
        },
        {
          step_id: 'step-002',
          operation_id: 'yt_extract_metadata',
          label: 'Step 1',
          config: {
            _orchestrator: 'map',
            url: 'step1.url',
          },
          // NO formula field
        },
      ],
    };

    const hydrated = pipeline.steps.map(hydrateStep);

    // Step 0: formula must be reconstructed from operation_id + config
    expect(hydrated[0].formula).not.toBe('');
    expect(hydrated[0].formula).toContain('yt_fetch_videos');
    expect(hydrated[0].formula).toContain('.source');
    expect(hydrated[0].formula).toContain('channel_url');

    // Step 1: formula must be reconstructed with unquoted step reference
    expect(hydrated[1].formula).not.toBe('');
    expect(hydrated[1].formula).toContain('yt_extract_metadata');
    expect(hydrated[1].formula).toContain('.map');
    expect(hydrated[1].formula).toContain('url=step1.url');
    expect(hydrated[1].formula).not.toContain('"step1.url"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. Formula → API payload — what gets sent to POST /api/run
// ═══════════════════════════════════════════════════════════════════════════════

describe('Formula → API payload (what gets POSTed to backend)', () => {
  /**
   * When the user clicks Run, the formula is parsed and sent to the backend.
   * The backend receives { operation_id, config, input_ref_id, step_map }.
   * The config must contain all args from the formula, plus _orchestrator
   * if the formula had an orchestration modifier.
   */
  function formulaToPayload(formula: string, prevRefId: string | null = null) {
    const parsed = parseFormula(formula);
    if (!parsed.isValid || !parsed.operationId) return null;

    const config: Record<string, any> = { ...parsed.args };
    if (parsed.orchestration) {
      config['_orchestrator'] = parsed.orchestration;
    }

    return {
      step_id: 'step-test',
      operation_id: parsed.operationId,
      config,
      input_ref_id: prevRefId,
      step_map: {},
    };
  }

  it('source formula → correct payload', () => {
    const payload = formulaToPayload(
      '=yt_fetch_videos.source(channel_url="https://youtube.com/mock_channel")',
    );
    expect(payload).not.toBeNull();
    expect(payload!.operation_id).toBe('yt_fetch_videos');
    expect(payload!.config.channel_url).toBe('https://youtube.com/mock_channel');
    expect(payload!.config._orchestrator).toBe('source');
    expect(payload!.input_ref_id).toBeNull();
  });

  it('map formula with step reference → correct payload', () => {
    const payload = formulaToPayload(
      '=extract_metadata.map(url=step1.url)',
      'ref-prev-output',
    );
    expect(payload).not.toBeNull();
    expect(payload!.operation_id).toBe('extract_metadata');
    expect(payload!.config.url).toBe('step1.url');
    expect(payload!.config._orchestrator).toBe('map');
    expect(payload!.input_ref_id).toBe('ref-prev-output');
  });

  it('filter formula with mixed args → correct payload', () => {
    const payload = formulaToPayload(
      '=is_popular.filter(views=step2.views, min_views=1000)',
    );
    expect(payload).not.toBeNull();
    expect(payload!.operation_id).toBe('is_popular');
    expect(payload!.config.views).toBe('step2.views');
    expect(payload!.config.min_views).toBe('1000');
    expect(payload!.config._orchestrator).toBe('filter');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. Edge cases and error handling
// ═══════════════════════════════════════════════════════════════════════════════

describe('Edge cases', () => {
  it('handles empty formula gracefully', () => {
    const result = simulateFormulaUpdate({ configuration: {} }, '');
    expect(result.formula).toBe('');
  });

  it('handles formula with only = sign', () => {
    const result = simulateFormulaUpdate({ configuration: {} }, '=');
    expect(result.formula).toBe('=');
  });

  it('handles partial formula (typing in progress)', () => {
    const result = simulateFormulaUpdate(
      { configuration: {} },
      '=fetch_videos.source(',
    );
    // Still incomplete — no closing paren
    expect(result.formula).toBe('=fetch_videos.source(');
    // But process_type should still update for the details panel
    // (partial formula update sets process_type if operationId is available)
  });

  it('hydrateStep handles malformed formula gracefully', () => {
    const step = hydrateStep({
      step_id: 'step-bad',
      operation_id: 'my_op',
      label: 'Bad Formula',
      config: { key: 'value' },
      formula: 'not_a_formula',  // no = prefix
    }, 0);

    // Should fall back to operation_id + config
    expect(step.process_type).toBe('my_op');
    expect(step.formula).toContain('my_op');
    expect(step.configuration['key']).toBe('value');
  });

  it('buildFormula handles config with _-prefixed keys — they are excluded', () => {
    const formula = buildFormula('my_op', {
      visible_arg: 'hello',
      _orchestrator: 'map',
      _internal: 'secret',
    }, 'map');

    expect(formula).toContain('visible_arg="hello"');
    expect(formula).not.toContain('_orchestrator');
    expect(formula).not.toContain('_internal');
  });
});
