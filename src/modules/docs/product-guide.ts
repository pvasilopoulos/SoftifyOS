export type DocSectionId =
  | "overview"
  | "roadmap"
  | "platform"
  | "sales"
  | "customers"
  | "inventory"
  | "purchasing"
  | "finance"
  | "hr"
  | "retail"
  | "integrations"
  | "workflows"
  | "api";

export type DocBlock =
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "callout"; tone: "info" | "tip" | "warn"; text: string }
  | { type: "steps"; title: string; items: string[] }
  | { type: "kv"; rows: Array<{ k: string; v: string }> };

export type DocSection = {
  id: DocSectionId;
  title: string;
  subtitle: string;
  group: string;
  blocks: DocBlock[];
};

export const PRODUCT_DOC_SECTIONS: DocSection[] = [
  {
    id: "overview",
    title: "Τι είναι το SoftifyOS",
    subtitle: "Ελληνικό ERP για πωλήσεις, αποθήκη, λογιστική, HR και συμμόρφωση ΑΑΔΕ",
    group: "Εισαγωγή",
    blocks: [
      {
        type: "p",
        text: "Το SoftifyOS είναι πολυενοικιακό (multi-tenant) ERP για ελληνικές επιχειρήσεις. Καλύπτει τον κύκλο πωλήσεων, την αποθήκη, τις αγορές, τη γενική λογιστική (FI), το HR με ψηφιακή κάρτα εργασίας / Εργάνη, το POS λιανικής, και τις διασυνδέσεις myDATA.",
      },
      {
        type: "ul",
        items: [
          "A · Tenant = οργανισμός με απομονωμένα δεδομένα (RLS)",
          "B · Company (LegalEntity) = νομική οντότητα μέσα στον tenant (παραστατικά / λογιστική)",
          "Ρόλοι OWNER / ADMIN / MEMBER / VIEWER + προαιρετικό ACL ανά εταιρεία",
          "Ελληνικό UI (el-GR), ποσά σε EUR, πρότυπα ΑΑΔΕ / ΕΦΚΑ όπου εφαρμόζονται",
        ],
      },
      {
        type: "callout",
        tone: "tip",
        text: "Demo login: maria@akropolis.gr / SoftifyOS!2026 — ξεκίνα από Dashboard → Ουρά εργασίας.",
      },
      {
        type: "callout",
        tone: "warn",
        text: "Το SoftifyOS σήμερα είναι ισχυρό θεμέλιο ERP, όχι πλήρης Softone-parity. Δες την ενότητα Roadmap go-live για τη σειρά προτεραιοτήτων προς παραγωγή.",
      },
      {
        type: "kv",
        rows: [
          { k: "Πωλήσεις", v: "Προσφορές → Παραγγελίες → Τιμολόγια → Δελτία αποστολής" },
          { k: "Αποθήκη", v: "Αποθέματα, κινήσεις, lots/bins, μεταφορές, μετρήσεις" },
          { k: "Οικονομικά", v: "Ημερολόγιο, ισοζύγιο, Settlement Engine, AR/AP, ΦΠΑ βιβλία, myDATA" },
          { k: "HR", v: "Πλήρες HR: ημερολόγιο αδειών, onboarding, έγγραφα, QR κάρτα, Εργάνη, μισθοδοσία" },
          { k: "Πλατφόρμα", v: "Ρυθμίσεις, Script Hooks, Entity Views, Integrations API" },
        ],
      },
    ],
  },
  {
    id: "roadmap",
    title: "Roadmap go-live SME",
    subtitle: "Τι κλείνουμε πρώτα για παραγωγική ελληνική επιχείρηση",
    group: "Εισαγωγή",
    blocks: [
      {
        type: "p",
        text: "Προτεραιότητα: νόμιμο/υποχρεωτικό → κύκλος μετρητών → λιανική ΦΗΜ (αν χρειάζεται) → HR/μισθοδοσία → WMS/αγορές → FI βάθος. Παραγωγή/CRM depth αργότερα.",
      },
      {
        type: "ol",
        items: [
          "Phase A — myDATA prod, πάροχος e-invoicing, settlements QA, banking recon, ελληνικά books/ΦΠΑ (foundation shipped)",
          "Phase B — Card provider live, ΦΗΜ, POS day-end (μόνο αν υπάρχει λιανική) — adapters + Z-report shipped · live Viva/ΦΗΜ pending",
          "Phase C — Ergani live, payroll v1, ΦΜΥ/ΑΠΔ export — rates/export/fail-closed shipped · live Ergani pending",
          "Phase D — 3-way match, mobile picking, stock valuation",
          "Phase E — Period close, fixed assets batch, consolidation",
          "Phase F — Παραγωγή, project costing, marketplaces, offline PWA",
        ],
      },
      {
        type: "callout",
        tone: "tip",
        text: "Πλήρες κείμενο: docs/roadmap-sme-golive.md στο repo. v1 go-live = myDATA (ή πάροχος) + σταθερές πωλήσεις/εξοφλήσεις + banking + βασικές αναφορές + σωστό multi-company.",
      },
      {
        type: "kv",
        rows: [
          { k: "Τώρα", v: "Δυνατό sales/settlements/platform core" },
          { k: "Επόμενο κρίσιμο", v: "Live credentials ΑΑΔΕ / πάροχος / Ergani · Phase D WMS" },
          { k: "Όχι πρώτα", v: "Παραγωγή, πλήρες CRM, offline PWA" },
        ],
      },
    ],
  },
  {
    id: "platform",
    title: "Πώς δουλεύει η πλατφόρμα",
    subtitle: "Tenants, sessions, δικαιώματα, μενού, audit",
    group: "Εισαγωγή",
    blocks: [
      {
        type: "p",
        text: "Κάθε αίτημα περνά από session cookie (JWT). Το middleware προστατεύει τις σελίδες της εφαρμογής· δημόσια μένουν μόνο login και /api/health.",
      },
      {
        type: "ol",
        items: [
          "Login → επιλογή Tenant (A) + Company (B) όταν χρειάζεται → session JWT",
          "Κάθε API φορτώνει tenantId και legalEntityId από το session",
          "Παραστατικά / σειρές φιλτράρονται και σφραγίζονται με την ενεργή εταιρεία",
          "RLS στο Postgres απομονώνει δεδομένα ανά tenant",
          "Σημαντικές ενέργειες γράφουν στο audit log",
        ],
      },
      {
        type: "ul",
        items: [
          "Μενού: ρυθμίζεται στο /settings/menu (φάκελοι, ρόλοι, groups, mobile tabs)",
          "Οργανωτική δομή: Tenants / Companies / Branches / Warehouses στο /settings/org-structure",
          "Entity Views: προσαρμογή λιστών & φορμών χωρίς deploy",
          "Script Hooks: αυτοματισμοί σε form events και server events",
        ],
      },
      {
        type: "callout",
        tone: "info",
        text: "OWNER/ADMIN διαχειρίζονται χρήστες, ρόλους, integrations και εξαγωγή ρυθμίσεων. VIEWER είναι μόνο ανάγνωση.",
      },
      {
        type: "steps",
        title: "Workspace A + B",
        items: [
          "A · Tenant: οργανισμός / απομόνωση δεδομένων (Membership)",
          "B · Company (LegalEntity): νομική οντότητα / ΑΦΜ μέσα στον tenant — τιμολόγια, παραγγελίες, σειρές, ημερολόγιο",
          "Login picker όταν έχεις πολλά memberships· στο header εναλλάσσεις A και B",
          "Ρυθμίσεις → Χρήστες: ανά tenant ορίζεις ποιες εταιρείες βλέπει ο χρήστης (κενό = όλες)",
          "Αλλαγή εταιρείας στο header αλλάζει λίστες παραστατικών και προεπιλογή FI φίλτρων",
        ],
      },
      {
        type: "callout",
        tone: "warn",
        text: "Η αρίθμηση σειρών είναι ανά εταιρεία (tenant + legalEntity + code). Μην μετακινείς παραστατικά μεταξύ εταιρειών — δημιούργησε νέο στην σωστή εταιρεία.",
      },
    ],
  },
  {
    id: "sales",
    title: "Πωλήσεις & παραστατικά",
    subtitle: "Από προσφορά έως τιμολόγιο, myDATA και εκτύπωση",
    group: "Επιχειρησιακά",
    blocks: [
      {
        type: "p",
        text: "Ο κύκλος πωλήσεων ξεκινά από πελάτη και προϊόντα, περνά από προσφορά/παραγγελία και καταλήγει σε τιμολόγιο (και προαιρετικά δελτίο αποστολής).",
      },
      {
        type: "steps",
        title: "Τυπική ροή έκδοσης",
        items: [
          "Επίλεξε πελάτη (και branch/space αν χρειάζεται)",
          "Πρόσθεσε γραμμές προϊόντων · ΦΠΑ & σύνολα υπολογίζονται αυτόματα",
          "Διάλεξε σειρά παραστατικού (Document Series) — ορίζει αρίθμηση και myDATA τύπο",
          "Αποθήκευση / Έκδοση · κατάσταση από Invoice Statuses",
          "Αν η σειρά έχει myDATA ON → δημιουργείται εγγραφή στην ουρά ΑΑΔΕ",
          "Εκτύπωση μέσω Print Forms ή σελίδα /invoices/[id]/print",
        ],
      },
      {
        type: "ul",
        items: [
          "/quotes — προσφορές (μετατροπή σε παραγγελία)",
          "/orders — παραγγελίες πώλησης · Document Transforms σε τιμολόγιο",
          "/invoices — τιμολόγια / πιστωτικά · workspace με preview",
          "/delivery-notes — δελτία αποστολής συνδεδεμένα με παραγγελία/τιμολόγιο",
        ],
      },
      {
        type: "callout",
        tone: "warn",
        text: "Χωρίς σωστή σειρά παραστατικού και ΑΦΜ οργανισμού, η διαβίβαση myDATA θα αποτύχει στο test/prod.",
      },
    ],
  },
  {
    id: "customers",
    title: "Πελάτες & CRM",
    subtitle: "Customer → Branch → Space · χάρτης · leads",
    group: "Επιχειρησιακά",
    blocks: [
      {
        type: "p",
        text: "Το master data πελατών είναι ιεραρχικό: Πελάτης (επωνυμία, ΑΦΜ) → Υποκαταστήματα/διευθύνσεις → Spaces (τραπέζια, σημεία παράδοσης κ.λπ.).",
      },
      {
        type: "ul",
        items: [
          "/customers — λίστα, αναζήτηση, χάρτης Google (όταν υπάρχει API key)",
          "Καρτέλα πελάτη: στοιχεία, διευθύνσεις, ιστορικό παραστατικών",
          "/crm — leads & δραστηριότητες για εμπορική παρακολούθηση",
        ],
      },
      {
        type: "callout",
        tone: "tip",
        text: "Στον χάρτη τα pins δείχνουν επωνυμία (tradeName ή name) από geocoding διευθύνσεων branch.",
      },
    ],
  },
  {
    id: "inventory",
    title: "Προϊόντα & αποθήκη",
    subtitle: "Κατάλογος, αποθέματα, κινήσεις, WMS-lite",
    group: "Επιχειρησιακά",
    blocks: [
      {
        type: "p",
        text: "Τα προϊόντα ορίζουν μονάδες μέτρησης, τιμές και αν επηρεάζουν απόθεμα. Η αποθήκη κρατά υπόλοιπα ανά site/warehouse και καταγράφει κινήσεις.",
      },
      {
        type: "ul",
        items: [
          "/products — κατάλογος, παραλλαγές, μονάδες",
          "/inventory — υπόλοιπα, κινήσεις, lots, bins, μεταφορές, μετρήσεις, κρατήσεις",
          "Σειρές με affectsInventory ενημερώνουν απόθεμα στην έκδοση παραστατικού",
          "Sites τύπου WAREHOUSE συνδέονται με οργανωτική δομή",
        ],
      },
      {
        type: "steps",
        title: "Πώς κινείται το απόθεμα",
        items: [
          "Παραλαβή από αγορά / χειροκίνητη κίνηση → αύξηση",
          "Πώληση / δελτίο αποστολής → μείωση (αν η σειρά το ορίζει)",
          "Μεταφορά μεταξύ sites · μέτρηση για διόρθωση διαφορών",
        ],
      },
    ],
  },
  {
    id: "purchasing",
    title: "Αγορές",
    subtitle: "Προμηθευτές, PO, τιμολόγια αγοράς FI",
    group: "Επιχειρησιακά",
    blocks: [
      {
        type: "p",
        text: "Οι αγορές καλύπτουν παραγγελίες προς προμηθευτές και τιμολόγια αγοράς που postάρουν στη λογιστική.",
      },
      {
        type: "ul",
        items: [
          "/purchasing — ανοιχτά PO, παραλαβές",
          "Οικονομικά → Αγορές FI — τιμολόγια αγοράς με GL posting (έξοδα / ΦΠΑ εισροών)",
          "AP στο Finance hub — aging ανοιχτών Purchase Invoices + πληρωμή Settlement",
        ],
      },
    ],
  },
  {
    id: "finance",
    title: "Οικονομικά (FI)",
    subtitle: "Ημερολόγιο, ισοζύγιο, AR/AP, ΦΠΑ, περίοδοι, myDATA",
    group: "Οργάνωση",
    blocks: [
      {
        type: "p",
        text: "Το /finance είναι χώρος εργασίας λογιστή: αριστερό μενού ενοτήτων και καθολικά φίλτρα (διάστημα, περίοδος, εταιρεία, αναζήτηση) που ισχύουν σε όλες τις όψεις.",
      },
      {
        type: "ul",
        items: [
          "Ημερολόγιο — χειροκίνητα άρθρα, Post / Void / Αντιστροφή, καρτέλα λογαριασμού",
          "Ισοζύγιο & αναφορές — Trial Balance, Αποτελέσματα, Ισολογισμός, Consolidation",
          "Απαιτήσεις (AR) — ανοιχτά τιμολόγια, aging, cash forecast",
          "Υποχρεώσεις (AP) — aging τιμολογίων αγοράς (Purchase Invoice) + πληρωμή via Settlement",
          "Εξοφλήσεις — Settlement Engine: ολική/μερική/multi-tender, void, εκκαθάριση καρτών (βήμα 2)",
          "Ελληνικά βιβλία — βιβλίο ΦΠΑ ανά συντελεστή, καρτέλες πελάτη/προμηθευτή, wizard υπολοίπων έναρξης",
          "ΦΠΑ περιόδου · Τράπεζες (match → είσπραξη) · myDATA Live",
          "Περίοδοι — άνοιγμα/κλείσιμο μηνών · hard-lock άρθρων · κλείσιμο χρήσης 80.xx",
          "CO / IC / Ledgers · Διαστάσεις · Πάγια",
        ],
      },
      {
        type: "steps",
        title: "Μηνιαία ρουτίνα λογιστή",
        items: [
          "Όρισε φίλτρα: μήνας ή YTD + νομική οντότητα",
          "Έλεγξε πρόχειρα άρθρα → Post",
          "Ισοζύγιο / αποτελέσματα για την περίοδο",
          "AR ληξιπρόθεσμα & AP προς πληρωμή (Settlement)",
          "Εκκαθάριση καρτών (Εξοφλήσεις → εκκρεμή clearing)",
          "Ελληνικά βιβλία · ουρά myDATA",
          "Κλείσιμο μήνα όταν ολοκληρωθούν οι κινήσεις",
        ],
      },
      {
        type: "callout",
        tone: "info",
        text: "Το λογιστικό σχέδιο (ελληνικό pack) ρυθμίζεται στο /settings/gl-accounts. Οι σειρές ορίζουν settlement params (partial / multi-tender / clearing) και αυτόματα άρθρα έκδοσης.",
      },
    ],
  },
  {
    id: "hr",
    title: "HR",
    subtitle: "Πλήρες suite: άδειες, ημερολόγιο, onboarding, παρουσία, μισθοδοσία",
    group: "Οργάνωση",
    blocks: [
      {
        type: "p",
        text: "Το /hr είναι ανταγωνιστικό HR hub: επισκόπηση, pulse ομάδας, οργανόγραμμα, άδειες με ημερολόγιο, έγγραφα, onboarding, QR παρουσία και μισθοδοσία.",
      },
      {
        type: "ul",
        items: [
          "Εργαζόμενοι / οργανόγραμμα — ΑΦΜ/ΑΜΚΑ/ΑΜΑ, τμήματα, καρτέλες",
          "Ημερολόγιο αδειών — μηνιαία οπτική + φίλτρα τμήματος · ελληνικές αργίες/blackout",
          "Άδειες — αιτήσεις με έλεγχο επικάλυψης/υπολοίπου, μισή ημέρα, εγκρίσεις, προσαρμογές υπολοίπων",
          "Onboarding — αυτόματο checklist στην πρόσληψη · progress ανά άτομο",
          "Έγγραφα — μητρώο συμβάσεων/πιστοποιητικών με ειδοποίηση λήξης",
          "Κάρτα εργασίας — QR scanner check-in/out, live board, kiosk, late/early",
          "Εργάνη — ουρά δηλώσεων (simulator/test/prod)",
          "Μισθοδοσία — περίοδος μήνα, ΕΦΚΑ/φόρος/καθαρά, κλείσιμο",
        ],
      },
      {
        type: "callout",
        tone: "warn",
        text: "Η live Εργάνη δεν είναι ακόμα συνδεδεμένη με κυβερνητικό API — το περιβάλλον prod γράφει stub refs μέχρι να μπουν credentials/client.",
      },
    ],
  },
  {
    id: "retail",
    title: "Λιανική: POS, δωροκάρτες, loyalty",
    subtitle: "Ταμείο και προγράμματα επιβράβευσης",
    group: "Επιχειρησιακά",
    blocks: [
      {
        type: "ul",
        items: [
          "/pos — ταμείο λιανικής με τρόπους πληρωμής (showInPos)",
          "/gift-cards — έκδοση / εξαργύρωση δωροκαρτών",
          "/loyalty — μέλη και πρόγραμμα πόντων",
        ],
      },
      {
        type: "p",
        text: "Οι πληρωμές POS συνδέονται με Payment Methods στις ρυθμίσεις. Τα παραστατικά λιανικής μπορούν να ακολουθούν ξεχωριστή σειρά (π.χ. απόδειξη).",
      },
    ],
  },
  {
    id: "integrations",
    title: "Integrations & αυτοματισμοί",
    subtitle: "Webhooks, myDATA ΑΑΔΕ, API tokens, Script Hooks",
    group: "Πλατφόρμα",
    blocks: [
      {
        type: "p",
        text: "Στο /settings/integrations ρυθμίζεις εξωτερικές διασυνδέσεις. Στο /settings/scripts ορίζεις αυτοματισμούς που τρέχουν σε UI ή server events.",
      },
      {
        type: "ul",
        items: [
          "Webhooks — outbound HMAC-SHA256 σε γεγονότα (invoice, customer κ.ά.)",
          "myDATA — simulator / AADE test / production SendInvoices",
          "API tokens — Bearer ή X-Softify-Api-Key για εξωτερικά συστήματα",
          "Script Hooks — form.onLoad / onFieldChange / beforeSubmit + server hooks",
          "Marketplaces & channels — CRUD καναλιών (Skroutz/Shopify/Woo…) + Script Secrets / allow-list",
        ],
      },
      {
        type: "steps",
        title: "Ενεργοποίηση myDATA",
        items: [
          "Ρύθμισε ΑΦΜ οργανισμού στο /settings/organization",
          "Στη σειρά τιμολογίου άνοιξε myDATA + τύπο (π.χ. 1.1)",
          "Βάλε περιβάλλον + credentials στο Integrations",
          "Έκδωσε τιμολόγιο → εμφανίζεται στο myDATA Live (/mydata)",
          "Test connection ή Επεξεργασία ουράς",
        ],
      },
    ],
  },
  {
    id: "workflows",
    title: "Ροές εργασίας ανά ρόλο",
    subtitle: "Τι κάνει καθημερινά ο κάθε χρήστης",
    group: "Οδηγοί",
    blocks: [
      {
        type: "steps",
        title: "Πωλητής / back-office",
        items: [
          "Dashboard → εκκρεμότητες",
          "Νέα παραγγελία ή τιμολόγιο από πελάτη",
          "Έλεγχος αποθέματος πριν την έκδοση",
          "Παρακολούθηση CRM leads",
        ],
      },
      {
        type: "steps",
        title: "Λογιστής",
        items: [
          "Finance → φίλτρα περιόδου",
          "Post πρόχειρων άρθρων · ισοζύγιο",
          "AR/AP & ΦΠΑ · ουρά myDATA",
          "Κλείσιμο μήνα",
        ],
      },
      {
        type: "steps",
        title: "HR",
        items: [
          "Νέος εργαζόμενος → onboarding checklist + ουρά Εργάνη hire",
          "Ημερολόγιο αδειών · έγκριση αιτήσεων · υπόλοιπα/προσαρμογές",
          "Έκδοση κάρτας · QR check-in/out · live παρουσία",
          "Έγγραφα / λήξεις · μισθοδοσία μήνα · κλείσιμο",
        ],
      },
      {
        type: "steps",
        title: "Διαχειριστής συστήματος",
        items: [
          "Χρήστες / ρόλοι / μενού",
          "Σειρές παραστατικών & τρόποι πληρωμής",
          "Integrations credentials + API tokens",
          "Export ρυθμίσεων · audit monitor",
        ],
      },
    ],
  },
  {
    id: "api",
    title: "API — σύνοψη",
    subtitle: "Δημόσια και προστατευμένα endpoints για διασυνδέσεις",
    group: "Οδηγοί",
    blocks: [
      {
        type: "p",
        text: "Αναλυτικά παραδείγματα curl/JSON υπάρχουν στη σελίδα Integrations → API endpoints. Εδώ η σύνοψη ρόλων των βασικών διαύλων.",
      },
      {
        type: "kv",
        rows: [
          { k: "GET /api/health", v: "Δημόσιος health check (uptime)" },
          { k: "GET /api/mydata/submissions", v: "Ουρά myDATA του tenant" },
          { k: "POST …/process-batch", v: "Επεξεργασία ουράς ΑΑΔΕ" },
          { k: "POST /api/scripts/ui-event", v: "Τρέξιμο Script Hooks από forms" },
          { k: "GET /api/settings/export", v: "Snapshot ρυθμίσεων (χωρίς secrets)" },
          { k: "…/integrations/tokens", v: "Δημιουργία / revoke API keys" },
        ],
      },
      {
        type: "callout",
        tone: "tip",
        text: "Άνοιξε /settings/integrations → API endpoints για πλήρη docs με copy-paste curl.",
      },
    ],
  },
];

export function findDocSection(id: string): DocSection | undefined {
  return PRODUCT_DOC_SECTIONS.find((s) => s.id === id);
}
