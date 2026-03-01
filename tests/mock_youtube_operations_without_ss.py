import pandas as pd

# --- Mock Implementations of the Raw Functions ---
def fetch_videos(channel_url="https://youtube.com/mock_channel"):
    return [
        f"{channel_url}/video/1",
        f"{channel_url}/video/2", 
        f"{channel_url}/video/3", 
        f"{channel_url}/video/4", 
        f"{channel_url}/video/5"
    ]

def extract_metadata(url):
    return {
        "title": f"Video Title for {str(url).split('/')[-1]}",
        "views": len(str(url)) * 100,
        "author": "Mock Channel"
    }

def is_video_popular(views, min_views=1000):
    return views > min_views

def transcribe(url):
    return f"Transcript content for {url}..."

def analyze_sentiment(data):
    # This one expects a dataframe natively
    text_col = 'yt_transcribe_output' # Hardcoded for this script
    result = data.copy()
    result['sentiment_score'] = result[text_col].apply(lambda x: float(len(str(x)) % 10) / 10.0)
    return result

def generate_report(metrics_df):
    # This one expects a dataframe natively
    avg = metrics_df['sentiment_score'].mean()
    return pd.DataFrame([{
        "total_videos_analyzed": len(metrics_df),
        "average_sentiment": avg,
        "status": "Report Generated"
    }])

# ==========================================
# MANUAL ORCHESTRATION SCRIPT
# ==========================================

print("--- Step 1: Fetch Videos (Source) ---")
# 1. Raw Execution
raw_urls = fetch_videos()
# 2. Orchestration: Convert list to DataFrame
df_step1 = pd.DataFrame(raw_urls, columns=["output"])
print(df_step1)
print("\n")


print("--- Step 2: Extract Metadata (Map) ---")
# 1. Input: df_step1
# 2. Orchestration: Apply function to every row in 'output' column
#    IMPORTANT: We are emulating the NEW logic where dicts are stored in one cell
meta_results = []
for url in df_step1['output']:
    meta_results.append(extract_metadata(url))

# 3. Create new column
df_step2 = df_step1.copy()
df_step2['extract_metadata_output'] = meta_results
print(df_step2)
print("\n")


print("--- Step 3: Filter Popular (Filter) ---")
# 1. We need to extract 'views' from the dictionary in 'extract_metadata_output' to use it
#    (Simulating user doing a column expansion or accessing dict key)
#    Let's assume the user expands the dict column first or accesses it. 
#    For this script, we'll map a lambda to check inside the dict.
def check_row(row):
    meta = row['extract_metadata_output']
    # Function expects 'views' argument
    return is_video_popular(views=meta['views'], min_views=3000) # Higher threshold to filter some out

# 2. Orchestration: Boolean Indexing
mask = df_step2.apply(check_row, axis=1)
df_step3 = df_step2[mask].copy()
print(f"Filtered {len(df_step2)} rows down to {len(df_step3)}")
print(df_step3)
print("\n")


print("--- Step 4: Transcribe (Map) ---")
# 1. Input: df_step3 (The filtered list)
# 2. Orchestration: Apply to 'output' column (the URL)
transcripts = df_step3['output'].apply(transcribe)
df_step4 = df_step3.copy()
df_step4['yt_transcribe_output'] = transcripts
print(df_step4[['output', 'yt_transcribe_output']])
print("\n")


print("--- Step 5: Analyze Sentiment (DataFrame) ---")
# 1. Input: df_step4
# 2. Orchestration: Pass the whole DF
df_step5 = analyze_sentiment(df_step4)
print(df_step5[['yt_transcribe_output', 'sentiment_score']])
print("\n")


print("--- Step 6: Generate Report (DataFrame) ---")
# 1. Input: df_step5
# 2. Orchestration: Pass whole DF
df_step6 = generate_report(df_step5)
print(df_step6)