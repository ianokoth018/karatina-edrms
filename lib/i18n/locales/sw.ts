// Kiswahili locale dictionary for EDRMS.
// Mirrors the key shape of en.ts.
// Where no clean Swahili equivalent exists for a technical term, the
// English word is kept (and where helpful, paired with the closest gloss).

const sw = {
  nav: {
    dashboard: "Dashibodi",
    documents: "Nyaraka",
    memos: "Memo",
    workflows: "Mtiririko wa Kazi",
    forms: "Fomu",
    search: "Tafuta",
    records: "Kumbukumbu",
    reports: "Ripoti",
    admin: "Usimamizi",
  },
  actions: {
    save: "Hifadhi",
    cancel: "Ghairi",
    delete: "Futa",
    edit: "Hariri",
    create: "Unda",
    upload: "Pakia",
    download: "Pakua",
    share: "Shiriki",
    print: "Chapisha",
  },
  status: {
    loading: "Inapakia...",
    error: "Hitilafu imetokea",
    success: "Imefanikiwa",
    empty: "Hakuna vitu vya kuonyesha",
  },
  auth: {
    signIn: "Ingia",
    signOut: "Toka",
    signedInAs: "Umeingia kama",
  },
} as const;

export default sw;
