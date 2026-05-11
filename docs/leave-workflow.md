# Staff Leave Workflow — Complete Setup Guide
### Karatina University EDRMS · End-to-End Low-Code Configuration

**Scope:** Annual Leave, Sick Leave, Maternity/Paternity Leave, Compassionate Leave, Study Leave  
**Approval chain:** Requestor (Staff) → Recommender (HOD / Dean / DVC) → Approver (HR) → Approved  
**Estimated setup time:** 45–60 minutes  
**Prerequisites:** Admin access to the EDRMS

---

## Table of Contents

1. [Pre-requisites — Roles & Pools](#1-pre-requisites--roles--pools)
2. [Form Data Datasets](#2-form-data-datasets)
3. [Casefolder Template](#3-casefolder-template)
4. [Form Design](#4-form-design)
5. [Workflow Design](#5-workflow-design)
6. [Link Form to Workflow](#6-link-form-to-workflow)
7. [Module Settings & Custom Views](#7-module-settings--custom-views)
8. [Escalation Matrix](#8-escalation-matrix)
9. [Publish Everything](#9-publish-everything)
10. [End-to-End Test](#10-end-to-end-test)
11. [Year-End Leave Carry-Forward](#11-year-end-leave-carry-forward)
12. [Leave Recall Workflow](#12-leave-recall-workflow)
13. [What You Get — Feature Checklist](#13-what-you-get--feature-checklist)
14. [Scope Boundaries](#14-scope-boundaries)

---

## 1. Pre-requisites — Roles & Pools

Before touching the form or workflow designer, the right roles and task pools must exist. This ensures assignment dropdowns are populated when you configure nodes.

### 1.1 Verify Roles

Go to **Admin → Users & Roles → Roles** and confirm the following roles exist. Create any that are missing.

| Role name (exact) | Who holds it |
|---|---|
| `staff` | All university staff eligible to apply for leave |
| `recommender` | HODs, Deans, and DVCs — they recommend leave requests |
| `hr-officer` | HR Officers — they give final approval and process leave |
| `admin` | EDRMS administrators |

> **Pool vs Role:** For the two task nodes, use **pools** rather than roles so the task lands in a shared inbox. Add recommenders (HODs, Deans, DVCs) to the `Recommenders Pool` and HR officers to the `HR Leave Pool`.

> **Important:** Role names are case-sensitive in assignment rules. Use the exact names above.

### 1.2 Create Task Pools

Task pools allow any available member of a group to claim and action a task. This is essential for HR and Dean desks where multiple people share a queue.

Go to **Workflows → Pools** and create the following two pools:

---

**Pool 1**
- **Name:** `Recommenders Pool`
- **Description:** HODs, Deans, and DVCs who recommend leave requests
- **Members:** Add all Heads of Department, Deans, and DVCs

---

**Pool 2**
- **Name:** `HR Leave Pool`
- **Description:** HR Officers who give final approval and process leave
- **Members:** Add all HR officers by name (search users)

---

Once saved, these pool names will appear in the workflow node assignment dropdowns.

---

## 2. Form Data Datasets

The system uses a generic data store (**Admin → Form Data**) for reference tables that workflows query at runtime. Set up two datasets before building the workflow.

### 2.1 Leave Types Dataset

Go to **Admin → Form Data** and click **New Dataset** (or use the Quick-start Template **"Leave Types"**).

- **Name:** `Leave Types`
- **Slug:** `leave-types` *(auto-generated)*

**Fields:**

| Field Label | Field Name | Type |
|---|---|---|
| Leave Type | `leave_type` | Text |
| Gender | `gender` | Select (`Male`, `Female`, `Any`) |
| Days Allocated | `days_allocated` | Number |
| Max Consecutive Days | `max_consecutive` | Number |
| Requires Document | `requires_document` | Boolean |

**Records to add** (one row per leave type):

| leave_type | gender | days_allocated | max_consecutive | requires_document |
|---|---|---|---|---|
| Annual Leave | Any | 21 | 21 | false |
| Sick Leave | Any | 14 | 14 | true |
| Maternity Leave | Female | 90 | 90 | true |
| Paternity Leave | Male | 14 | 14 | false |
| Compassionate Leave | Any | 5 | 5 | true |
| Study Leave | Any | 30 | 30 | true |
| Emergency Leave | Any | 3 | 3 | false |

### 2.2 Leave Balances Dataset

Create a second dataset using the Quick-start Template **"Leave Balances"**.

- **Name:** `Leave Balances`
- **Slug:** `leave-balances`

**Fields:**

| Field Label | Field Name | Type |
|---|---|---|
| Employee ID | `employee_id` | Text |
| Leave Type | `leave_type` | Text |
| Days Allocated | `days_allocated` | Number |
| Days Used | `days_used` | Number |
| Days Remaining | `days_remaining` | Number |
| Year | `year` | Number |
| Carried Forward | `carried_forward` | Number |

`carried_forward` is set automatically by the year-end carry-forward engine (see Section 11). For manually-created records leave it at `0`.

**Populate this dataset** with one row per employee per leave type at the start of each financial year. HR manages this table manually or via the **Admin → Leave Management** carry-forward tool (see Section 11).

> **Tip:** The workflow will use `lookup_form_data` and `update_form_data` system actions to check and deduct balances automatically at runtime — no manual HR intervention needed for that part.

---

## 3. Casefolder Template

A casefolder template defines the **records filing structure** for this process. Every leave request will be filed into this casefolder, keeping all related documents (application, supporting docs, approval letter) together as a single records unit.

### 3.1 Navigate to Casefolders

Go to **Records → Casefolders** in the left sidebar.

### 3.2 Create New Casefolder

Click **"Create New Casefolder"**. This opens the **Forms Designer** pre-configured for casefolder creation.

### 3.3 Configure the Casefolder

**Top bar settings:**
- **Name field:** `Staff Leave Application`
- **Description:** `Filing template for staff leave requests at Karatina University`

**Casefolder-level metadata fields to add:**

| Label | Name | Type | Notes |
|---|---|---|---|
| Employee Name | `employee_name` | Text | Mark: Used in Title |
| Department | `department` | Select | Data Source: Departments; Mark: Aggregation Key |
| Leave Type | `leave_type` | Select | Options: as in Section 2.1; Mark: Used in Title |
| Leave Start Date | `leave_start_date` | Date | Required |
| Leave End Date | `leave_end_date` | Date | Required |
| Number of Days | `leave_days` | Number | Required; Validation: Min 1, Max 90 |

### 3.4 Save and Activate

- Click **Publish** toggle (turns green)
- Click **Save**

---

## 4. Form Design

The form is the **data entry screen** that staff fill in when submitting a leave request.

### 4.1 Navigate to Forms Designer

Go to **Forms → Designer** (or **Forms → New Form**).

### 4.2 Name the Form

In the top bar: `Leave Request Form`

### 4.3 Build the Form Fields

#### Section 1 — Applicant Details

| Label | Name | Type | Config |
|---|---|---|---|
| *(section header)* | — | Section | Label: `Applicant Details` |
| Full Name | `full_name` | Text | Required; Width: Half; Auto-fill: `user.name` |
| Employee ID | `employee_id` | Text | Required; Width: Half; Auto-fill: `user.employeeId` |
| Personal Number (Payroll) | `personal_number` | Text | Width: Half |
| Job Title / Designation | `job_title` | Text | Required; Width: Half; Auto-fill: `user.jobTitle` |
| Department / School | `department` | Select | Required; Data Source: Departments; Width: Half; Auto-fill: `user.department` |
| Email Address | `email` | Email | Required; Width: Half; Auto-fill: `user.email` |
| Phone Number | `phone` | Phone | Required; Width: Half; Auto-fill: `user.phone` |
| Direct Supervisor / HOD | `supervisor` | User Picker | Required; Help Text: `Select the head of your department who will recommend this leave` |

#### Section 2 — Leave Details

| Label | Name | Type | Config |
|---|---|---|---|
| *(section header)* | — | Section | Label: `Leave Details` |
| Type of Leave | `leave_type` | Radio | Required; Options: Annual Leave, Sick Leave, Maternity Leave, Paternity Leave, Compassionate Leave, Study Leave, Emergency Leave |
| Leave Start Date | `leave_start_date` | Date | Required; Width: Half; **Min Date:** `startOfFinancialYear`; **Max Date:** `endOfFinancialYear` |
| Leave End Date | `leave_end_date` | Date | Required; Width: Half; **Min Date:** `startOfFinancialYear`; **Max Date:** `endOfFinancialYear`; **Cross-Field Rule:** `leave_end_date ≥ leave_start_date` → *"End date cannot be before the start date"* |
| Total Working Days Requested | `leave_days` | Number | Required; **Auto-Calculation:** enabled → Start Field: `leave_start_date`, End Field: `leave_end_date`; Width: Half |
| Current Leave Balance (Days) | `leave_balance` | Number | Read Only; Width: Half; Help Text: `Auto-populated from leave balance register` |
| Acting Officer During Absence | `acting_officer` | User Picker | Required; Help Text: `Who will cover your duties while you are on leave?` |

> **Auto day calculation:** The `leave_days` field is configured with **Auto-Calculation → Business Days**. When staff select start and end dates, the system automatically counts working days using the configured Work Calendar — excluding weekends, public holidays, and any custom closures. Staff do not count days manually.

> **Date restrictions:** Both date fields are restricted to the current Kenyan financial year (1 July – 30 June) via the `startOfFinancialYear` / `endOfFinancialYear` tokens. Staff cannot accidentally select dates outside the active leave year — the date picker enforces the bounds.

> **Cross-field validation:** If a staff member sets the end date earlier than the start date, an inline error *"End date cannot be before the start date"* appears under the end date field and the action buttons are disabled until the error is resolved. This is configured entirely in the form designer — no code required.

#### Section 3 — Reason & Supporting Documents

| Label | Name | Type | Config |
|---|---|---|---|
| *(section header)* | — | Section | Label: `Reason & Supporting Information` |
| Reason for Leave | `reason` | Textarea | Required; Min Length: 20, Max Length: 500 |
| Medical Certificate | `medical_certificate` | File | Help Text: `Required for sick leave exceeding 3 days`; Condition: show when `leave_type` equals `Sick Leave` |
| Supporting Document (Obituary / Certificate) | `compassionate_document` | File | Condition: show when `leave_type` equals `Compassionate Leave` |
| Admission Letter / Exam Timetable | `study_document` | File | Condition: show when `leave_type` equals `Study Leave` |

#### Section 4 — Declaration

| Label | Name | Type | Config |
|---|---|---|---|
| *(section header)* | — | Section | Label: `Declaration` |
| Applicant Declaration | `declaration` | Checkbox | Required; Option: `I confirm that the information provided above is true and accurate` |

### 4.4 Preview the Form

Click **Preview** in the top bar. Verify:
- Auto-fill fields pre-populate from the logged-in user's profile
- Select start and end dates — `leave_days` auto-calculates and shows a green "Auto-calculated" badge
- The date pickers are capped to the current financial year — dates outside Jul 1 – Jun 30 are not selectable
- Set end date earlier than start date — an inline error appears and the submit button is disabled; correcting the dates clears the error immediately
- Changing leave type to `Sick Leave` shows the medical certificate upload field
- Changing back to `Annual Leave` hides it

### 4.5 Save (Do Not Publish Yet)

Click **Save** without publishing. Publish after linking in Step 6.

---

## 5. Workflow Design

The workflow defines the **routing and approval logic**.

### 5.1 Navigate to Workflow Designer

Go to **Workflows → Designer**.

### 5.2 Start a New Workflow

- **Name:** `Staff Leave Request`
- **Description:** `End-to-end leave application, recommendation, and approval workflow for Karatina University staff`

### 5.3 Canvas Layout

The workflow has four possible end states: **Approved**, **Rejected**, **Not Processed** (insufficient balance), and **Withdrawn** (applicant cancelled during the amendment phase). Every node and every edge is shown below.

```
┌──────────────────────────────────────────────────┐
│  START: Leave Application Submitted              │
└─────────────────────────┬────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────┐
│  SYSTEM: Check Leave Balance                     │
│  lookup_form_data → leave-balances               │
│  filter: employee_id AND leave_type              │
└─────────────────────────┬────────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │  DECISION:            │
              │  Balance OK?          │
              └───────┬───────────────┘
                      │
          ┌───────────┴──────────────────┐
     Insufficient                    Proceed
          │                               │
          ▼                               ▼
┌─────────────────────┐    ┌──────────────────────────────────┐
│ EMAIL: Insufficient │    │ TASK: Recommendation        [A] │◄─(Resubmit)
│ Balance → Initiator │    │ Pool: Recommenders Pool (48h)   │
└──────────┬──────────┘    └─────┬─────────────┬─────────────┘
           │                     │             │          │
           ▼                Recommend       Return     Reject
┌──────────────────┐             │             │          │
│ END:             │             │         ★ Returned  ★ Rejected
│ Not Processed    │             │         ★ Revision  ★ END:Rejected
└──────────────────┘             │            ├─Resubmit──► [A]
                                 │            └─Withdraw──► END:Withdrawn
                                 │
                                 ▼
                    ┌──────────────────────────────────┐
                    │ TASK: HR Approval                │
                    │ Pool: HR Leave Pool (24h)        │
                    └─────┬─────────────┬─────────────┘
                          │             │          │
                       Approve       Return     Reject
                          │             │          │
                          │        ★ (same nodes as above)
                          │
                          ▼
                    ┌──────────────────────────────────┐
                    │ SYSTEM: Create Delegation        │
                    └──────────────────┬───────────────┘
                                       │
                                       ▼
                    ┌──────────────────────────────────┐
                    │ SYSTEM: Deduct Leave Balance     │
                    └──────────────────┬───────────────┘
                                       │
                                       ▼
                    ┌──────────────────────────────────┐
                    │ EMAIL: Leave Approved → Initiator│
                    └──────────────────┬───────────────┘
                                       │
                                       ▼
                    ┌──────────────────────────────────┐
                    │ END: Leave Approved ✓            │
                    └──────────────────────────────────┘
```

**★ Shared nodes** — drawn once on the canvas; multiple edges point into them:

```
★ Return path (from Recommendation OR HR Approval):
  └─► EMAIL: Returned for Amendments
        └─► TASK: Applicant Revision
              ├─[Resubmit]──► TASK: Recommendation [A]
              └─[Withdraw]──► EMAIL: Application Withdrawn
                                └─► END: Withdrawn

★ Reject path (from Recommendation OR HR Approval):
  └─► EMAIL: Leave Rejected
        └─► END: Rejected
```

**End states:**

| State | Status | Triggered by |
|---|---|---|
| Leave Approved | `COMPLETED` | HR Approves |
| Not Processed | `CANCELLED` | Balance check fails |
| Rejected | `REJECTED` | Recommender or HR rejects |
| Withdrawn | `CANCELLED` | Staff withdraws during revision |

> **Amendment loop:** After a Return, staff receive an email and a revision task lands in their inbox. On Resubmit the request restarts from **Recommendation** — even if HR returned it — so both approvers review the amended version in sequence.

---

### Node 1 — Start

- **Label:** `Leave Application Submitted`
- **Description:** `Staff submits a leave request`

---

### Node 2 — System: Check Leave Balance

**Type:** System  
**Label:** `Check Leave Balance`

**Action Type:** `Lookup Form Data`

**Configuration:**
- Dataset Slug: `leave-balances`
- Filters (multi-condition — both must match):
  - `employee_id` = `{{formData.employee_id}}`
  - `leave_type` = `{{formData.leave_type}}`
- Result Variable Prefix: `balance`

Injects `_lookup_balance.days_remaining`, `_lookup_balance.days_allocated`, and `_lookup_balance.days_used` into workflow context. The compound filter ensures the correct leave type balance is fetched — not just any balance record for the employee.

---

### Node 3 — Decision: Balance OK?

**Type:** Decision  
**Label:** `Balance Check`

**Conditions:**
- `_lookup_balance.days_remaining` **less than** `{{formData.leave_days}}` → `Insufficient Balance`
- Default → `Proceed`

---

### Node 4 — Email: Insufficient Balance

**Type:** Email  
**Label:** `Notify Staff — Insufficient Balance`

**Recipient:** Initiator

**Subject:** `Leave Request Not Processed — Insufficient Balance ({{instance.referenceNumber}})`

**Body:**
```
Dear {{formData.full_name}},

Your leave request could not proceed because you have insufficient leave balance.

Leave Type:     {{formData.leave_type}}
Days Requested: {{formData.leave_days}}
Days Remaining: {{_lookup_balance.days_remaining}}

Please contact HR if you believe this is incorrect.

Regards,
Karatina University HR Department
```

**CTA Button:** Label `View Request`, URL `{{instance.url}}`

---

### Node 5 — Task: Recommender (HOD / Dean / DVC)

This is the **Recommender** step. The Head of Department, Dean, or DVC reviews the leave request and either recommends it for HR approval or returns/declines it.

The recommender is determined by the **supervisor** field the applicant selected on the form — assign the task to the user picker value so the right person receives it, or use a pool if multiple recommenders share a queue.

**Type:** Task  
**Label:** `Recommendation`

**Assignment:** Pool → `Recommenders Pool` *(add HODs, Deans, and DVCs as members)*  
**SLA:** 48 hours  
**Escalation:** After 24 hours → notify `admin` role  
**Actions:**

| Action Label | Button Colour | What happens |
|---|---|---|
| Recommend | Green | Moves to HR Approval step |
| Return for Amendments | Amber | Sends back to applicant for correction |
| Reject | Red | Ends workflow — leave rejected |

---

### Node 6 — Task: Approver (HR)

This is the **Approver** step. HR gives final approval and processes the leave.

**Type:** Task  
**Label:** `HR Approval`

**Assignment:** Pool → `HR Leave Pool`  
**SLA:** 24 hours  
**Escalation:** After 12 hours → notify pool lead  
**Actions:**

| Action Label | Button Colour | What happens |
|---|---|---|
| Approve | Green | Triggers delegation + balance deduction → approval email → end |
| Return for Amendments | Amber | Sends back to applicant for correction |
| Reject | Red | Ends workflow — leave rejected |

---

### Node 7 — Task: Applicant Revision

This node is reached when either the Recommender or HR returns a request for amendments. It creates a task assigned back to the original applicant so they can open the form, correct the fields, and act.

**Type:** Task
**Label:** `Applicant Revision`

**Assignment:** Initiator (the staff member who submitted the request)
**SLA:** 5 working days
**Escalation:** After 3 days → notify the initiator again

**Actions:**

| Action Label | Button Colour | What happens |
|---|---|---|
| Resubmit | Green | Loops back to **Task: Recommendation** — the amended request goes through the full approval chain again |
| Withdraw | Red | Staff cancels the application → EMAIL: Application Withdrawn → END: Withdrawn |

> **Why loop back to Recommendation, not HR?** If HR returned the request, they may have spotted an issue the Recommender missed. Routing back through the Recommender ensures the amended version is re-reviewed by both approvers in sequence, preserving the governance chain.

---

### Node 8 — System: Create Delegation

Runs automatically after the Approver clicks **Approved**.

**Type:** System  
**Label:** `Create Acting Officer Delegation`

**Action Type:** `Create Delegation`

**Configuration:**
- Delegate Field: `acting_officer`
- Start Date Field: `leave_start_date`
- End Date Field: `leave_end_date`
- Reason: `Leave Delegation`

Creates a delegation record so any workflow tasks assigned to the absent staff member are automatically redirected to the acting officer during the leave period.

---

### Node 9 — System: Deduct Leave Balance

**Type:** System  
**Label:** `Deduct Leave Balance`

**Action Type:** `Update Form Data`

**Configuration:**
- Dataset Slug: `leave-balances`
- Match Conditions (multi-condition — both must match):
  - `employee_id` = `{{formData.employee_id}}`
  - `leave_type` = `{{formData.leave_type}}`
- Fields to Update:
```json
{
  "days_used": "{{_lookup_balance.days_used + formData.leave_days}}",
  "days_remaining": "{{_lookup_balance.days_remaining - formData.leave_days}}"
}
```

---

### Node 10 — Email: Leave Approved

**Type:** Email  
**Label:** `Notify Staff — Approved`

**Recipient:** Initiator

**Subject:** `Your Leave Has Been Approved — {{instance.referenceNumber}}`

**Body:**
```
Dear {{formData.full_name}},

Your leave request ({{instance.referenceNumber}}) has been approved.

Leave Type:     {{formData.leave_type}}
From:           {{formData.leave_start_date}}
To:             {{formData.leave_end_date}}
Working Days:   {{formData.leave_days}}

Please ensure you hand over your duties to {{formData.acting_officer}} 
before your leave commences.

Regards,
Karatina University HR Department
```

**CTA Button:** Label `View Approval`, URL `{{instance.url}}`

> All emails use the branded KARU React Email template — green header with logo, metadata fact box, and a CTA button. Placeholders are resolved at send time.

---

### Node 11 — Shared negative path email nodes

These two email nodes each have **multiple incoming edges** — place them once on the canvas and route the relevant edges into them.

---

**Node 11a — Email: Returned for Amendments**

Incoming edges: Task: Recommendation (Return for Amendments) and Task: HR Approval (Return for Amendments).
Outgoing edge: → Task: Applicant Revision (Node 7).

- **Subject:** `Your Leave Request Has Been Returned for Amendments — {{instance.referenceNumber}}`
- **Body:**
```
Dear {{formData.full_name}},

Your leave request ({{instance.referenceNumber}}) has been returned for amendments.

Please review the comments below, make the necessary corrections, and resubmit.

Leave Type:     {{formData.leave_type}}
Days Requested: {{formData.leave_days}}

Click the button below to open your request and make changes.

Regards,
Karatina University HR Department
```
- **CTA Button:** Label `Open & Amend`, URL `{{instance.url}}`

---

**Node 11b — Email: Application Withdrawn**

Incoming edge: Task: Applicant Revision (Withdraw action).
Outgoing edge: → END: Withdrawn.

- **Subject:** `Leave Application Withdrawn — {{instance.referenceNumber}}`
- **Body:**
```
Dear {{formData.full_name}},

Your leave request ({{instance.referenceNumber}}) has been withdrawn at your request.

Leave Type:     {{formData.leave_type}}
Days Requested: {{formData.leave_days}}

If you wish to apply again, please submit a new request.

Regards,
Karatina University HR Department
```
- **CTA Button:** Label `View Details`, URL `{{instance.url}}`

---

**Node 11c — Email: Leave Rejected**

Incoming edges: Task: Recommendation (Reject) and Task: HR Approval (Reject).
Outgoing edge: → END: Rejected.

- **Subject:** `Leave Request Rejected — {{instance.referenceNumber}}`
- **Body:**
```
Dear {{formData.full_name}},

We regret to inform you that your leave request ({{instance.referenceNumber}}) 
has been rejected.

Leave Type:     {{formData.leave_type}}
Days Requested: {{formData.leave_days}}

Please contact HR or your supervisor for further clarification.

Regards,
Karatina University HR Department
```
- **CTA Button:** Label `View Details`, URL `{{instance.url}}`

---

### Node 12 — End nodes

| Label | Status | Reached from |
|---|---|---|
| `Leave Approved` | `COMPLETED` | Email: Leave Approved |
| `Not Processed` | `CANCELLED` | Email: Insufficient Balance |
| `Withdrawn` | `CANCELLED` | Email: Application Withdrawn |
| `Leave Rejected` | `REJECTED` | Email: Leave Rejected |

---

### 5.4 Draw the Connections (Edges)

| From | Edge Label | To |
|---|---|---|
| Start | *(none)* | System: Check Leave Balance |
| System: Check Leave Balance | *(none)* | Decision: Balance OK? |
| Decision: Balance OK? | Insufficient Balance | Email: Insufficient Balance |
| Decision: Balance OK? | Proceed | Task: Recommendation |
| Email: Insufficient Balance | *(none)* | End: Not Processed |
| Task: Recommendation | Recommend | Task: HR Approval |
| Task: Recommendation | Return for Amendments | Email: Returned for Amendments |
| Task: Recommendation | Reject | Email: Leave Rejected |
| Email: Returned for Amendments | *(none)* | Task: Applicant Revision |
| Task: Applicant Revision | Resubmit | Task: Recommendation |
| Task: Applicant Revision | Withdraw | Email: Application Withdrawn |
| Email: Application Withdrawn | *(none)* | End: Withdrawn |
| Task: HR Approval | Approve | System: Create Delegation |
| Task: HR Approval | Return for Amendments | Email: Returned for Amendments |
| Task: HR Approval | Reject | Email: Leave Rejected |
| System: Create Delegation | *(none)* | System: Deduct Leave Balance |
| System: Deduct Leave Balance | *(none)* | Email: Leave Approved |
| Email: Leave Approved | *(none)* | End: Leave Approved |
| Email: Leave Rejected | *(none)* | End: Rejected |

> **Shared node tip:** When drawing on the canvas, `Email: Returned for Amendments` and `Email: Leave Rejected` each have two incoming arrows (one from Recommendation, one from HR Approval). Draw them as a single node and route both edges into it — the canvas engine supports multiple incoming edges per node.

### 5.5 Save the Workflow (Draft)

Click **Save**. Do not publish yet.

---

## 6. Link Form to Workflow

### 6.1 Go Back to the Form Designer

Go to **Forms**, open `Leave Request Form`.

### 6.2 Link the Workflow

In the top bar workflow selector dropdown, select `Staff Leave Request`. A **"Workflow linked"** badge will appear.

### 6.3 Save

Click **Save**.

---

## 7. Module Settings & Custom Views

### 7.1 Open the Workflow in the Designer

Go to **Workflows → Designer**, load `Staff Leave Request`.

### 7.2 Module Settings

| Field | Value |
|---|---|
| Module Slug | `leave-requests` |
| Instance Label | `Leave Request` |
| Sidebar Icon | `Clipboard` |
| Sidebar Order | `1` |

### 7.3 Custom Views

| Label | Filter | Purpose |
|---|---|---|
| My Requests | `mine` | Staff see their own submissions |
| Pending My Action | `mine_pending` | Tasks waiting for the logged-in user |
| Overdue | `overdue` | HR monitors SLA breaches |
| All Requests | `all` | HR full institution view |
| Awaiting Recommendation | `step:Recommendation` | Recommender (HOD/Dean/DVC) queue |
| Awaiting HR Approval | `step:HR Approval` | HR approval queue |

### 7.4 Save

Click **Save**.

---

## 8. Escalation Matrix

Configure an escalation matrix so that tasks not actioned within their SLA are automatically escalated.

### 8.1 Recommender Escalation Matrix

Go to **Admin → Escalation Matrix** → **New Matrix**.

- **Name:** `Leave Recommendation Escalation`
- **Applies To:** Pool → `Recommenders Pool`
- **Levels:**

| Level | After Hours | Action | Escalate To | Notify Original |
|---|---|---|---|---|
| 1 | 24 | Notify | Same pool | Yes |
| 2 | 48 | Both | `admin` role | Yes |

The Recommender task has a 48-hour SLA. After 24 hours without action the whole pool is re-notified. After 48 hours the admin is also alerted.

### 8.2 HR Approver Escalation Matrix

Create a separate matrix for HR:

- **Name:** `Leave HR Approval Escalation`
- **Applies To:** Pool → `HR Leave Pool`
- **Levels:**

| Level | After Hours | Action | Escalate To | Notify Original |
|---|---|---|---|---|
| 1 | 12 | Notify | Same pool | Yes |
| 2 | 24 | Both | `admin` role | Yes |

The HR Approval task has a 24-hour SLA. HR is reminded at 12 hours; admin is looped in at 24 hours.

---

## 9. Publish Everything

### 9.1 Publish the Workflow

In **Workflows → Designer** with `Staff Leave Request` loaded:
1. Toggle **Active** → green
2. Click **Save & Publish**

The `Leave Requests` sidebar module appears immediately.

### 9.2 Publish the Form

Go to **Forms**, open `Leave Request Form`:
1. Toggle **Publish** → green
2. Click **Save**

---

## 10. End-to-End Test

### 10.1 Staff — Submit a Leave Request

1. Click **Leave Requests → New Leave Request**
2. Verify auto-fill fields pre-populate from your profile (Full Name, Staff Number, Department, Email)
3. Select Leave Type: `Annual Leave`
4. Set Start Date and End Date — confirm the date picker does not allow dates outside the current financial year (1 Jul – 30 Jun)
5. Verify `Total Working Days Requested` auto-calculates (green "Auto-calculated" badge appears, excludes weekends and public holidays)
6. **Test cross-field validation:** Set End Date earlier than Start Date → inline error appears under End Date and Submit becomes disabled → correct the date → error clears and Submit re-enables
7. Select your Direct Supervisor and Acting Officer
8. Tick the declaration checkbox and click **Submit**
9. Verify: reference number generated (e.g. `LR-2026-0001`), status `IN PROGRESS`

---

### 10.2 Recommender (HOD / Dean / DVC) — Recommend

1. Log in as a member of the **Recommenders Pool** → **Leave Requests → Pending My Action**
2. Open the request — review the leave details, days requested, and reason
3. Click one of the three action buttons:

| Action | Expected outcome |
|---|---|
| **Recommend** | Task moves to HR Approval; staff receives no email yet |
| **Return for Amendments** | Staff receives "Returned" email with `Open & Amend` button; instance stays open |
| **Reject** | Staff receives "Rejected" email; instance ends with status `REJECTED` |

Test the golden path: click **Recommend**.

---

### 10.3 Approver (HR) — Approve

1. Log in as a member of the **HR Leave Pool** → **Leave Requests → Awaiting HR Approval**
2. Open the request — review the recommendation and all form fields
3. Click one of the three action buttons:

| Action | Expected outcome |
|---|---|
| **Approve** | System nodes fire automatically (see below) |
| **Return for Amendments** | Staff receives "Returned" email; instance stays open |
| **Reject** | Staff receives "Rejected" email; instance ends with status `REJECTED` |

Test the golden path: click **Approve**.

**After clicking Approve, verify automatically:**
- Delegation record created for the acting officer (Admin → Form Data or check delegation logs)
- Leave balance deducted in the Leave Balances dataset (Admin → Form Data → Leave Balances → filter by employee ID)
- Approval email received by staff with **View Approval** CTA button (KARU green branded template)
- Instance status: `COMPLETED`

---

### 10.4 Test: Return for Amendments Path

**Test A — Returned by Recommender:**

1. Submit a new leave request as staff
2. Log in as a member of the **Recommenders Pool** → click **Return for Amendments**
3. Verify staff receives the **"Returned for Amendments"** email with `Open & Amend` button
4. Verify a **Task: Applicant Revision** task appears in the staff member's own task inbox
5. Log back in as staff → open the task → edit the form fields → click **Resubmit**
6. Verify the task re-appears in the **Recommenders Pool** inbox (not HR — it restarts from Recommendation)
7. Verify instance status remains `IN PROGRESS` throughout

**Test B — Returned by HR:**

1. Submit a leave request → Recommender clicks **Recommend** → task reaches HR
2. Log in as a member of the **HR Leave Pool** → click **Return for Amendments**
3. Verify staff receives the same **"Returned for Amendments"** email
4. Log in as staff → open the Applicant Revision task → amend → click **Resubmit**
5. Verify the task appears in the **Recommenders Pool** inbox (loops back to Recommendation, not directly to HR)

**Test C — Applicant Withdraws:**

1. Submit a leave request → Recommender clicks **Return for Amendments**
2. Log in as staff → open the Applicant Revision task → click **Withdraw**
3. Verify staff receives the **"Application Withdrawn"** email
4. Verify instance status: `CANCELLED` and no leave balance is deducted

---

### 10.5 Test: Rejection Path

1. Submit a new leave request as staff
2. Log in as Recommender or HR → click **Reject**
3. Verify staff receives the "Rejected" email
4. Verify instance ends with status `REJECTED` and no balance is deducted

---

### 10.6 Test: Insufficient Balance

1. Set a staff member's `days_remaining` to `2` in the Leave Balances dataset (Admin → Form Data → Leave Balances)
2. Log in as that staff member and submit a leave request for 5 days
3. Verify: workflow immediately sends the "Insufficient Balance" email and ends — **no task is created** for the Recommender or HR

---

### 10.7 Test: Validation Blocking at Task Step

1. Open a pending leave task as the Recommender or HR
2. Set the End Date to a date before the Start Date
3. Verify action buttons are disabled and the message *"Fix validation errors before submitting"* appears
4. Correct the date — buttons re-enable immediately

---

### 10.8 Test: Year-End Carry-Forward (Dry Run)

1. Go to **Admin → Leave Management**
2. Set From Year: current year, To Year: next year
3. Enable Annual Leave carry-forward with a cap of 10 days
4. Click **Preview (Dry Run)** — verify the preview table shows expected new allocations without writing any records
5. Click **Run Carry-Forward** and confirm — verify new records appear in the Leave Balances dataset for the target year with correct `carried_forward` values

---

### 10.9 Check the Audit Trail

In **Leave Requests**, open any completed instance and go to **Trace**. Verify the audit trail shows every step with: timestamp, action taker name, action taken, and any comments entered.

---

## 11. Year-End Leave Carry-Forward

At the end of each financial year (30 June) HR needs to carry forward unused leave days to the new year's balances. The system handles this in bulk via **Admin → Leave Management**.

### 11.1 Navigate

Go to **Admin → Leave Management**.

### 11.2 Review Current Balances

The top section shows a live table of all leave balance records. Use the **Year** filter to view the closing year (e.g. `2025`). Confirm the data is complete — every employee should have a row for every leave type they are entitled to.

### 11.3 Configure Carry-Forward Rules

Under **Carry-Forward Rules**, set:

| Setting | Description |
|---|---|
| **From Year** | The financial year closing (e.g. `2025`) |
| **To Year** | The new year opening (e.g. `2026`) |

For each leave type toggle **Enable Carry-Forward** and set a **Cap (days)**:

| Leave Type | Carry Forward | Cap |
|---|---|---|
| Annual Leave | ✔ | 10 |
| Sick Leave | ✗ | — |
| Maternity Leave | ✗ | — |
| Paternity Leave | ✗ | — |
| Compassionate Leave | ✗ | — |
| Study Leave | ✔ | 5 |
| Emergency Leave | ✗ | — |

> Cap means: the system carries forward the **lesser of** actual days remaining and the cap. A staff member with 18 unused annual leave days carries forward 10, not 18.

### 11.4 Preview (Dry Run)

Click **Preview (Dry Run)**. A table appears showing:

| Staff Number | Leave Type | Days Remaining (closing year) | Carry Forward | New Allocation |
|---|---|---|---|---|
| KU/STAFF/2021/001 | Annual Leave | 7 | 7 | 28 |
| KU/STAFF/2021/002 | Annual Leave | 18 | 10 | 31 |
| KU/STAFF/2021/003 | Study Leave | 0 | 0 | 30 |

Review the preview. Any record already existing for the target year is listed as **Skipped** (safe to re-run).

### 11.5 Execute

When satisfied with the preview, click **Run Carry-Forward**. A confirmation modal summarises the counts. Click **Confirm**.

The engine:
1. Reads all closing-year balance records
2. Fetches base allocation from the **Leave Types** dataset per leave type
3. Adds the capped carry-forward amount
4. Creates new records in **Leave Balances** for the opening year with `carried_forward` set to the carried amount
5. Skips any record where a target-year row already exists (idempotent — safe to re-run on partial failures)

A result summary shows: `processed`, `created`, `skipped`, `errors`, with an expandable detail log per staff member. The operation is also recorded in the audit trail.

### 11.6 Year-End Carry-Forward Inside a Workflow (Optional)

If the carry-forward should be triggered automatically when the HR Director approves a year-end close workflow, add a **System node** with:

- **Action Type:** `Year-End Carry-Forward`
- **From Year:** `{{formData.from_year}}`
- **To Year:** `{{formData.to_year}}`
- **Balances Dataset Slug:** `leave-balances`
- **Types Dataset Slug:** `leave-types`
- **Rules (JSON):**
```json
[
  { "leaveType": "Annual Leave", "enabled": true, "cap": 10 },
  { "leaveType": "Study Leave",  "enabled": true, "cap": 5  }
]
```

This is equivalent to clicking the admin UI button but fires within a governed, auditable workflow.

---

## 12. Leave Recall Workflow

A staff member can be recalled to work before their approved leave ends (e.g. due to an emergency). The EDRMS handles recall as a **separate workflow** linked to the original leave record.

### 12.1 Design

Create a new workflow named `Staff Leave Recall` with the following nodes:

```
[Start]
  ↓
[Task: HOD / HR Initiate Recall]   ← confirms recall and remaining days
  ↓
[System: Credit Back Balance]      ← update_form_data (leave-balances)
  ↓
[Email: Notify Staff — Recalled]
  ↓
[End: Recall Processed]
```

### 12.2 Form for the Recall Workflow

Create a form named `Leave Recall Request` with these fields:

| Label | Name | Type | Notes |
|---|---|---|---|
| Employee Being Recalled | `employee_id` | Text | Required |
| Original Leave Reference | `original_reference` | Text | Required — the leave instance ref number |
| Original Leave Type | `leave_type` | Text | Required |
| Original Leave Start | `original_start_date` | Date | |
| Original Leave End | `original_end_date` | Date | |
| Actual Return Date | `actual_return_date` | Date | Required — the date staff physically returns |
| Days Unused (to Credit Back) | `days_to_credit` | Number | Required; Min: 1 |
| Reason for Recall | `recall_reason` | Textarea | Required |

### 12.3 System Node — Credit Back Balance

**Action Type:** `Update Form Data`

**Configuration:**
- Dataset Slug: `leave-balances`
- Match Field: `employee_id`
- Match Value: `{{formData.employee_id}}`
- Fields to Update:
```json
{
  "days_used": "{{_lookup_balance.days_used - formData.days_to_credit}}",
  "days_remaining": "{{_lookup_balance.days_remaining + formData.days_to_credit}}"
}
```

> **Note:** Add a `Lookup Form Data` system node before this one (filtering on `employee_id`) so that `_lookup_balance.days_used` and `_lookup_balance.days_remaining` are available in context.

### 12.4 Email Node — Notify Staff

**Subject:** `You Have Been Recalled from Leave — {{instance.referenceNumber}}`

**Body:**
```
Dear Staff Member,

This is to inform you that you have been recalled from your {{formData.leave_type}} leave.

Please report for duty on: {{formData.actual_return_date}}

Days unused ({{formData.days_to_credit}}) have been credited back to your leave balance and will be available for a future application.

Reason: {{formData.recall_reason}}

Regards,
Karatina University HR Department
```

**CTA Button:** Label `View Details`, URL `{{instance.url}}`

### 12.5 Key Points

- The recall workflow is initiated by HR or the HOD — not the staff member themselves.
- The credited days are immediately visible in the **Leave Balances** dataset after the system node runs.
- The original leave instance remains `COMPLETED` — it is not modified. The recall is a separate, independently auditable record.
- If delegation was created for an acting officer, the acting officer's delegation should be ended manually (or a future `end_delegation` system action can handle this).

---

## 13. What You Get — Feature Checklist

| Feature | Configured Where | Code Required |
|---|---|---|
| Two-step approval chain (Recommender → Approver) | Workflow Designer — 2 Task nodes | None |
| Pool-based assignment — Recommenders Pool (HOD/Dean/DVC) | Task node → Assign to Pool | None |
| Pool-based assignment — HR Leave Pool (Approver) | Task node → Assign to Pool | None |
| Three actions per task (Recommend/Approve, Return, Reject) | Task node → Actions tab | None |
| SLA timers per step (48h Recommender, 24h HR) | Task node → SLA tab | None |
| Automatic escalation on SLA breach | Escalation Matrix (Admin) | None |
| Email notifications on each outcome | Email nodes (Approved / Returned / Rejected) | None |
| Branded KARU email template | Built-in (all emails) | None |
| Click-to-view button in every email | Email node → CTA Button config | None |
| Return for Amendments — staff revision task | Task: Applicant Revision node | None |
| Amendment loop — resubmit restarts approval chain | Resubmit edge → Task: Recommendation | None |
| Staff can withdraw during amendment phase | Withdraw edge → End: Withdrawn | None |
| Rejection path with notification | Edge on Reject → Email → End | None |
| Conditional form fields (medical cert) | Form Designer → Condition | None |
| Dynamic department dropdown | Form Designer → Data Source: Departments | None |
| User picker (supervisor, acting officer) | Form Designer → User Selector field | None |
| **Auto-fill from user profile** | Form Designer → Auto-fill | None |
| **Automatic business day calculation** | Form Designer → Number → Auto-Calculation | None |
| **Kenyan public holidays excluded** | Work Calendar (Admin) | None |
| **Date pickers restricted to current financial year** | Form Designer → Date → Min/Max Date tokens | None |
| **Cross-field validation (end ≥ start date)** | Form Designer → Field → Cross-Field Rules | None |
| **Submission blocked on validation errors** | Built-in (action buttons auto-disabled) | None |
| **Leave balance check before submission** | System node → Lookup Form Data | None |
| **Automatic balance deduction on approval** | System node → Update Form Data | None |
| **Auto-delegation to acting officer** | System node → Create Delegation | None |
| **Year-end bulk carry-forward (all staff)** | Admin → Leave Management | None |
| **Carry-forward dry-run preview** | Admin → Leave Management → Preview | None |
| **Leave recall with balance credit-back** | Leave Recall Workflow (separate workflow) | None |
| Auto-generated reference numbers | Built into the engine | None |
| Full audit trail / trace | Built-in per instance | None |
| Per-step SLA breach indicators | Inbox — red dot for overdue | None |
| Records filing (casefolder) | Casefolder Template | None |
| Sidebar module with sub-nav | Workflow Designer → Module Settings | None |
| Custom filtered views (6 views) | Module Settings → Custom Views | None |
| Analytics dashboard (KPIs, charts) | Built-in at /w/leave-requests/analytics | None |
| Dark mode | System-wide setting | None |
| Mobile-responsive views | System-wide | None |

---

## 14. Scope Boundaries

Features that remain outside the current low-code configuration and would require development:

| Feature | What would be needed |
|---|---|
| **Payroll-integrated balance** | The Leave Balances dataset is managed inside the EDRMS only. Real-time sync with an external payroll system (e.g. IFMIS) requires an integration layer. |
| **End delegation on recall** | When a staff member is recalled, the acting officer delegation must currently be removed manually. An `end_delegation` system action would automate this. |
| **Leave letter PDF generation** | Generating a signed, letterheaded PDF leave letter. Needs a PDF template engine and a merge step in the workflow. |
| **Leave calendar / planner view** | A calendar UI showing all approved leaves by department for HR coverage planning. |
| **Recurring leave requests** | Staff submitting the same leave pattern annually — no scheduling/recurrence engine exists yet. |
| **Payroll system integration** | Auto-syncing leave deductions to an external payroll system. The leave balance dataset is managed inside the EDRMS only. |
| **SMS approval gateway** | Staff replying to an SMS to approve/reject — requires integrating an SMS gateway with inbound message handling. |
