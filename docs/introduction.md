# Introduction

## Problem
There is a significant gap between non-technical domain experts and Python developers/data scientists when it comes to tabular data analysis. While domain experts are familiar with tabular data concepts (like spreadsheets), they often lack the technical skills to perform complicated operations or productionize workflows at scale. Standard spreadsheet tools are insufficient for complex, long-running processes that require Python-backed power. We need a system that bridges this gap by providing an intuitive UI for managing scalable, complex data operations.

## Users / stakeholders
- **Non-technical Domain Experts:** Users comfortable with data tables but not coding.
- **Data Scientists/Developers:** Creators of the underlying Python scripts/processes.
- **Operations Managers:** Those needing to run these processes at scale.

## Solution Overview
This project serves as a UI to facilitate complicated processes at scale. The application is built using **React** and **Glide**. The overall design follows an Excel-like iterative framework but allows for functions that generalize beyond standard spreadsheet capabilities (e.g., long-running tasks).

### Key Concepts
- **STEPS:** The core abstraction. A "Step" represents a particular process (implemented as Python scripts on the backend) that transforms data.
- **Workflow:** A linear sequence of steps.

### UI Design
- **Step Visualization:** Steps are displayed as arrow-shaped icons aligned from left to right near the top of the main page.
- **Step Interaction:** Clicking a step opens a detailed dropdown view containing:
  - **Tool Bar:** Options regarding operations, data processing, status, and execution strategy.
  - **Output View:** A column of cells representing the output data performed by the step. Each cell is interactive.
- **Management:** Users can add, remove, and modify steps within the workflow.
- **Global Controls:** Standard UI components (loading/saving workflows, settings, options, help) are positioned above the step visualization area.
- **Agent Widget:** A widget located near the top of the interface acting as an intelligent agent to facilitate and guide the set of operations.

## Constraints & Technology Stack
- **Frontend:** React, Glide
- **Backend:** Predominantly Python. Note that the full backend will not be implemented in this repository, though some test examples may be incorporated to demonstrate functionality.
- **Packaging:** src-layout (`src/your_package_name`)
- **Testing:** pytest
