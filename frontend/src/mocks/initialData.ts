import type { Workflow, Step } from '../types/models';
import { buildFormula } from '../utils/formulaParser';

const step0: Step = {
  id: 'step-000',
  sequence_index: 0,
  label: 'Step 0',
  formula: '',
  process_type: 'noop',
  configuration: {},
  status: 'pending',
  output_preview: [],
};

export const initialWorkflow: Workflow = {
  id: 'wf-initial',
  name: 'New Workflow',
  created_at: new Date().toISOString(),
  steps: [step0],
};

/**
 * A ready-to-run YouTube analysis pipeline that exercises every mock operation.
 * Formulas are the canonical source; process_type and configuration are derived.
 */
export const youtubeAnalysisPipeline: Workflow = {
  id: 'wf-youtube-demo',
  name: 'YouTube Channel Analysis',
  created_at: new Date().toISOString(),
  steps: [
    {
      id: 'yt-step-1',
      sequence_index: 0,
      label: 'Fetch Videos',
      formula: buildFormula('fetch_channel_videos', { channel_url: 'https://www.youtube.com/@MockChannel' }),
      process_type: 'fetch_channel_videos',
      configuration: { channel_url: 'https://www.youtube.com/@MockChannel' },
      status: 'pending',
    },
    {
      id: 'yt-step-2',
      sequence_index: 1,
      label: 'Extract Metadata',
      formula: buildFormula('extract_metadata', { url_column: 'video_url' }),
      process_type: 'extract_metadata',
      configuration: { url_column: 'video_url' },
      status: 'pending',
    },
    {
      id: 'yt-step-3',
      sequence_index: 2,
      label: 'Transcribe Videos',
      formula: buildFormula('transcribe_video', { url_column: 'video_url' }),
      process_type: 'transcribe_video',
      configuration: { url_column: 'video_url' },
      status: 'pending',
    },
    {
      id: 'yt-step-4',
      sequence_index: 3,
      label: 'Segment Conversations',
      formula: buildFormula('segment_conversations', { transcript_column: 'transcript', title_column: 'title' }),
      process_type: 'segment_conversations',
      configuration: { transcript_column: 'transcript', title_column: 'title' },
      status: 'pending',
    },
    {
      id: 'yt-step-5',
      sequence_index: 4,
      label: 'Analyze Sentiment',
      formula: buildFormula('analyze_sentiment', { text_column: 'segment_text' }),
      process_type: 'analyze_sentiment',
      configuration: { text_column: 'segment_text' },
      status: 'pending',
    },
    {
      id: 'yt-step-6',
      sequence_index: 5,
      label: 'Generate Report',
      formula: buildFormula('generate_report', { score_column: 'sentiment_score' }),
      process_type: 'generate_report',
      configuration: { score_column: 'sentiment_score' },
      status: 'pending',
    },
  ],
};

export const mockCells = [
  { row_id: 1, column_id: 'A', value: 10, display_value: '10' },
  { row_id: 1, column_id: 'B', value: 'foo', display_value: 'foo' },
  { row_id: 2, column_id: 'A', value: 20, display_value: '20' },
  { row_id: 2, column_id: 'B', value: 'bar', display_value: 'bar' },
];

