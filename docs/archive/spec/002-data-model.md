# Specification: Data Model

## 1. Workflow
**Description:** The top-level container for a user's session.
```json
{
  "id": "uuid",
  "name": "My Analysis Workflow",
  "created_at": "timestamp",
  "steps": ["Step"] // Ordered list of Step objects
}
```

## 2. Step
**Description:** Represents a single unit of work in the pipeline.
```json
{
  "id": "uuid",
  "sequence_index": 0,
  "label": "Data Cleaning",
  "process_type": "string", // e.g., "clean_nulls", "standardize_date"
  "configuration": {
    // Dynamic key-value pairs representing parameters for the backend script
    "threshold": 0.5,
    "target_column": "price"
  },
  "status": "pending | running | completed | error",
  "output_preview": ["Cell"] // Or reference to a dataset ID
}
```

## 3. Cell / Data Output
**Description:** Represents atomic units of data returned by a step. 
*Note: For scale, the frontend might only hold a viewport of this data, fetched from backend.*
```json
{
  "row_id": 0,
  "column_id": "col_name",
  "value": "raw_value",
  "display_value": "formatted_string",
  "metadata": {} 
}
```

## 4. Operational Strategy
**Description:** Defines how a step behaves. This maps to the backend Python function.
```json
{
  "id": "process_clean_nulls",
  "name": "Clean Null Values",
  "description": "Removes rows with null values",
  "required_params": [
    {"name": "columns", "type": "list<string>"}
  ]
}
```
