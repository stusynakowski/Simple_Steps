import type { Workflow, Step } from '../types/models';

const step0: Step = {
  id: 'step-000',
  sequence_index: 0,
  label: 'Step 0',
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
 * Load this via useWorkflow.loadWorkflow or use it as a starting point in the UI.
 *
 * Steps mirror the mock_operations/mock_youtube_ops.py pipeline:
 *   1. fetch_channel_videos  – source, needs a channel_url
 *   2. extract_metadata      – map, reads video_url column
 *   3. transcribe_video      – map, reads video_url column
 *   4. segment_conversations – expand, reads transcript + title columns
 *   5. analyze_sentiment     – map, reads segment_text column
 *   6. generate_report       – aggregate, reads sentiment_score column
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
      process_type: 'fetch_channel_videos',
      configuration: { channel_url: 'https://www.youtube.com/@MockChannel' },
      status: 'pending',
    },
    {
      id: 'yt-step-2',
      sequence_index: 1,
      label: 'Extract Metadata',
      process_type: 'extract_metadata',
      configuration: { url_column: 'video_url' },
      status: 'pending',
    },
    {
      id: 'yt-step-3',
      sequence_index: 2,
      label: 'Transcribe Videos',
      process_type: 'transcribe_video',
      configuration: { url_column: 'video_url' },
      status: 'pending',
    },
    {
      id: 'yt-step-4',
      sequence_index: 3,
      label: 'Segment Conversations',
      process_type: 'segment_conversations',
      configuration: { transcript_column: 'transcript', title_column: 'title' },
      status: 'pending',
    },
    {
      id: 'yt-step-5',
      sequence_index: 4,
      label: 'Analyze Sentiment',
      process_type: 'analyze_sentiment',
      configuration: { text_column: 'segment_text' },
      status: 'pending',
    },
    {
      id: 'yt-step-6',
      sequence_index: 5,
      label: 'Generate Report',
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

