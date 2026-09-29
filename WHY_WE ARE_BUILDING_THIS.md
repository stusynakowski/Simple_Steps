# what is the purpose of this tool
# in short we want to build a platform to help people compose python operations in a way that is as easy as composing functions in tabular tools like excel.
# in this wrok we are building a frontend that resembles tabular workflows but is developed in a way that is super easy for python developers to expose tools and resources that users can invoke to perform whatever task they need. additionally users can leverage Agents that merely review the task at hand, review the resource we have acsess to and propose a linear chain of dectorated tools to perform the task. AGENTS are ideally not executing tasks but are merely proposing updates to the chain of operations operations

# CONTEXT 
# IN short we want an easy bridge between two people
# USERS and PYTHON DEVELOPERS in a way for AGENTS to help facilitate in a way that very explicit untuitive and secure
# 1 USERS are people that want to use python tools and resources for the tasks they need to perform. they are familiar with excel but not familiar with python and the details behind them. they just want to perform whatever analysis is needed and can be performed by the set of tools defined by the developer
# PROBLEMS USERS are having. they cant access the tool they even have trouble with pip installs. they are unfamiliar with python but are familiar with the functional imparactive programming style of excel where they know what they want to do and can chain a set of operations to perform whatever analysis they want to do. they want to use agentic frameworks but dont trust them because they cant see what exactly the agent is doing. they want to minimize the amount of

# 2 PYTHON DEVELOPERS: are people that create customized tools/rsources for USERS that need solutions to activate their work. tools are essentually dectorated python functions. DEVELOPERS are good at creating the tools but have difficulties exposing them to USERS who may want to use them. PYTHON developers want to create a simple server for their customized functions that enables users to activate them and orchestrate. they dont want to have to worry about all of the details in how the user users the tool but they want an easy framework to deploy and develope these tools. RESOURCES are esentially python classes the
# DEVELOPERS ARE ALSO worried about what agents might do. the solution is to narrow the agent to merely one task: propose the list of python functions in the order they need to be executed to faciliate the task, in a way the USERS can review manage and modify the the arguments, run each step. and ubserve outputs they are getting. DEVELOPERS  want a pip install package that allows users to dectorate python functions for their tools and classes as tools and resources and deploys their pages server equipped with a UI that remembles EXCEL.

# Solution to motivate this project, this component is the full package containing the REACT UI frontend and will eventually be a python project users can install via pip. Users will have workflows.
# as a linear chain of decorated functions that resemble
# a typical workflow someone would have in their data processing pipeline in excel. this will resemble a reactive program that resembles much of what makes excel such a great tool. more importantly the "functions the users are performing" are python functions

# users are exposed to a list of tools in resources for a particular scope of problems. think of problems related to image processing, NLP analysis, 


# HOW this will work Consider the problem of performing image analysis for a clinical study.

# users need to load the images, process each image, gather metric from each image, pair the images with meta data for each, then perform some kind of statistical analysis and plots and save the results.
# these can all be performed with python function.

# the GOAL of this tool is to formulate that entire process as a single WORKFLOW list of Steps. Conceptually WORKFLOW
# is merely a chain of python functions. however when developing a workflow users need to see the data and how that data changes as they run that operation.  

# when developing step is an object that contains the operation to be executed (think a single line of a function) and the resulting data of these operations
# the data is presented in tabular. data structure contained in Cells. However the contents of those cells change depending onthe operation.

# for example loading images from a folder would product a list of files. each file name would be a row
# users might want to load each image. and apply an operation that loads the contents of each image to the USER such that the user can click. and observe the contents of each image. the tools needed would be list the files. producings a list of file names and paths. andf the load image. that list files tool would be orchestrated to produce a column of filenames and paths. then a tool that is orchestrated across the output from the previous entire set of images to raster the image. the user can click on any of these cells to observe the content or reference the data from a previous step for an argument to the operation for the subsequence step. the USer will be able to define operations in the formula bar. or manually with whatever UI is defined for that operation. once the operation is defined and is a valid operation. the user will reactively see the staging for that operation. then the user can run that step and it will run the operation show the progress for each operation, and then populate the cell with the actual image.

# the backend of this tool is being developed on a different repo. where we develope ways to dynamically orchestrate tools fit for this framewor. (mapping expanding, collapsing filtering cells, running asyncronously batch processing,grouping showing progress etc.)
# https://github.com/stusynakowski/simple-steps-core
# when tools are registered they can be modified dynamically with a chain of modifers to fit the necessary orchestration and execution strategy the user neads. 

# topics to discuss layer 

# RESOURCES
# TOOL FORMULSTION and server construction for USers
# DETAILS ON THE UI
# chanining etc.
# saving data saving and exporting workflows
# agentic development
# app session management 





