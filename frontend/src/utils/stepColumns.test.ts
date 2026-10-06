import { describe, expect, it } from 'vitest';
import { columnsToShow } from './stepColumns';

describe('columnsToShow', () => {
  it('shows every column of a core-syntax step, whatever the step above had', () => {
    // zipped = zip_(wf["ns"], wf["scores_only"]), listed under scores_only
    expect([...columnsToShow(['n', 'score'], ['score'], true)]).toEqual(['n', 'score']);
    // enriched = join(wf["readings"], wf["city_info"], …), listed under more
    expect([...columnsToShow(['city', 'n', 'region'], ['city', 'n'], true)])
      .toEqual(['city', 'n', 'region']);
  });

  it('shows only the columns an older formula added to the step above', () => {
    expect([...columnsToShow(['city', 'n', 'score'], ['city', 'n'], false)]).toEqual(['score']);
  });

  it('falls back to every column when an older formula added none', () => {
    expect([...columnsToShow(['city', 'n'], ['city', 'n'], false)]).toEqual(['city', 'n']);
    expect([...columnsToShow(['city'], undefined, false)]).toEqual(['city']);
  });
});
