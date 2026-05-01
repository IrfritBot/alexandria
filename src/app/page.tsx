import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.home}>
      <section aria-labelledby="page-title">
        <p className={styles.eyebrow}>Alexandria</p>
        <h1 id="page-title">Sprint 1A bootstrap</h1>
        <p>
          Lean Next.js shell for the future web app, route-handler API, MCP
          surface, Supabase data layer, and Inngest worker path.
        </p>
      </section>
    </main>
  );
}
