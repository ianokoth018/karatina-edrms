// English locale dictionary for EDRMS.
// Keep keys in sync with sw.ts.

const en = {
  nav: {
    dashboard: "Dashboard",
    documents: "Documents",
    memos: "Memos",
    workflows: "Workflows",
    forms: "Forms",
    search: "Search",
    records: "Records",
    reports: "Reports",
    admin: "Admin",
  },
  actions: {
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
    edit: "Edit",
    create: "Create",
    upload: "Upload",
    download: "Download",
    share: "Share",
    print: "Print",
  },
  status: {
    loading: "Loading...",
    error: "An error occurred",
    success: "Success",
    empty: "No items to display",
  },
  auth: {
    signIn: "Sign in",
    signOut: "Sign out",
    signedInAs: "Signed in as",
  },
} as const;

export default en;
