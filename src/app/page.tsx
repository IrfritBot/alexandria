import Link from "next/link";

import { createSupabaseServerClient } from "../lib/supabase/server";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type WorkspaceMembership = {
  workspaces: {
    name: string;
    slug: string;
  } | null;
};

const problemCards = [
  {
    title: "Repeated context tax",
    copy: "The same docs, decisions, caveats, and customer notes get pasted into every new AI thread.",
  },
  {
    title: "Fragmented memory",
    copy: "Each person's AI starts to learn a different version of the company, then those versions drift.",
  },
  {
    title: "No governance",
    copy: "Important AI-visible knowledge needs ownership, review, and history before teams can trust it.",
  },
];

const workflowSteps = [
  {
    title: "Capture",
    copy: "Save useful context from any MCP client while the work is happening.",
    chip: "memory_save",
  },
  {
    title: "Classify",
    copy: "Identify whether it is a decision, policy, preference, insight, or project update.",
    chip: "typed memory",
  },
  {
    title: "Reconcile",
    copy: "Detect conflicts and superseded knowledge before stale context spreads.",
    chip: "conflict queue",
  },
  {
    title: "Retrieve",
    copy: "Inject the right context into the next AI task, wherever the team is working.",
    chip: "memory_search",
  },
];

const productSurfaces = [
  {
    title: "MCP server for daily work",
    copy: "A small, intentional tool surface for saving and retrieving shared memory from Claude, Cursor, ChatGPT, and any MCP client.",
    items: [
      "memory_save",
      "memory_search",
      "memory_get",
      "memory_recall_recent",
    ],
    note: "No destructive MCP operations in v1.",
  },
  {
    title: "Web governance shell",
    copy: "A focused workspace for the review work that makes shared AI context safe to reuse across real teams.",
    items: [
      "Browse memory",
      "Review conflicts",
      "Audit history",
      "Workspace members/admins",
    ],
    note: "Built around member and admin roles for v1 simplicity.",
  },
];

const trustItems = [
  "Workspace-level isolation with RLS defense in depth",
  "Audit log for memory and workspace changes",
  "Conflict queue for contradictory or superseded context",
  "Member/admin roles for v1 simplicity",
  "Model-agnostic architecture; MCP-native by design",
];

const useCases = [
  {
    title: "Agency handoffs",
    copy: "Client preferences, positioning, tone, and history travel across team members without another onboarding dump.",
  },
  {
    title: "Product teams",
    copy: "Decisions and PRD context follow agents from planning to implementation to code review.",
  },
  {
    title: "Customer-facing teams",
    copy: "Customer facts stay consistent across research, sales, support, and delivery workflows.",
  },
];

const memoryItems = [
  {
    label: "Decision",
    text: "Enterprise pricing stays annual-first with exception review.",
  },
  {
    label: "Policy",
    text: "Only admin-reviewed customer facts can be reused externally.",
  },
  {
    label: "Customer insight",
    text: "Design partners care most about agent handoffs and auditability.",
  },
  {
    label: "Project history",
    text: "The May launch scope excludes destructive MCP tools.",
  },
];

const toolChips = ["Claude", "Cursor", "ChatGPT", "Notion", "Slack", "MCP"];
const governanceStates = [
  "classified",
  "embedded",
  "conflict checked",
  "audit logged",
];

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <LandingPage />;
  }

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspaces(name, slug)")
    .order("joined_at", { ascending: true })
    .overrideTypes<WorkspaceMembership[], { merge: false }>();
  const workspaces = (memberships ?? [])
    .map((membership) => membership.workspaces)
    .filter((workspace): workspace is NonNullable<typeof workspace> =>
      Boolean(workspace),
    );

  return (
    <main className={styles.home}>
      <section aria-labelledby="page-title">
        <p className={styles.eyebrow}>Alexandria</p>
        <h1 id="page-title">Welcome</h1>
        <p>{user.email}</p>
        <Link href="/workspaces/new">Create workspace</Link>
        {workspaces.length > 0 ? (
          <ul aria-label="Your workspaces">
            {workspaces.map((workspace) => (
              <li key={workspace.slug}>
                <Link href={`/workspaces/${workspace.slug}`}>
                  {workspace.name}
                </Link>{" "}
                ({workspace.slug})
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}

function LandingPage() {
  return (
    <main className={styles.landing}>
      <nav className={styles.nav} aria-label="Main navigation">
        <Link className={styles.brand} href="/" aria-label="Alexandria home">
          <span className={styles.brandMark}>A</span>
          <span>Alexandria</span>
        </Link>
        <div className={styles.navLinks}>
          <a href="#product">Product</a>
          <a href="#how-it-works">How it works</a>
          <a href="#governance">Governance</a>
          <Link href="/login">Sign in</Link>
        </div>
        <Link className={styles.navCta} href="/login">
          Request access
        </Link>
      </nav>

      <section className={styles.hero} aria-labelledby="page-title">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>MCP-native team memory</p>
          <h1 id="page-title">
            One memory layer for every AI your team uses.
          </h1>
          <p className={styles.heroSubhead}>
            Alexandria captures decisions, policies, customer context, and
            project history once, then makes it available across Claude, Cursor,
            ChatGPT, and any MCP client with governance built in.
          </p>
          <div className={styles.heroActions} aria-label="Landing page actions">
            <Link className={styles.primaryCta} href="/login">
              Request access
            </Link>
            <a className={styles.secondaryCta} href="#how-it-works">
              See how it works
            </a>
          </div>
          <p className={styles.trustLine}>
            Built for 20-200 person teams adopting AI across real workflows.
          </p>
        </div>
        <HeroVisual />
      </section>

      <section className={styles.section} aria-labelledby="problem-title">
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>The reset problem</p>
          <h2 id="problem-title">
            Your team context resets every time someone opens a new AI chat.
          </h2>
        </div>
        <div className={styles.cardGrid}>
          {problemCards.map((card) => (
            <article className={styles.problemCard} key={card.title}>
              <span className={styles.cardSpark} aria-hidden="true" />
              <h3>{card.title}</h3>
              <p>{card.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section
        className={`${styles.section} ${styles.workflowSection}`}
        id="how-it-works"
        aria-labelledby="workflow-title"
      >
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>How it works</p>
          <h2 id="workflow-title">Capture once. Retrieve everywhere.</h2>
        </div>
        <ol className={styles.workflowList}>
          {workflowSteps.map((step, index) => (
            <li className={styles.workflowStep} key={step.title}>
              <span className={styles.stepNumber}>
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3>{step.title}</h3>
              <p>{step.copy}</p>
              <span className={styles.stepChip}>{step.chip}</span>
            </li>
          ))}
        </ol>
      </section>

      <section
        className={styles.section}
        id="product"
        aria-labelledby="product-title"
      >
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>Product surface</p>
          <h2 id="product-title">
            Governed context, not another chat silo.
          </h2>
        </div>
        <div className={styles.surfaceGrid}>
          {productSurfaces.map((surface) => (
            <article className={styles.surfaceCard} key={surface.title}>
              <h3>{surface.title}</h3>
              <p>{surface.copy}</p>
              <ul className={styles.surfaceList}>
                {surface.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className={styles.surfaceNote}>{surface.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section
        className={`${styles.section} ${styles.governanceSection}`}
        id="governance"
        aria-labelledby="governance-title"
      >
        <div className={styles.governanceIntro}>
          <p className={styles.eyebrow}>Governance</p>
          <h2 id="governance-title">
            Shared memory only works if teams can trust it.
          </h2>
          <p>
            Alexandria treats team memory as operational infrastructure: scoped,
            reviewed, inspectable, and portable across models.
          </p>
        </div>
        <ul className={styles.trustGrid}>
          {trustItems.map((item) => (
            <li key={item}>
              <span aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="use-cases-title">
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>Built for AI-heavy teams</p>
          <h2 id="use-cases-title">A shared source of truth for daily work.</h2>
        </div>
        <div className={styles.cardGrid}>
          {useCases.map((useCase) => (
            <article className={styles.useCaseCard} key={useCase.title}>
              <h3>{useCase.title}</h3>
              <p>{useCase.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.finalCta} aria-labelledby="final-cta-title">
        <p className={styles.eyebrow}>Request access</p>
        <h2 id="final-cta-title">Give every AI the same source of truth.</h2>
        <p>
          Alexandria is being shaped with teams that already feel the pain of
          fragmented AI context.
        </p>
        <Link className={styles.primaryCta} href="/login">
          Request access
        </Link>
      </section>

      <footer className={styles.footer}>
        <div>
          <Link className={styles.footerBrand} href="/">
            Alexandria
          </Link>
          <p>MCP-native shared team memory</p>
        </div>
        <nav aria-label="Footer navigation">
          <Link href="/login">Sign in</Link>
          <a href="#product">Product</a>
          <a href="#governance">Governance</a>
        </nav>
      </footer>
    </main>
  );
}

function HeroVisual() {
  return (
    <div className={styles.heroVisual} aria-hidden="true">
      <div className={styles.dotField} />
      <div className={`${styles.connectionLine} ${styles.connectionOne}`} />
      <div className={`${styles.connectionLine} ${styles.connectionTwo}`} />
      <article className={styles.promptCard}>
        <div className={styles.promptMeta}>
          <span>Ask any AI client</span>
          <span>team context</span>
        </div>
        <p>What did we decide about enterprise pricing?</p>
        <div className={styles.promptFooter}>
          <span>Project policy</span>
          <span>Customer history</span>
        </div>
      </article>
      <article className={styles.memoryPanel}>
        <div className={styles.panelHeader}>
          <span>Alexandria memory</span>
          <span>4 matches</span>
        </div>
        <ul>
          {memoryItems.map((item) => (
            <li key={item.label}>
              <span>{item.label}</span>
              <p>{item.text}</p>
            </li>
          ))}
        </ul>
      </article>
      <div className={styles.toolCloud}>
        {toolChips.map((tool) => (
          <span key={tool}>{tool}</span>
        ))}
      </div>
      <div className={styles.governanceRail}>
        {governanceStates.map((state) => (
          <span key={state}>{state}</span>
        ))}
      </div>
    </div>
  );
}
