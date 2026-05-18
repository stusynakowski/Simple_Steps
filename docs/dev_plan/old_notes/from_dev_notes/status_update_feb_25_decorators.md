
### next steps

# make sure mapping is one to one with dataframe
# make sure you sort out alignment with functional programming and wrapping 

# start with the decorators

# then if you want define new operations you can do that



# operation orchestration


# core ideas.. ui is to meant to enable easy orchestattions of functions which are implemented in python. this should be as easy as any orchestraction in excel

# users will define steps and will quickly observe how their data flows from one step to the next

# is meant to define functions and stage them to be run at scale later. Healthy medium of abstraction for easy orchestraction but easy access on the functions/data itself


# staging will be reactive users will see what their flow looks like they can run to test their workflow

# steps are decorated python functions with sample data staged or not to help people 



decorator(function)()

# the data

# the default data container for this staged data will be a dataframe for each step. 

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



#### Syntax in the function toolbar

# operations will take in steps 

# functions need to be dectorated to know how they map between dataframes.




# mapping

# grouping  sorts dataframe (heiarchy database)
# filtering selects subset of dataframe
# sorting   transforms
# 




# UI and function syntax

# step(column)




# map(function,$step)