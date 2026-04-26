export default function PlaidOauthReturnPage() {
  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">Plaid OAuth Return</p>
        <h1>Bank authentication returned to the app.</h1>
        <p className="lede">
          The client-side Plaid Link resume flow will be implemented on top of
          this route. For now, this page exists so the redirect URI resolves
          during OAuth-based institution setup.
        </p>
      </section>
    </main>
  );
}
