stusynakowski: suppose i am orchestrating functions in excel on some tabular data can you walk me through how to reference cells across sheets inexcel. and all possible examples?

GitHub Copilot: Here is a walkthrough of the different ways to reference cells across sheets in Excel.

### 1. Basic Sheet Reference syntax
The standard syntax for referencing a cell on another sheet is:
`'SheetName'!CellAddress`

*   **Example:** To reference cell **A1** on a sheet named **Data**:
    `=Data!A1`

*   **With Spaces:** If the sheet name contains spaces, single quotes are mandatory.
    `='Raw Data Source'!B5`

### 2. Referencing a Range
You can reference a specific range of cells on another sheet, often used in functions like `SUM`, `VLOOKUP`, or array formulas.

*   **Example:** Summing A1 through A10 on the "Sales" sheet.
    `=SUM(Sales!A1:A10)`

### 3. 3D References (Across Multiple Sheets)
If you have multiple sheets with identical layouts (e.g., "Jan", "Feb", "Mar"), you can reference the same cell across all those sheets simultaneously.

*   **Syntax:** `'FirstSheet:LastSheet'!CellReference`
*   **Example:** Summing cell **B2** across all sheets from **Jan** to **Mar**:
    `=SUM('Jan:Mar'!B2)`

### 4. Named Ranges (Global Scope)
If you define a "Named Range" in Excel, it is usually globally accessible by default. You do not need to specify the sheet name in the formula, making the orchestration much cleaner.

*   **Definition:** Select cell **C1** on "Constants" sheet $\rightarrow$ Define Name as `TaxRate`.
*   **Usage anywhere:** `=A1 * TaxRate`

### 5. Structured References (Excel Tables)
If your tabular data is formatted as an Excel Table (Ctrl+T), references become much more readable and robust.

*   **Same row reference:** `=[@ColumnName]`
*   **External reference:** `Table1[ColumnName]`
*   **Example:** Referencing the "Price" column in "Table1" from a different sheet:
    `=SUM(Table1[Price])`

### 6. Indirect Referencing (Dynamic)
If the sheet name you want to reference is actually stored in a cell (for dynamic orchestration), use `INDIRECT`.

*   **Scenario:** Cell **A1** contains the text "Sheet2". You want to get value **B5** from that sheet.
*   **Formula:** `=INDIRECT("'" & A1 & "'!B5")`

### 7. External Workbook References
Referencing data in a completely different Excel file.

*   **Open Workbook:** `=[Budget.xlsx]Sheet1!A1`
*   **Closed Workbook (Full Path):** `='C:\Users\Name\Documents\[Budget.xlsx]Sheet1'!A1`

stusynakowski: what if i want to define a rowise mapping to another column but the number of rows changes

GitHub Copilot: In Excel, when the number of rows changes dynamically, standard cell references (e.g., `A1:A100`) break or require constant updating. Here are the best ways to handle row-wise mappings with dynamic row counts:

### 1. Excel Tables (Recommended)
This is the most robust method. When you convert a range to a Table (**Insert > Table** or `Ctrl + T`), Excel treats the columns as dynamic objects.

*   **How it works:** If you add a formula in a new column, the table automatically expands it to every row. If you add new data rows, the formula automatically applies to them.
*   **Syntax:** Instead of `A2`, you use `[@ColumnName]`.
    *   **Example:** `=[@Price] * [@Quantity]`

### 2. Dynamic Array Formulas (Excel 365/2021+)
Using "Spill" functionality, you write a formula in a single cell, and it "spills" down to match the size of the source array.

*   **Syntax:** referencing the entire column or a spill range using the `#` operator.
*   **Example:**
    If your source data is in `A2:A10` (and might grow), and you want to double it in column B.
    1.  Write in B2: `=A2:A1000 * 2` (Standard way, leaves zeros at bottom)
    2.  Write in B2: `=FILTER(A:A, A:A<>"") * 2` (Better, only calculates filled rows)

### 3. Whole Column References
You can reference the entire column, though this can be computationally expensive for complex formulas.

*   **Syntax:** `A:A` (references the entire column A from row 1 to 1,048,576).
*   **Example:** `=VLOOKUP(B2, 'DataSheet'!A:D, 2, FALSE)`

### 4. Named Ranges with OFFSET (Legacy Method)
Before Tables existed, users created "Dynamic Named Ranges" using the `OFFSET` and `COUNTA` functions.

1.  **Go to:** Formulas > Name Manager > New.
2.  **Name:** `DynamicData`.
3.  **Refers to:** `=OFFSET(Sheet1!$A$1, 0, 0, COUNTA(Sheet1!$A:$A), 1)`
    *   This counts how many items are in column A and creates a reference that is exactly that tall.
4.  **Usage:** `=SUM(DynamicData)`

stusynakowski: can you list out the most fundamental concepts in broadcasting across tabular data. for operations that create a columns of rows. create a table. pivot, map between, filter, collapse cells etc.

GitHub Copilot: Here are the fundamental concepts for broadcasting and orchestrating operations across tabular data (DataFrames).

### Core Broadcasting Concepts

| Concept | Description | Typical Pattern |
| :--- | :--- | :--- |
| **Scalar Broadcasting** | Assigning a single value to an entire column or subset. The value is "broadcast" down every row. | `df['Status'] = 'Active'` |
| **Element-wise Operation** | Applying a function to each item in a row individually, often involving multiple columns in that same row. | `df['Total'] = df['Price'] * df['Qty']` |
| **Vectorization** | Performing operations on entire arrays (columns) at once rather than looping through rows. This represents the backend optimization of broadcasting. | `numpy.add(col_a, col_b)` |
| **Mapping / Lookup** | Using a key column to find values in an external dictionary or reference table and broadcasting the result into a new column. | `df['City'] = df['Zip'].map(zip_dict)` |
| **Conditional Broadcasting** | Applying logic where the result broadcast depends on a condition (Masking). | `np.where(condition, value_if_true, value_if_false)` |

### Structural Operations (Reshaping)

| Concept | Description |
| :--- | :--- |
| **Filtering (Subsetting)** | Reducing the number of rows based on boolean logic. This is often the first step before broadcasting an operation to a specific slice of data. |
| **Aggregation (Collapsing)** | "Collapsing cells." Reducing multiple rows into a single summary value (Sum, Mean, Max) usually grouped by a specific key. This transforms the shape from $N$ rows to $Unique Keys$ rows. |
| **Pivoting (Long to Wide)** | Taking unique values from a single column and broadcasting them out to become column headers, filling the intersection with values. |
| **Melting (Wide to Long)** | The inverse of pivoting. Taking multiple column headers and un-pivoting them into row values under a "Variable" column. |
| **Windowing** | Applying an aggregation (like a rolling average or cumulative sum) that slides over a defined window of rows without collapsing the table. |

### Orchestration Logic (Python Function Wrappers)

When defining custom functions for orchestration (as referenced in your notes), steps usually fall into one of these standard signatures:

1.  **Map Functions (Row-wise):**
    *   *Input:* Single Row (or specific arguments from a row).
    *   *Output:* Single Value.
    *   *Broadcasting:* Applied to every row.

2.  **Reduce/Aggregate Functions:**
    *   *Input:* Series/list of values (Column).
    *   *Output:* Single Value (Scalar).
    *   *Broadcasting:* Applied per group.

3.  **Transform Functions:**
    *   *Input:* DataFrame.
    *   *Output:* DataFrame (same size, modified values).
    *   *Broadcasting:* Full table manipulation.

stusynakowski: can you give me a sheetsheet for all of these operations with pandas?

GitHub Copilot: Here is a cheatsheet mapping your orchestration concepts to specific **Pandas** syntax.

### 1. Map Functions (Row-wise)
*Goal: Apply logic to every row individually to create a new column.*

| Operation | Pandas Syntax | Best Use Case |
| :--- | :--- | :--- |
| **Vectorized Math** | `df['New'] = df['Col A'] * df['Col B']` | Simple math (fastest method). |
| **String Operations** | `df['New'] = df['Name'].str.lower()` | Standard string manipulation. |
| **Simple Map** | `df['New'] = df['Status'].map({'A': 1, 'B': 2})` | Mapping values from a dictionary. |
| **Lambda (One Col)** | `df['New'] = df['Col A'].apply(lambda x: x**2)` | Custom logic on a single column. |
| **Lambda (Row)** | `df['New'] = df.apply(lambda row: func(row['A'], row['B']), axis=1)` | Custom logic requiring multiple columns. |
| **Custom Function** | `df['New'] = np.vectorize(my_func)(df['A'], df['B'])` | High-performance custom Python function application. |

### 2. Reduce/Aggregate Functions
*Goal: Collapse multiple rows into a single summary value, usually by group.*

| Operation | Pandas Syntax | Description |
| :--- | :--- | :--- |
| **Global Reduce** | `val = df['Price'].sum()` | Single scalar for the whole table. |
| **Groupby Aggr** | `df.groupby('Region')['Sales'].sum()` | New Series indexed by Region. |
| **Multiple Aggrs** | `df.groupby('Region').agg({'Sales': 'sum', 'Qty': 'max'})` | Different logic for different columns. |
| **Named Aggr** | `df.groupby('Region').agg(Total_Sales=('Sales', 'sum'))` | Define new column name during aggregation. |
| **Collapse Text** | `df.groupby('ID')['Tags'].apply(lambda x: ', '.join(x))` | Concatenate strings from multiple rows. |

### 3. Transform Functions
*Goal: Return a dataset of the same size, but with values modified based on group statistics.*

| Operation | Pandas Syntax | Result Shape |
| :--- | :--- | :--- |
| **Window Calc** | `df['GroupMean'] = df.groupby('Region')['Sales'].transform('mean')` | Assigns the regional average to every row in that region (Rows don't collapse). |
| **Filter by Group** | `df = df.groupby('ID').filter(lambda x: x['Sales'].sum() > 100)` | Keeps all rows for IDs where total sales > 100. |
| **Rolling Window** | `df['MovingAvg'] = df['Sales'].rolling(window=3).mean()` | Calculates moving average over previous 3 rows. |
| **Shift/Lag** | `df['PrevDay'] = df['Sales'].shift(1)` | Moves values down one row (useful for time deltas). |

### 4. Structural Reshaping
*Goal: changing the physical layout of the table.*

| Operation | Pandas Syntax | Excel Equivalent |
| :--- | :--- | :--- |
| **Pivot** | `df.pivot_table(index='Date', columns='City', values='Sales')` | Excel Pivot Table. |
| **Melt** | `df.melt(id_vars=['Date'], value_vars=['NYC', 'LA'])` | Unpivot / "Get Data" clean steps. |
| **Cross Join** | `df1.merge(df2, how='cross')` | Cartesian product (every row match every row). |
| **Lookup/Join** | `df1.merge(df2, left_on='ID', right_on='ID', how='left')` | VLOOKUP / XLOOKUP. |

### 5. Code Pattern Examples

```python
import pandas as pd
import numpy as np

# 1. MAP: Create 'Total' from Price * Qty
df['Total'] = df['Price'] * df['Qty']

# 2. TRANSFORM: Add 'Regional_Avg' to every row (without collapsing)
df['Regional_Avg'] = df.groupby('Region')['Total'].transform('mean')

# 3. MASK/FILTER: Create column based on condition
df['Performance'] = np.where(df['Total'] > df['Regional_Avg'], 'Over', 'Under')

# 4. REDUCE: Collapse to summary table
summary_df = df.groupby('Region').agg(
    Region_Total=('Total', 'sum'),
    Transaction_Count=('ID', 'count')
)
```




🔬 First-Principles Compression
Even deeper:
All tabular operations modify one of three things:
Rows (key space)
Columns (feature space)
Values (data space)
So your verbs naturally cluster:
Row-space operations
Filter
Group
Order
Unique
Column-space operations
Pick
Create
Rename
Convert
Value-space operations
Transform
Summarize
Clean
Structure-space operations
Combine
Rearrange
Append




Used 1 reference
Analyzing the Goal's Structure
Based on the goal of mimicking Excel/Pandas logic while keeping the implementation modular, here is a solid list of operation_types (orchestrators) you should define.

These cover the lifecycle of data: Creation -> Transformation -> reduction -> Combination.

1. The Core Primitives (Must Haves)
source: (Existing)

Logic: func() -> List[Any] becomes DataFrame.
Use Case: Fetching data from APIs, loading files, generating initial lists.
Excel Equivalent: Import Data / Manual Entry.
map (or rowmap): (Existing)

Logic: func(scalar) -> scalar/dict. Applied row-by-row.
Use Case: API enrichment (e.g., getting metadata for a URL), text processing, cleaning specific values.
Excel Equivalent: Dragging a formula =UPPER(A1) down a column.
filter:

Logic: func(row or df) -> bool.
Use Case: Removing rows based on logic (e.g., views > 1000, sentiment > 0.5).
Excel Equivalent: Filter button / Advanced Filter.
expand:

Logic: func(scalar) -> List[Any].
Use Case: One row becomes multiple rows. (e.g., Given a Playlist URL -> Return list of Video URLs). This is distinct from source because it takes input from a previous step.
Excel Equivalent: Power Query "Expand List".
Pandas Equivalent: .explode().
aggregate:

Logic: func(Series/List) -> scalar.
Use Case: calculating sums, averages, max/min, or concatenating text.
Excel Equivalent: Pivot Tables, =SUM(A:A).
Pandas Equivalent: .groupby().agg().
2. Advanced / Structural Operations (Nice to Have)
join:

Logic: Merges the current DF with another Step's DF based on a key.
Use Case: Combining "User Data" (Step 1) with "Transaction Data" (Step 2).
Excel Equivalent: VLOOKUP / XLOOKUP.
sort:

Logic: Reorders rows based on column values.
Use Case: Ranking top videos.
Excel Equivalent: Sort A-Z.
pivot:

Logic: Reshapes data (Long to Wide).
Use Case: Turning a list of "Date, Metric, Value" into columns of metrics per date.
Excel Equivalent: Pivot Table.
Implementation Blueprint
Here is how you can implement the new orchestrators in src/SIMPLE_STEPS/orchestrators.py to support this list.