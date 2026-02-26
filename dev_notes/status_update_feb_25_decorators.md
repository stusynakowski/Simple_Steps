# operation orchestration


# the data

# key components in the backend
# the key data holder between steps will be a dataframe
# mapping between function
# referencing the data



# defining steps 
# MAP iterating across the rows
# 



# simple python functions versus 
# you can define any custom function but it needs to be wrapped
# with a set of 
# 

Orchestration Logic (Python Function Wrappers)
When defining custom functions for orchestration (as referenced in your notes), steps usually fall into one of these standard signatures:

Map Functions (Row-wise):

Input: Single Row (or specific arguments from a row).
Output: Single Value.
Broadcasting: Applied to every row.
Reduce/Aggregate Functions:

Input: Series/list of values (Column).
Output: Single Value (Scalar).
Broadcasting: Applied per group.
Transform Functions:

Input: DataFrame.
Output: DataFrame (same size, modified values).
Broadcasting: Full table manipulation.